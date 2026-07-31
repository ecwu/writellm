import { randomUUID } from 'node:crypto'
import { builtinProviders, type BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import {
  createModels,
  createProvider,
  type Api,
  type AuthResult,
  type AuthInteraction,
  type AuthType,
  type Credential,
  type Model,
  type Models,
  type ModelsStore,
  type Provider,
  type ProviderModelsStore
} from '@earendil-works/pi-ai'
import type { Logger } from 'pino'
import { z } from 'zod'
import {
  agentManualModelSchema,
  agentModelSelectionSchema,
  agentModelSummarySchema,
  agentProviderCatalogSchema,
  agentPresetIdSchema,
  customAgentPiApiSchema,
  modelsDevProviderLogoIdSchema,
  piApiSchema,
  providerConfigSchema,
  type AgentCustomPresetInput,
  type AgentManualModel,
  type AgentModelSelection,
  type AgentProviderCatalog,
  type AgentProviderPresetSummary
} from '../../shared/contracts/providers'
import { resolveModelsDevProviderLogoId } from '../../shared/models-dev-provider-logos'
import type { AppDatabase } from '../app-db/connection'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import type { CredentialService } from './credential-service'
import { MainPiCredentialStore } from './pi-credential-store'
import { credentialBindingFingerprint } from './credential-binding'
import { fetchConfiguredEndpoint, readBoundedText } from '../../workers/outbound-http'

const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_MODELS = 2_000
const LEGACY_AGENT_PRESET_ID = 'custom:legacy-agent'
const LEGACY_AGENT_PROVIDER_CONFIG_ID = 'agent'
const MIGRATED_LEGACY_AGENT_PROVIDER_CONFIG_ID = `agent:${LEGACY_AGENT_PRESET_ID}`

const customPresetSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('agent-preset'),
    kind: z.literal('custom'),
    presetId: agentPresetIdSchema,
    providerId: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    logoOverrideId: modelsDevProviderLogoIdSchema.nullable().optional(),
    baseUrl: z.url().max(2_048),
    api: customAgentPiApiSchema,
    authMode: z.enum(['api_key', 'none']),
    timeoutMs: z.number().int().min(1_000).max(300_000)
  })
  .strict()
type CustomPreset = z.infer<typeof customPresetSchema>

const builtinPresetSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('agent-preset'),
    kind: z.literal('builtin'),
    presetId: agentPresetIdSchema,
    providerId: z.string().min(1).max(200),
    name: z.string().min(1).max(200)
  })
  .strict()

const cachedModelSchema = z
  .object({
    id: z.string().min(1).max(500),
    name: z.string().min(1).max(500),
    api: piApiSchema,
    provider: z.string().min(1).max(200),
    baseUrl: z.url().max(2_048),
    reasoning: z.boolean(),
    input: z
      .array(z.enum(['text', 'image']))
      .min(1)
      .max(2),
    cost: z.object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative(),
      cacheWrite: z.number().nonnegative()
    }),
    contextWindow: z.number().int().positive().max(10_000_000),
    maxTokens: z.number().int().positive().max(10_000_000),
    compat: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough()
const cachedModelsSchema = z.array(cachedModelSchema).max(MAX_MODELS)

export interface ResolvedAgentCatalogModel {
  presetId: string
  presetName: string
  providerId: string
  timeoutMs: number
  model: Model<Api>
  auth: AuthResult
}

export class AgentProviderCatalogService {
  readonly #credentialStore: MainPiCredentialStore
  readonly #modelsStore: DatabaseModelsStore

  constructor(
    private readonly database: AppDatabase,
    private readonly credentials: CredentialService,
    private readonly settings: Pick<
      AppSettingsRepository,
      'getDefaultAgentModelSelection' | 'setDefaultAgentModelSelection'
    >,
    private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>,
    private readonly now: () => Date = () => new Date()
  ) {
    this.#credentialStore = new MainPiCredentialStore(credentials, 'unused', (providerId) =>
      this.#providerConfigId(providerId)
    )
    this.#modelsStore = new DatabaseModelsStore(database, log, this.now)
  }

  async snapshot(): Promise<AgentProviderCatalog> {
    await this.#migrateLegacyAgentConfig()
    const models = await this.#buildModels()
    await models.refresh({ allowNetwork: false })
    const presets = await Promise.all(
      models.getProviders().map((provider) => this.#summarizeProvider(provider, models))
    )
    const defaultSelection = await this.settings.getDefaultAgentModelSelection()
    return agentProviderCatalogSchema.parse({
      presets: presets.sort((left, right) => left.name.localeCompare(right.name)),
      defaultSelection
    })
  }

  async saveCustomPreset(input: AgentCustomPresetInput): Promise<AgentProviderCatalog> {
    const presetId = agentPresetIdSchema.parse(input.presetId ?? `custom:${randomUUID()}`)
    if (presetId.startsWith('builtin:')) throw new Error('Built-in preset IDs are reserved')
    const providerId = `writellm-${presetId}`
    const previous = await this.#customPreset(presetId)
    const config = customPresetSchema.parse({
      schemaVersion: 1,
      role: 'agent-preset',
      kind: 'custom',
      presetId,
      providerId,
      name: input.name,
      logoOverrideId:
        input.logoOverrideId === undefined
          ? (previous?.logoOverrideId ?? null)
          : input.logoOverrideId,
      baseUrl: input.baseUrl,
      api: input.api,
      authMode: input.authMode,
      timeoutMs: input.timeoutMs
    })
    const securityIdentityChanged =
      previous !== null &&
      credentialBindingFingerprint({
        providerConfigId: `agent:${presetId}`,
        provider: providerId,
        configJson: JSON.stringify(previous)
      }) !==
        credentialBindingFingerprint({
          providerConfigId: `agent:${presetId}`,
          provider: providerId,
          configJson: JSON.stringify(config)
        })
    const now = this.now().toISOString()
    await this.database.kysely.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('provider_configs')
        .values({
          id: `agent:${presetId}`,
          provider: providerId,
          config_json: JSON.stringify(config),
          created_at: now,
          updated_at: now
        })
        .onConflict((conflict) =>
          conflict.column('id').doUpdateSet({
            provider: providerId,
            config_json: JSON.stringify(config),
            updated_at: now
          })
        )
        .execute()
      if (previous === null) {
        await transaction
          .insertInto('agent_provider_preferences')
          .values({
            provider_config_id: `agent:${presetId}`,
            enabled: 1,
            created_at: now,
            updated_at: now
          })
          .execute()
      }
      if (config.authMode === 'none') {
        await this.credentials.removeCredential(`agent:${presetId}`, transaction)
      } else if (input.apiKey !== undefined) {
        const serialized = JSON.stringify({ type: 'api_key', key: input.apiKey })
        await this.credentials.persistEncrypted(
          `agent:${presetId}`,
          this.credentials.encryptForPersistence(serialized),
          transaction
        )
      } else if (securityIdentityChanged) {
        await this.credentials.removeCredential(`agent:${presetId}`, transaction)
      }
      if (previous === null || securityIdentityChanged) {
        await transaction
          .deleteFrom('agent_model_catalogs')
          .where('provider_config_id', '=', `agent:${presetId}`)
          .execute()
      }
    })
    this.log.info(
      {
        event: 'agent.provider_preset.saved',
        presetId,
        providerId,
        api: config.api,
        securityIdentityChanged,
        credentialReplaced: input.apiKey !== undefined
      },
      'Agent provider preset saved'
    )
    return this.snapshot()
  }

  async removePreset(presetId: string): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    if (parsed.startsWith('builtin:')) {
      await this.#credentialStore.delete(parsed.slice('builtin:'.length))
    } else {
      await this.database.kysely.transaction().execute(async (transaction) => {
        await transaction
          .deleteFrom('provider_configs')
          .where('id', '=', `agent:${parsed}`)
          .execute()
        if (parsed === LEGACY_AGENT_PRESET_ID) {
          await transaction
            .deleteFrom('provider_configs')
            .where('id', '=', LEGACY_AGENT_PROVIDER_CONFIG_ID)
            .execute()
        }
      })
    }
    const defaultSelection = await this.settings.getDefaultAgentModelSelection()
    if (defaultSelection?.presetId === parsed) {
      await this.settings.setDefaultAgentModelSelection(null)
    }
    this.log.info(
      { event: 'agent.provider_preset.removed', presetId: parsed },
      'Removed Agent preset'
    )
    return this.snapshot()
  }

  async refreshPreset(presetId: string, signal: AbortSignal): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const models = await this.#buildModels()
    const providerId = await this.#runtimeProviderId(parsed)
    const provider = models.getProvider(providerId)
    if (provider === undefined) throw new Error('Agent provider preset does not exist')
    await this.#ensureProviderRecord(provider, parsed)
    const isolated = createModels({
      credentials: this.#credentialStore,
      modelsStore: this.#modelsStore
    })
    isolated.setProvider(provider)
    const attemptedAt = this.now().toISOString()
    try {
      const result = await isolated.refresh({ allowNetwork: true, force: true, signal })
      const error = result.errors.get(providerId)
      if (error !== undefined) throw error
      await this.#modelsStore.recordAttempt(providerId, attemptedAt, null)
      this.log.info(
        { event: 'agent.model_catalog.refreshed', presetId: parsed, providerId },
        'Refreshed Agent model catalog'
      )
    } catch (err) {
      await this.#modelsStore.recordAttempt(providerId, attemptedAt, safeRefreshErrorCode(err))
      this.log.error(
        { event: 'agent.model_catalog.refresh_failed', err, presetId: parsed, providerId },
        'Failed to refresh Agent model catalog'
      )
      throw new Error('Agent model catalog refresh failed', { cause: err })
    }
    return this.snapshot()
  }

  async setDefaultSelection(
    selection: AgentModelSelection | null
  ): Promise<AgentModelSelection | null> {
    if (selection !== null) await this.resolve(selection)
    return this.settings.setDefaultAgentModelSelection(selection)
  }

  async setProviderEnabled(presetId: string, enabled: boolean): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const provider = await this.#provider(parsed)
    await this.#ensureProviderRecord(provider, parsed)
    const now = this.now().toISOString()
    await this.database.kysely
      .insertInto('agent_provider_preferences')
      .values({
        provider_config_id: `agent:${parsed}`,
        enabled: enabled ? 1 : 0,
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) =>
        conflict.column('provider_config_id').doUpdateSet({
          enabled: enabled ? 1 : 0,
          updated_at: now
        })
      )
      .execute()
    if (!enabled) await this.#clearDefaultForPreset(parsed)
    this.log.info(
      { event: 'agent.provider_availability.updated', presetId: parsed, enabled },
      'Updated Agent provider availability'
    )
    return this.snapshot()
  }

  async setModelEnabled(
    presetId: string,
    modelId: string,
    enabled: boolean
  ): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const models = await this.#buildModels()
    await models.refresh({ allowNetwork: false })
    const provider = models.getProvider(await this.#runtimeProviderId(parsed))
    if (provider === undefined) throw new Error('Agent provider preset does not exist')
    const manual = await this.#manualModelRecord(parsed, modelId)
    if (manual === null && !provider.getModels().some((candidate) => candidate.id === modelId)) {
      throw new Error('Agent model does not exist')
    }
    await this.#ensureProviderRecord(provider, parsed)
    const now = this.now().toISOString()
    await this.database.kysely
      .insertInto('agent_model_preferences')
      .values({
        provider_config_id: `agent:${parsed}`,
        model_id: modelId,
        enabled: enabled ? 1 : 0,
        manual_model_json: manual?.manual_model_json ?? null,
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) =>
        conflict.columns(['provider_config_id', 'model_id']).doUpdateSet({
          enabled: enabled ? 1 : 0,
          updated_at: now
        })
      )
      .execute()
    if (!enabled) await this.#clearDefaultForModel(parsed, modelId)
    this.log.info(
      { event: 'agent.model_availability.updated', presetId: parsed, modelId, enabled },
      'Updated Agent model availability'
    )
    return this.snapshot()
  }

  async saveManualModel(presetId: string, input: AgentManualModel): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const model = agentManualModelSchema.parse(input)
    const provider = await this.#provider(parsed)
    const supportedApis = new Set(provider.getModels().map((candidate) => candidate.api))
    const custom = await this.#customPreset(parsed)
    if (custom !== null) supportedApis.add(custom.api)
    if (!supportedApis.has(model.api)) {
      throw new Error('Manual model API is not supported by this provider')
    }
    await this.#ensureProviderRecord(provider, parsed)
    const now = this.now().toISOString()
    await this.database.kysely
      .insertInto('agent_model_preferences')
      .values({
        provider_config_id: `agent:${parsed}`,
        model_id: model.id,
        enabled: 1,
        manual_model_json: JSON.stringify(model),
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) =>
        conflict.columns(['provider_config_id', 'model_id']).doUpdateSet({
          enabled: 1,
          manual_model_json: JSON.stringify(model),
          updated_at: now
        })
      )
      .execute()
    this.log.info(
      { event: 'agent.manual_model.saved', presetId: parsed, modelId: model.id, api: model.api },
      'Saved manual Agent model'
    )
    return this.snapshot()
  }

  async removeManualModel(presetId: string, modelId: string): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const record = await this.#manualModelRecord(parsed, modelId)
    if (record === null || record.manual_model_json === null) {
      throw new Error('Manual Agent model does not exist')
    }
    await this.database.kysely
      .deleteFrom('agent_model_preferences')
      .where('provider_config_id', '=', `agent:${parsed}`)
      .where('model_id', '=', modelId)
      .execute()
    await this.#clearDefaultForModel(parsed, modelId)
    this.log.info(
      { event: 'agent.manual_model.removed', presetId: parsed, modelId },
      'Removed manual Agent model'
    )
    return this.snapshot()
  }

  async setApiKey(presetId: string, apiKey: string): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const models = await this.#buildModels()
    const providerId = await this.#runtimeProviderId(parsed)
    const provider = models.getProvider(providerId)
    if (provider === undefined) throw new Error('Agent provider preset does not exist')
    await this.#ensureProviderRecord(provider, parsed)
    await this.#credentialStore.modify(providerId, async () => ({
      type: 'api_key',
      key: apiKey
    }))
    this.log.info(
      { event: 'agent.provider_credential.saved', presetId: parsed, providerId },
      'Saved Agent provider credential'
    )
    return this.snapshot()
  }

  async clearCredential(presetId: string): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const providerId = await this.#runtimeProviderId(parsed)
    await this.#credentialStore.delete(providerId)
    await this.#clearDefaultForPreset(parsed)
    this.log.info(
      { event: 'agent.provider_credential.cleared', presetId: parsed, providerId },
      'Cleared Agent provider credential'
    )
    return this.snapshot()
  }

  async login(
    presetId: string,
    type: AuthType,
    interaction: AuthInteraction
  ): Promise<AgentProviderCatalog> {
    const parsed = agentPresetIdSchema.parse(presetId)
    const models = await this.#buildModels()
    const providerId = await this.#runtimeProviderId(parsed)
    const provider = models.getProvider(providerId)
    if (provider === undefined) throw new Error('Agent provider preset does not exist')
    await this.#ensureProviderRecord(provider, parsed)
    await models.login(providerId, type, interaction)
    this.log.info(
      {
        event: 'agent.provider_auth.login_completed',
        presetId: parsed,
        providerId,
        authType: type
      },
      'Agent provider login completed'
    )
    return this.snapshot()
  }

  async resolve(selection: AgentModelSelection): Promise<ResolvedAgentCatalogModel> {
    const parsed = agentModelSelectionSchema.parse(selection)
    const models = await this.#buildModels()
    await models.refresh({ allowNetwork: false })
    const providerId = await this.#runtimeProviderId(parsed.presetId)
    const provider = models.getProvider(providerId)
    const model = models.getModel(providerId, parsed.modelId)
    if (provider === undefined || model === undefined) {
      throw new Error('Selected Agent model is unavailable')
    }
    const auth = await models.getAuth(model)
    if (auth === undefined) throw new Error('Selected Agent provider is not authenticated')
    if (!(await this.#providerEnabled(parsed.presetId, true))) {
      throw new Error('Selected Agent provider is disabled')
    }
    if (!(await this.#modelEnabled(parsed.presetId, parsed.modelId))) {
      throw new Error('Selected Agent model is disabled')
    }
    const custom = await this.#customPreset(parsed.presetId)
    return {
      presetId: parsed.presetId,
      presetName: custom?.name ?? provider.name,
      providerId,
      timeoutMs: custom?.timeoutMs ?? 60_000,
      model,
      auth
    }
  }

  async #buildModels() {
    const models = createModels({
      credentials: this.#credentialStore,
      modelsStore: this.#modelsStore
    })
    for (const provider of builtinProviders()) {
      models.setProvider(await this.#withManualModels(provider, `builtin:${provider.id}`))
    }
    for (const preset of await this.#customPresets()) {
      models.setProvider(
        await this.#withManualModels(createCustomProvider(preset), preset.presetId)
      )
    }
    return models
  }

  async #summarizeProvider(
    provider: Provider,
    models: Models
  ): Promise<AgentProviderPresetSummary> {
    const custom = await this.#customPresetByProviderId(provider.id)
    const presetId = custom?.presetId ?? `builtin:${provider.id}`
    let authConfigured = false
    let authSource: string | null = null
    try {
      const auth = await models.checkAuth(provider.id)
      authConfigured = auth !== undefined
      authSource = auth?.source ?? null
    } catch (err) {
      this.log.warn(
        { event: 'agent.provider_auth.check_failed', err, providerId: provider.id },
        'Agent provider authentication check failed'
      )
    }
    const catalog = await this.#modelsStore.status(provider.id)
    const isDynamic = provider.refreshModels !== undefined
    const enabled = await this.#providerEnabled(presetId, authConfigured)
    const manualIds = new Set((await this.#manualModels(presetId)).map((model) => model.id))
    const modelSummaries = (
      await Promise.all(
        provider
          .getModels()
          .slice(0, MAX_MODELS)
          .map(async (model) => {
            const parsed = piApiSchema.safeParse(model.api)
            if (!parsed.success) return null
            return agentModelSummarySchema.parse({
              id: model.id,
              name: model.name,
              api: parsed.data,
              enabled: await this.#modelEnabled(presetId, model.id),
              source: manualIds.has(model.id)
                ? 'manual'
                : custom === null && !isDynamic
                  ? 'packaged'
                  : 'discovered',
              reasoning: model.reasoning,
              input: model.input,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
              metadataVerified: custom === null && !manualIds.has(model.id)
            })
          })
      )
    ).filter((model): model is NonNullable<typeof model> => model !== null)
    return {
      presetId,
      kind: custom === null ? 'builtin' : 'custom',
      providerId: provider.id,
      name: custom?.name ?? provider.name,
      logoId: resolveModelsDevProviderLogoId({
        providerId: provider.id,
        name: custom?.name ?? provider.name,
        ...(custom?.baseUrl === undefined ? {} : { baseUrl: custom.baseUrl }),
        logoOverrideId: custom?.logoOverrideId ?? null
      }),
      logoOverrideId: custom?.logoOverrideId ?? null,
      enabled,
      canRefresh: isDynamic,
      endpointEditable: custom !== null,
      ...(custom === null ? {} : { baseUrl: custom.baseUrl, api: custom.api }),
      authMethods:
        custom === null
          ? [
              ...(provider.auth.apiKey?.login === undefined
                ? ['ambient' as const]
                : ['api_key' as const]),
              ...(provider.auth.oauth === undefined ? [] : ['oauth' as const])
            ]
          : [custom.authMode],
      authConfigured,
      authSource,
      catalogStatus:
        custom === null && !isDynamic
          ? 'packaged'
          : catalog.lastErrorCode !== null && provider.getModels().length > 0
            ? 'stale'
            : provider.getModels().length > 0
              ? 'current'
              : 'empty',
      checkedAt: catalog.checkedAt,
      lastErrorCode: catalog.lastErrorCode,
      models: modelSummaries
    }
  }

  async #withManualModels(provider: Provider, presetId: string): Promise<Provider> {
    const manualModels = await this.#manualModels(presetId)
    if (manualModels.length === 0) return provider
    const getModels = (): readonly Model<Api>[] => {
      const current = provider.getModels()
      const merged = new Map(current.map((model) => [model.id, model]))
      for (const manual of manualModels) {
        const template = current.find((model) => model.api === manual.api)
        const baseUrl = template?.baseUrl ?? provider.baseUrl
        if (baseUrl === undefined) continue
        merged.set(manual.id, {
          id: manual.id,
          name: manual.name,
          api: manual.api,
          provider: provider.id,
          baseUrl,
          reasoning: manual.reasoning,
          input: manual.input,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: manual.contextWindow,
          maxTokens: manual.maxTokens,
          ...(template?.compat === undefined ? {} : { compat: template.compat })
        })
      }
      return [...merged.values()]
    }
    return {
      id: provider.id,
      name: provider.name,
      ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
      ...(provider.headers === undefined ? {} : { headers: provider.headers }),
      auth: provider.auth,
      getModels,
      ...(provider.refreshModels === undefined
        ? {}
        : { refreshModels: (context) => provider.refreshModels?.(context) ?? Promise.resolve() }),
      ...(provider.filterModels === undefined
        ? {}
        : {
            filterModels: (models, credential) =>
              provider.filterModels?.(models, credential) ?? models
          }),
      stream: (model, context, options) => provider.stream(model, context, options),
      streamSimple: (model, context, options) => provider.streamSimple(model, context, options)
    }
  }

  async #provider(presetId: string): Promise<Provider> {
    if (presetId.startsWith('builtin:')) {
      const providerId = presetId.slice('builtin:'.length)
      const provider = builtinProviders().find((candidate) => candidate.id === providerId)
      if (provider === undefined) throw new Error('Agent provider preset does not exist')
      return provider
    }
    const custom = await this.#customPreset(presetId)
    if (custom === null) throw new Error('Agent provider preset does not exist')
    return createCustomProvider(custom)
  }

  async #providerEnabled(presetId: string, fallback: boolean): Promise<boolean> {
    const row = await this.database.kysely
      .selectFrom('agent_provider_preferences')
      .select('enabled')
      .where('provider_config_id', '=', `agent:${presetId}`)
      .executeTakeFirst()
    return row === undefined ? fallback : row.enabled === 1
  }

  async #modelEnabled(presetId: string, modelId: string): Promise<boolean> {
    const row = await this.database.kysely
      .selectFrom('agent_model_preferences')
      .select('enabled')
      .where('provider_config_id', '=', `agent:${presetId}`)
      .where('model_id', '=', modelId)
      .executeTakeFirst()
    return row?.enabled !== 0
  }

  async #manualModels(presetId: string): Promise<AgentManualModel[]> {
    const rows = await this.database.kysely
      .selectFrom('agent_model_preferences')
      .select(['model_id', 'manual_model_json'])
      .where('provider_config_id', '=', `agent:${presetId}`)
      .where('manual_model_json', 'is not', null)
      .execute()
    return rows.flatMap((row) => {
      try {
        return [agentManualModelSchema.parse(JSON.parse(row.manual_model_json ?? 'null'))]
      } catch (err) {
        this.log.error(
          { event: 'agent.manual_model.invalid', err, presetId, modelId: row.model_id },
          'Stored manual Agent model is invalid'
        )
        return []
      }
    })
  }

  async #manualModelRecord(
    presetId: string,
    modelId: string
  ): Promise<{ manual_model_json: string | null } | null> {
    return (
      (await this.database.kysely
        .selectFrom('agent_model_preferences')
        .select('manual_model_json')
        .where('provider_config_id', '=', `agent:${presetId}`)
        .where('model_id', '=', modelId)
        .executeTakeFirst()) ?? null
    )
  }

  async #clearDefaultForPreset(presetId: string): Promise<void> {
    const selection = await this.settings.getDefaultAgentModelSelection()
    if (selection?.presetId === presetId) {
      await this.settings.setDefaultAgentModelSelection(null)
    }
  }

  async #clearDefaultForModel(presetId: string, modelId: string): Promise<void> {
    const selection = await this.settings.getDefaultAgentModelSelection()
    if (selection?.presetId === presetId && selection.modelId === modelId) {
      await this.settings.setDefaultAgentModelSelection(null)
    }
  }

  async #customPresets(): Promise<CustomPreset[]> {
    const rows = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', 'like', 'agent:custom:%')
      .execute()
    return rows.flatMap((row) => {
      try {
        return [customPresetSchema.parse(JSON.parse(row.config_json))]
      } catch (err) {
        this.log.error(
          { event: 'agent.provider_preset.invalid', err },
          'Stored Agent provider preset is invalid'
        )
        return []
      }
    })
  }

  async #customPreset(presetId: string): Promise<CustomPreset | null> {
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', `agent:${presetId}`)
      .executeTakeFirst()
    if (row === undefined) return null
    const parsed = customPresetSchema.safeParse(JSON.parse(row.config_json))
    return parsed.success ? parsed.data : null
  }

  async #customPresetByProviderId(providerId: string): Promise<CustomPreset | null> {
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('provider', '=', providerId)
      .where('id', 'like', 'agent:custom:%')
      .executeTakeFirst()
    if (row === undefined) return null
    const parsed = customPresetSchema.safeParse(JSON.parse(row.config_json))
    return parsed.success ? parsed.data : null
  }

  async #runtimeProviderId(presetId: string): Promise<string> {
    if (presetId.startsWith('builtin:')) return presetId.slice('builtin:'.length)
    const custom = await this.#customPreset(presetId)
    if (custom === null) throw new Error('Agent provider preset does not exist')
    return custom.providerId
  }

  async #providerConfigId(providerId: string): Promise<string> {
    const custom = await this.#customPresetByProviderId(providerId)
    return custom === null ? `agent:builtin:${providerId}` : `agent:${custom.presetId}`
  }

  async #ensureProviderRecord(provider: Provider, presetId: string): Promise<void> {
    if (!presetId.startsWith('builtin:')) return
    const id = `agent:${presetId}`
    const now = this.now().toISOString()
    const config = builtinPresetSchema.parse({
      schemaVersion: 1,
      role: 'agent-preset',
      kind: 'builtin',
      presetId,
      providerId: provider.id,
      name: provider.name
    })
    await this.database.kysely
      .insertInto('provider_configs')
      .values({
        id,
        provider: provider.id,
        config_json: JSON.stringify(config),
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute()
  }

  async #migrateLegacyAgentConfig(): Promise<void> {
    const providerConfigId = MIGRATED_LEGACY_AGENT_PROVIDER_CONFIG_ID
    const alreadyMigrated = await this.database.kysely
      .selectFrom('provider_configs')
      .select('id')
      .where('id', '=', providerConfigId)
      .executeTakeFirst()
    if (alreadyMigrated !== undefined) return
    const legacy = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['provider', 'config_json', 'created_at'])
      .where('id', '=', LEGACY_AGENT_PROVIDER_CONFIG_ID)
      .executeTakeFirst()
    if (legacy === undefined) return
    let config: ReturnType<typeof providerConfigSchema.parse>
    try {
      config = providerConfigSchema.parse(JSON.parse(legacy.config_json))
    } catch (err) {
      this.log.error(
        { event: 'agent.provider_preset.legacy_invalid', err },
        'Legacy Agent provider configuration is invalid'
      )
      return
    }
    if (config.role !== 'agent' || config.baseUrl === undefined) return
    const api = customAgentPiApiSchema.safeParse(config.api ?? 'openai-completions')
    if (!api.success) return
    const presetId = LEGACY_AGENT_PRESET_ID
    const providerId = `writellm-${presetId}`
    const now = this.now().toISOString()
    const migrated = customPresetSchema.parse({
      schemaVersion: 1,
      role: 'agent-preset',
      kind: 'custom',
      presetId,
      providerId,
      name: 'Legacy Agent',
      baseUrl: config.baseUrl,
      api: api.data,
      authMode: 'api_key',
      timeoutMs: config.timeoutMs
    })
    const model = cachedModelSchema.parse({
      id: config.model,
      name: config.modelName ?? config.model,
      api: api.data,
      provider: providerId,
      baseUrl: config.baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: config.contextWindowTokens ?? 131_072,
      maxTokens: 8_192
    })
    await this.database.kysely.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom('provider_configs')
        .select('id')
        .where('id', '=', providerConfigId)
        .executeTakeFirst()
      if (existing !== undefined) return
      await transaction
        .insertInto('provider_configs')
        .values({
          id: providerConfigId,
          provider: providerId,
          config_json: JSON.stringify(migrated),
          created_at: legacy.created_at,
          updated_at: now
        })
        .execute()
      const credential = await transaction
        .selectFrom('encrypted_credentials')
        .select('ciphertext')
        .where('provider_config_id', '=', LEGACY_AGENT_PROVIDER_CONFIG_ID)
        .executeTakeFirst()
      if (credential !== undefined) {
        await this.credentials.persistEncrypted(
          providerConfigId,
          credential.ciphertext,
          transaction
        )
      }
      await transaction
        .insertInto('agent_model_catalogs')
        .values({
          provider_config_id: providerConfigId,
          models_json: JSON.stringify([model]),
          checked_at: now,
          last_attempted_at: now,
          last_error_code: null,
          created_at: now,
          updated_at: now
        })
        .execute()
    })
    if ((await this.settings.getDefaultAgentModelSelection()) === null) {
      await this.settings.setDefaultAgentModelSelection({ presetId, modelId: config.model })
    }
    this.log.info(
      { event: 'agent.provider_preset.legacy_migrated', presetId },
      'Migrated legacy Agent provider configuration'
    )
  }
}

function createCustomProvider(preset: CustomPreset): Provider {
  return createProvider({
    id: preset.providerId,
    name: preset.name,
    baseUrl: preset.baseUrl,
    auth: {
      apiKey: {
        name: `${preset.name} API key`,
        resolve: async ({ credential }) => {
          if (preset.authMode === 'none') return { auth: {}, source: 'No authentication' }
          if (credential?.type !== 'api_key' || !credential.key) return undefined
          return { auth: { apiKey: credential.key }, source: 'Stored API key' }
        }
      }
    },
    models: [],
    fetchModels: (context) => fetchCustomModels(preset, context.credential, context.signal),
    api: {
      stream: () => {
        throw new Error('Catalog-only provider cannot stream in Main')
      },
      streamSimple: () => {
        throw new Error('Catalog-only provider cannot stream in Main')
      }
    }
  })
}

async function fetchCustomModels(
  preset: CustomPreset,
  credential: Credential | undefined,
  signal?: AbortSignal
): Promise<Model<Api>[]> {
  const url = modelListUrl(preset)
  const headers = new Headers({ accept: 'application/json' })
  const apiKey = credential?.type === 'api_key' ? credential.key : undefined
  if (apiKey !== undefined) {
    if (preset.api === 'google-generative-ai') headers.set('x-goog-api-key', apiKey)
    else if (preset.api === 'anthropic-messages') {
      headers.set('x-api-key', apiKey)
      headers.set('anthropic-version', '2023-06-01')
    } else if (preset.api === 'azure-openai-responses') headers.set('api-key', apiKey)
    else headers.set('authorization', `Bearer ${apiKey}`)
  }
  const response = await fetchConfiguredEndpoint(url, { headers, signal })
  if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}`)
  const text = await readBoundedText(response, MAX_CATALOG_BYTES)
  const parsed = JSON.parse(text) as unknown
  const entries = discoveryEntries(parsed)
  if (entries.length === 0) throw new Error('Model discovery returned no models')
  return entries.slice(0, MAX_MODELS).map((entry) => ({
    id: entry.id,
    name: entry.name,
    api: preset.api,
    provider: preset.providerId,
    baseUrl: preset.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 8_192,
    ...(preset.api === 'openai-completions'
      ? { compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }
      : {})
  }))
}

function discoveryEntries(value: unknown): Array<{ id: string; name: string }> {
  if (value === null || typeof value !== 'object') return []
  const candidates =
    'data' in value && Array.isArray(value.data)
      ? value.data
      : 'models' in value && Array.isArray(value.models)
        ? value.models
        : []
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') continue
    const rawId =
      'id' in candidate && typeof candidate.id === 'string'
        ? candidate.id
        : 'name' in candidate && typeof candidate.name === 'string'
          ? candidate.name.replace(/^models\//, '')
          : null
    if (rawId === null) continue
    const id = rawId.trim()
    if (id.length === 0 || id.length > 500 || seen.has(id)) continue
    const name =
      'displayName' in candidate && typeof candidate.displayName === 'string'
        ? candidate.displayName.trim()
        : id
    seen.add(id)
    result.push({ id, name: name.length > 0 && name.length <= 500 ? name : id })
  }
  return result
}

function modelListUrl(preset: CustomPreset): URL {
  const base = `${preset.baseUrl.replace(/\/+$/, '')}/`
  if (preset.api === 'google-generative-ai') return new URL('models', base)
  return new URL('models', base)
}

class DatabaseModelsStore implements ModelsStore {
  constructor(
    private readonly database: AppDatabase,
    private readonly log: Pick<Logger, 'error'>,
    private readonly now: () => Date
  ) {}

  async read(providerId: string) {
    const providerConfigId = await this.#providerConfigId(providerId)
    if (providerConfigId === null) return undefined
    const row = await this.database.kysely
      .selectFrom('agent_model_catalogs')
      .select(['models_json', 'checked_at'])
      .where('provider_config_id', '=', providerConfigId)
      .executeTakeFirst()
    if (row === undefined) return undefined
    try {
      const models = cachedModelsSchema.parse(JSON.parse(row.models_json)) as Model<Api>[]
      return {
        models,
        ...(row.checked_at === null ? {} : { checkedAt: Date.parse(row.checked_at) })
      }
    } catch (err) {
      this.log.error(
        { event: 'agent.model_catalog.invalid', err, providerId },
        'Stored Agent model catalog is invalid'
      )
      return undefined
    }
  }

  async write(providerId: string, entry: { models: readonly Model<Api>[]; checkedAt?: number }) {
    const providerConfigId = await this.#providerConfigId(providerId)
    if (providerConfigId === null) throw new Error('Agent provider record is missing')
    const models = cachedModelsSchema.parse(entry.models)
    const modelsJson = JSON.stringify(models)
    if (new TextEncoder().encode(modelsJson).byteLength > MAX_CATALOG_BYTES) {
      throw new Error('Agent model catalog is too large')
    }
    const now = this.now().toISOString()
    const checkedAt = entry.checkedAt === undefined ? now : new Date(entry.checkedAt).toISOString()
    await this.database.kysely
      .insertInto('agent_model_catalogs')
      .values({
        provider_config_id: providerConfigId,
        models_json: modelsJson,
        checked_at: checkedAt,
        last_attempted_at: now,
        last_error_code: null,
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) =>
        conflict.column('provider_config_id').doUpdateSet({
          models_json: modelsJson,
          checked_at: checkedAt,
          last_attempted_at: now,
          last_error_code: null,
          updated_at: now
        })
      )
      .execute()
  }

  async delete(providerId: string): Promise<void> {
    const providerConfigId = await this.#providerConfigId(providerId)
    if (providerConfigId === null) return
    await this.database.kysely
      .deleteFrom('agent_model_catalogs')
      .where('provider_config_id', '=', providerConfigId)
      .execute()
  }

  scoped(providerId: string): ProviderModelsStore {
    return {
      read: () => this.read(providerId),
      write: (entry) => this.write(providerId, entry),
      delete: () => this.delete(providerId)
    }
  }

  async status(providerId: string): Promise<{
    checkedAt: string | null
    lastErrorCode: string | null
  }> {
    const providerConfigId = await this.#providerConfigId(providerId)
    if (providerConfigId === null) return { checkedAt: null, lastErrorCode: null }
    const row = await this.database.kysely
      .selectFrom('agent_model_catalogs')
      .select(['checked_at', 'last_error_code'])
      .where('provider_config_id', '=', providerConfigId)
      .executeTakeFirst()
    return {
      checkedAt: row?.checked_at ?? null,
      lastErrorCode: row?.last_error_code ?? null
    }
  }

  async recordAttempt(
    providerId: string,
    attemptedAt: string,
    errorCode: string | null
  ): Promise<void> {
    const providerConfigId = await this.#providerConfigId(providerId)
    if (providerConfigId === null) return
    await this.database.kysely
      .updateTable('agent_model_catalogs')
      .set({
        last_attempted_at: attemptedAt,
        last_error_code: errorCode,
        updated_at: attemptedAt
      })
      .where('provider_config_id', '=', providerConfigId)
      .execute()
  }

  async #providerConfigId(providerId: string): Promise<string | null> {
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('id')
      .where('provider', '=', providerId)
      .where('id', 'like', 'agent:%')
      .executeTakeFirst()
    return row?.id ?? null
  }
}

function safeRefreshErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  if (error instanceof Error && /HTTP \d{3}/.test(error.message)) return 'provider_rejected'
  return 'refresh_failed'
}

export function isBuiltinProviderId(value: string): value is BuiltinProvider {
  return builtinProviders().some((provider) => provider.id === value)
}
