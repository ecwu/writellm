import type { Logger } from 'pino'
import type { AuthInteraction, AuthType } from '@earendil-works/pi-ai'
import { randomUUID } from 'node:crypto'
import {
  BUILTIN_IMAGE_MODELS,
  IMAGE_TRANSPORT_LABELS,
  OFFICIAL_IMAGE_BASE_URLS,
  imageProviderIdSchema,
  imageSourceConfigSchema,
  providerConfigSchema,
  type ProviderConfig,
  type ProviderConfigForRole,
  type ProviderConnectionTestResult,
  type AgentCustomPresetInput,
  type AgentManualModel,
  type AgentModelSelection,
  type ImageModelDefinition,
  type ImageModelSelection,
  type ImageModelSummary,
  type ImageProviderConfig,
  type ImageProviderId,
  type ImageSourceConfig,
  type ImageSourceSaveInput,
  type ImageSourceStatus,
  type ProviderRole,
  type ProviderSettingsSnapshot
} from '../../shared/contracts/providers'
import type { AppDatabase } from '../app-db/connection'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import { getProviderCapability, providerRoles } from './capability-registry'
import { type CredentialService, CredentialUnavailableError } from './credential-service'
import type { AgentProviderCatalogService } from './agent-provider-catalog'
import { credentialBindingFingerprint } from './credential-binding'

type AgentCatalog = Pick<
  AgentProviderCatalogService,
  | 'snapshot'
  | 'saveCustomPreset'
  | 'removePreset'
  | 'refreshPreset'
  | 'setDefaultSelection'
  | 'setProviderEnabled'
  | 'setModelEnabled'
  | 'saveManualModel'
  | 'removeManualModel'
  | 'setApiKey'
  | 'clearCredential'
  | 'login'
>

export interface ConnectionProbeResult {
  invalidResponse?: true
  status: number
  providerCode?: string
}

export type ConnectionProbe = (
  config: ProviderConfig,
  credential: string | undefined,
  signal: AbortSignal
) => Promise<ConnectionProbeResult>

export class ProviderService {
  #agentCatalog: AgentCatalog | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly credentials: CredentialService,
    private readonly settings: Pick<
      AppSettingsRepository,
      'getImageDefaultSelection' | 'setImageDefaultSelection'
    >,
    private readonly log: Logger,
    private readonly probe: ConnectionProbe,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createImageSourceId: () => string = () => `img-${randomUUID()}`
  ) {}

  setAgentCatalog(catalog: AgentCatalog): void {
    this.#agentCatalog = catalog
  }

  async snapshot(): Promise<ProviderSettingsSnapshot> {
    const rows = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['id', 'provider', 'config_json', 'created_at'])
      .orderBy('created_at')
      .orderBy('id')
      .execute()
    const byRole = new Map(rows.map((row) => [row.id, row]))
    const credentialBackend = this.credentials.backendStatus()
    const imageSources = (
      await Promise.all(
        rows
          .filter((row) => row.id.startsWith(IMAGE_CONFIG_PREFIX))
          .map((row) => this.#imageSourceStatus(row))
      )
    ).filter((source): source is ImageSourceStatus => source !== null)
    const defaultSelection = await this.settings.getImageDefaultSelection()
    let defaultImage: { config: ImageProviderConfig | null; issues: string[] }
    try {
      defaultImage = { config: await this.resolveImageSelection(defaultSelection), issues: [] }
    } catch (err) {
      if (!(err instanceof ImageSelectionError)) throw err
      // A missing or unusable default is a normal configuration state reported as an issue.
      this.log.debug(
        { event: 'provider.image.default_unavailable', err },
        'Default image model is unavailable'
      )
      defaultImage = { config: null, issues: [err.message] }
    }
    const defaultSource = imageSources.find(
      (source) => source.sourceId === defaultSelection?.sourceId
    )
    const providers = await Promise.all(
      providerRoles.map(async (role) => {
        if (role === 'image') {
          return {
            role,
            capability: imageProviderCapability(defaultSource?.providerId ?? 'google-gemini'),
            config: defaultImage.config,
            configured: defaultSource?.configured ?? false,
            available: defaultImage.config !== null && (defaultSource?.available ?? false),
            issues: [...defaultImage.issues, ...(defaultSource?.issues ?? [])]
          }
        }
        const capability = getProviderCapability(role)
        const row = byRole.get(role)
        const issues: string[] = []
        let config: ProviderConfig | null = null
        if (row !== undefined) {
          try {
            const parsed = providerConfigSchema.parse(JSON.parse(row.config_json))
            if (parsed.role !== role || parsed.providerId !== row.provider) {
              issues.push('Stored provider identity does not match its role.')
            } else {
              config = parsed
            }
          } catch (err) {
            this.log.error(
              { event: 'provider.config.invalid', err, role },
              'Stored provider configuration failed validation'
            )
            issues.push('Stored provider configuration is invalid.')
          }
        }
        const configured = await this.credentials.hasCredential(role)
        if (config !== null && !configured) issues.push('Provider credential is missing.')
        if (config !== null && !credentialBackend.securePersistence) {
          issues.push(credentialBackend.warning ?? 'Secure credential storage is unavailable.')
        }
        return {
          role,
          capability,
          config,
          configured,
          available: config !== null && configured && credentialBackend.securePersistence,
          issues
        }
      })
    )
    return {
      credentialBackend,
      providers,
      imageCatalog: { defaultSelection, sources: imageSources },
      agentCatalog:
        this.#agentCatalog === null
          ? { presets: [], defaultSelection: null }
          : await this.#agentCatalog.snapshot()
    }
  }

  async saveAgentCustomPreset(input: AgentCustomPresetInput): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().saveCustomPreset(input)
    return this.snapshot()
  }

  async removeAgentPreset(presetId: string): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().removePreset(presetId)
    return this.snapshot()
  }

  async refreshAgentPreset(
    presetId: string,
    signal: AbortSignal
  ): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().refreshPreset(presetId, signal)
    return this.snapshot()
  }

  async setAgentDefaultSelection(
    selection: AgentModelSelection | null
  ): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().setDefaultSelection(selection)
    return this.snapshot()
  }

  async setAgentProviderEnabled(
    presetId: string,
    enabled: boolean
  ): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().setProviderEnabled(presetId, enabled)
    return this.snapshot()
  }

  async setAgentModelEnabled(
    presetId: string,
    modelId: string,
    enabled: boolean
  ): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().setModelEnabled(presetId, modelId, enabled)
    return this.snapshot()
  }

  async saveAgentManualModel(
    presetId: string,
    model: AgentManualModel
  ): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().saveManualModel(presetId, model)
    return this.snapshot()
  }

  async removeAgentManualModel(
    presetId: string,
    modelId: string
  ): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().removeManualModel(presetId, modelId)
    return this.snapshot()
  }

  async setAgentApiKey(presetId: string, apiKey: string): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().setApiKey(presetId, apiKey)
    return this.snapshot()
  }

  async clearAgentCredential(presetId: string): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().clearCredential(presetId)
    return this.snapshot()
  }

  async loginAgentPreset(
    presetId: string,
    type: AuthType,
    interaction: AuthInteraction
  ): Promise<ProviderSettingsSnapshot> {
    await this.#agentCatalogService().login(presetId, type, interaction)
    return this.snapshot()
  }

  async save(config: ProviderConfig, apiKey?: string): Promise<ProviderSettingsSnapshot> {
    const parsed = providerConfigSchema.parse(config)
    if (parsed.role === 'image') {
      throw new Error('Image sources are saved through the image source catalog')
    }
    const capability = getProviderCapability(parsed.role)
    if (parsed.batchLimit > capability.maxBatchSize) {
      throw new Error(`${capability.label} batch limit exceeds its registered capability`)
    }
    if (
      capability.maxFileSizeMb !== null &&
      parsed.fileSizeLimitMb !== null &&
      parsed.fileSizeLimitMb > capability.maxFileSizeMb
    ) {
      throw new Error(`${capability.label} file limit exceeds its registered capability`)
    }
    const { securityIdentityChanged, credentialReplaced } = await this.#persistConfig(
      parsed.role,
      parsed.providerId,
      parsed,
      apiKey,
      false
    )
    this.log.info(
      {
        event: 'provider.config.saved',
        role: parsed.role,
        providerId: parsed.providerId,
        securityIdentityChanged,
        credentialReplaced
      },
      'Provider configuration saved'
    )
    return this.snapshot()
  }

  async remove(role: Exclude<ProviderRole, 'image'>): Promise<ProviderSettingsSnapshot> {
    await this.database.kysely.deleteFrom('provider_configs').where('id', '=', role).execute()
    this.log.info({ event: 'provider.config.removed', role }, 'Provider configuration removed')
    return this.snapshot()
  }

  async saveImageSource(input: ImageSourceSaveInput): Promise<ProviderSettingsSnapshot> {
    const draft = input.source
    if (draft.providerId === 'google-vertex' && input.apiKey !== undefined) {
      throw new Error('Google Vertex AI uses local Application Default Credentials')
    }
    let previous: ImageSourceConfig | null = null
    let sourceId: string
    if (input.sourceId !== undefined) {
      sourceId = input.sourceId
      previous = await this.#requireImageSource(sourceId)
      if (previous.providerId !== draft.providerId) {
        throw new Error('An image source cannot change its transport')
      }
    } else {
      const count = await this.database.kysely
        .selectFrom('provider_configs')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('id', 'like', `${IMAGE_CONFIG_PREFIX}%`)
        .executeTakeFirstOrThrow()
      if (Number(count.count) >= MAX_IMAGE_SOURCES) {
        throw new Error(`At most ${MAX_IMAGE_SOURCES} image sources can be configured`)
      }
      sourceId = this.createImageSourceId()
    }
    const base = previous ?? {
      role: 'image' as const,
      sourceId,
      timeoutMs: 120_000,
      batchLimit: 1,
      embeddingDimension: null,
      fileSizeLimitMb: null,
      defaultAspectRatio: 'auto' as const,
      defaultImageSize: '1K' as const,
      manualModels: [],
      disabledModelIds: []
    }
    const { baseUrl: _previousBaseUrl, ...withoutEndpoint } = base as typeof base & {
      baseUrl?: string
    }
    let next: ImageSourceConfig
    if (draft.providerId === 'google-vertex') {
      next = imageSourceConfigSchema.parse({
        ...withoutEndpoint,
        providerId: draft.providerId,
        name: draft.name,
        projectId: draft.projectId,
        location: 'global'
      })
    } else if (draft.providerId === 'openai' || draft.providerId === 'xai') {
      const baseUrl =
        draft.baseUrl === undefined || draft.baseUrl === OFFICIAL_IMAGE_BASE_URLS[draft.providerId]
          ? undefined
          : draft.baseUrl
      next = imageSourceConfigSchema.parse({
        ...withoutEndpoint,
        providerId: draft.providerId,
        name: draft.name,
        ...(baseUrl === undefined ? {} : { baseUrl })
      })
    } else {
      next = imageSourceConfigSchema.parse({
        ...withoutEndpoint,
        providerId: draft.providerId,
        name: draft.name
      })
    }
    const configId = imageProviderConfigId(sourceId)
    const { securityIdentityChanged, credentialReplaced } = await this.#persistConfig(
      configId,
      next.providerId,
      next,
      input.apiKey,
      next.providerId === 'google-vertex'
    )
    this.log.info(
      {
        event: 'provider.image_source.saved',
        sourceId,
        providerId: next.providerId,
        created: previous === null,
        customEndpoint: 'baseUrl' in next && next.baseUrl !== undefined,
        securityIdentityChanged,
        credentialReplaced
      },
      'Image source saved'
    )
    if ((await this.settings.getImageDefaultSelection()) === null) {
      const firstModel = enabledImageModels(next)[0]
      if (firstModel !== undefined && (await this.#imageSourceUsable(configId, next))) {
        await this.settings.setImageDefaultSelection({ sourceId, modelId: firstModel.id })
        this.log.info(
          { event: 'provider.image.default_initialized', sourceId, modelId: firstModel.id },
          'Initialized the default image model'
        )
      }
    }
    return this.snapshot()
  }

  async removeImageSource(sourceId: string): Promise<ProviderSettingsSnapshot> {
    await this.database.kysely
      .deleteFrom('provider_configs')
      .where('id', '=', imageProviderConfigId(sourceId))
      .execute()
    if ((await this.settings.getImageDefaultSelection())?.sourceId === sourceId) {
      await this.settings.setImageDefaultSelection(null)
    }
    this.log.info({ event: 'provider.image_source.removed', sourceId }, 'Image source removed')
    return this.snapshot()
  }

  async saveImageManualModel(
    sourceId: string,
    model: ImageModelDefinition
  ): Promise<ProviderSettingsSnapshot> {
    const config = await this.#requireImageSource(sourceId)
    if (BUILTIN_IMAGE_MODELS[config.providerId].some((builtin) => builtin.id === model.id)) {
      throw new Error('Built-in image models cannot be replaced')
    }
    const exists = config.manualModels.some((item) => item.id === model.id)
    await this.#updateImageSource({
      ...config,
      manualModels: exists
        ? config.manualModels.map((item) => (item.id === model.id ? model : item))
        : [...config.manualModels, model]
    })
    this.log.info(
      { event: 'provider.image_model.saved', sourceId, modelId: model.id, created: !exists },
      'Manual image model saved'
    )
    return this.snapshot()
  }

  async removeImageManualModel(
    sourceId: string,
    modelId: string
  ): Promise<ProviderSettingsSnapshot> {
    const config = await this.#requireImageSource(sourceId)
    await this.#updateImageSource({
      ...config,
      manualModels: config.manualModels.filter((item) => item.id !== modelId),
      disabledModelIds: config.disabledModelIds.filter((id) => id !== modelId)
    })
    await this.#clearDefaultIfSelected(sourceId, modelId)
    this.log.info(
      { event: 'provider.image_model.removed', sourceId, modelId },
      'Manual image model removed'
    )
    return this.snapshot()
  }

  async setImageModelEnabled(
    sourceId: string,
    modelId: string,
    enabled: boolean
  ): Promise<ProviderSettingsSnapshot> {
    const config = await this.#requireImageSource(sourceId)
    if (!allImageModels(config).some((model) => model.id === modelId)) {
      throw new Error('Image model is not part of this source')
    }
    const disabled = config.disabledModelIds.filter((id) => id !== modelId)
    await this.#updateImageSource({
      ...config,
      disabledModelIds: enabled ? disabled : [...disabled, modelId]
    })
    if (!enabled) await this.#clearDefaultIfSelected(sourceId, modelId)
    this.log.info(
      { event: 'provider.image_model.enabled_changed', sourceId, modelId, enabled },
      'Image model availability changed'
    )
    return this.snapshot()
  }

  async setImageDefaultSelection(
    selection: ImageModelSelection | null
  ): Promise<ProviderSettingsSnapshot> {
    if (selection !== null) await this.resolveImageSelection(selection)
    await this.settings.setImageDefaultSelection(selection)
    this.log.info(
      {
        event: 'provider.image.default_changed',
        sourceId: selection?.sourceId ?? null,
        modelId: selection?.modelId ?? null
      },
      'Default image model changed'
    )
    return this.snapshot()
  }

  /**
   * Resolves an explicit selection, or the global default when none is given, into the runtime
   * configuration for one request. Never substitutes another source or model (ADR 093).
   */
  async resolveImageSelection(
    selection?: ImageModelSelection | null
  ): Promise<ImageProviderConfig> {
    const effective = selection ?? (await this.settings.getImageDefaultSelection())
    if (effective === null) throw new ImageSelectionError('No image model is selected.')
    const configId = imageProviderConfigId(effective.sourceId)
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['provider', 'config_json'])
      .where('id', '=', configId)
      .executeTakeFirst()
    if (row === undefined) throw new ImageSelectionError('The selected image source was removed.')
    const config = this.#parseImageSource(row, effective.sourceId)
    if (config === null) {
      throw new ImageSelectionError('The selected image source configuration is invalid.')
    }
    const model = enabledImageModels(config).find((item) => item.id === effective.modelId)
    if (model === undefined) {
      throw new ImageSelectionError('The selected image model is unavailable or disabled.')
    }
    if (!(await this.#imageSourceUsable(configId, config))) {
      throw new ImageSelectionError('The selected image source is not authenticated.')
    }
    return imageRuntimeConfig(config, model)
  }

  async withImageProvider<T>(
    selection: ImageModelSelection | null | undefined,
    operation: (config: ImageProviderConfig, credential: string | undefined) => Promise<T>
  ): Promise<T> {
    const config = await this.resolveImageSelection(selection)
    if (config.providerId === 'google-vertex') return operation(config, undefined)
    return this.credentials.withCredential(imageProviderConfigId(config.sourceId), (credential) =>
      operation(config, credential)
    )
  }

  async withConfiguredProvider<R extends ProviderRole, T>(
    role: R,
    operation: (
      config: ProviderConfigForRole<R>,
      credential: R extends 'image' ? string | undefined : string
    ) => Promise<T>
  ): Promise<T> {
    if (role === 'image') {
      return this.withImageProvider(null, (config, credential) =>
        operation(
          config as ProviderConfigForRole<R>,
          credential as R extends 'image' ? string | undefined : string
        )
      )
    }
    const config = await this.getConfiguredProvider(role)
    return this.credentials.withCredential(role, (credential) =>
      operation(config, credential as R extends 'image' ? string | undefined : string)
    )
  }

  async getConfiguredProvider<R extends ProviderRole>(role: R): Promise<ProviderConfigForRole<R>> {
    if (role === 'image') {
      return (await this.resolveImageSelection(null)) as ProviderConfigForRole<R>
    }
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', role)
      .executeTakeFirst()
    if (row === undefined) throw new Error(`${role} provider is not configured`)
    let config: ProviderConfig
    try {
      config = providerConfigSchema.parse(JSON.parse(row.config_json))
      if (config.role !== role) throw new Error('Stored provider role does not match')
    } catch (err) {
      this.log.error(
        { event: 'provider.runtime.config_invalid', err, role },
        'Runtime provider configuration is invalid'
      )
      throw new Error(`${role} provider configuration is invalid`, { cause: err })
    }
    return config as ProviderConfigForRole<R>
  }

  async testConnection(
    role: Exclude<ProviderRole, 'image'>
  ): Promise<ProviderConnectionTestResult> {
    const startedAt = Date.now()
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', role)
      .executeTakeFirst()
    if (row === undefined)
      return result(false, 'missing_config', 'Provider is not configured.', startedAt)

    let config: ProviderConfig
    try {
      config = providerConfigSchema.parse(JSON.parse(row.config_json))
    } catch (err) {
      this.log.error(
        { event: 'provider.connection.config_invalid', err, role },
        'Connection test configuration is invalid'
      )
      return result(false, 'missing_config', 'Provider configuration is invalid.', startedAt)
    }
    return this.#probeConnection(role, config, role, startedAt)
  }

  async testImageSource(sourceId: string, modelId?: string): Promise<ProviderConnectionTestResult> {
    const startedAt = Date.now()
    const configId = imageProviderConfigId(sourceId)
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['provider', 'config_json'])
      .where('id', '=', configId)
      .executeTakeFirst()
    if (row === undefined) {
      return result(false, 'missing_config', 'Image source is not configured.', startedAt)
    }
    const source = this.#parseImageSource(row, sourceId)
    if (source === null) {
      return result(false, 'missing_config', 'Image source configuration is invalid.', startedAt)
    }
    const defaultSelection = await this.settings.getImageDefaultSelection()
    const models = enabledImageModels(source)
    const model =
      models.find((item) => item.id === modelId) ??
      models.find(
        (item) => defaultSelection?.sourceId === sourceId && item.id === defaultSelection.modelId
      ) ??
      models[0]
    if (model === undefined) {
      return result(false, 'missing_config', 'Enable a model before testing.', startedAt)
    }
    return this.#probeConnection('image', imageRuntimeConfig(source, model), configId, startedAt)
  }

  async #probeConnection(
    role: ProviderRole,
    config: ProviderConfig,
    configId: string,
    startedAt: number
  ): Promise<ProviderConnectionTestResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = usesAmbientAuthentication(config)
        ? await this.probe(config, undefined, controller.signal)
        : await this.credentials.withCredential(configId, (credential) =>
            this.probe(config, credential, controller.signal)
          )
      if (
        response.status === 401 ||
        response.status === 403 ||
        isMineruAuthCode(response.providerCode)
      ) {
        return result(
          false,
          'invalid_auth',
          config.role === 'image' && config.providerId === 'google-vertex'
            ? 'Vertex could not use local ADC for this project. Check the active account, project access, and roles/aiplatform.user.'
            : 'Provider rejected the credential.',
          startedAt
        )
      }
      if (response.invalidResponse === true) {
        // The Worker reports the original parser error without the response body.
        return result(
          false,
          'provider_rejected',
          'Provider returned an invalid response.',
          startedAt
        )
      }
      if (response.status >= 200 && response.status < 300) {
        return result(true, 'connected', 'Connection succeeded.', startedAt)
      }
      return result(
        false,
        'provider_rejected',
        `Provider returned HTTP ${response.status}.`,
        startedAt
      )
    } catch (err) {
      if (err instanceof CredentialUnavailableError) {
        return result(false, 'missing_credential', err.message, startedAt)
      }
      if (controller.signal.aborted) {
        this.log.warn(
          { event: 'provider.connection.timeout', err, role },
          'Provider connection timed out'
        )
        return result(false, 'timeout', 'Provider connection timed out.', startedAt)
      }
      this.log.error(
        { event: 'provider.connection.failed', err, role },
        'Provider connection failed'
      )
      return result(false, 'network_error', 'Provider connection failed.', startedAt)
    } finally {
      clearTimeout(timeout)
    }
  }

  async #persistConfig(
    configId: string,
    provider: string,
    config: ProviderConfig | ImageSourceConfig,
    apiKey: string | undefined,
    ambientAuthentication: boolean
  ): Promise<{ securityIdentityChanged: boolean; credentialReplaced: boolean }> {
    if (ambientAuthentication && apiKey !== undefined) {
      throw new Error('Google Vertex AI uses local Application Default Credentials')
    }
    const configJson = JSON.stringify(config)
    const previous = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['provider', 'config_json'])
      .where('id', '=', configId)
      .executeTakeFirst()
    const securityIdentityChanged =
      previous !== undefined &&
      credentialBindingFingerprint({
        providerConfigId: configId,
        provider: previous.provider,
        configJson: previous.config_json
      }) !== credentialBindingFingerprint({ providerConfigId: configId, provider, configJson })
    const ciphertext =
      apiKey === undefined ? undefined : this.credentials.encryptForPersistence(apiKey)
    const now = this.now()
    await this.database.kysely.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('provider_configs')
        .values({
          id: configId,
          provider,
          config_json: configJson,
          created_at: now,
          updated_at: now
        })
        .onConflict((conflict) =>
          conflict.column('id').doUpdateSet({ provider, config_json: configJson, updated_at: now })
        )
        .execute()
      if (ambientAuthentication) {
        await this.credentials.removeCredential(configId, transaction)
      } else if (ciphertext !== undefined) {
        await this.credentials.persistEncrypted(configId, ciphertext, transaction)
      } else if (securityIdentityChanged) {
        await this.credentials.removeCredential(configId, transaction)
      }
      if (securityIdentityChanged && !configId.startsWith(IMAGE_CONFIG_PREFIX)) {
        await transaction
          .deleteFrom('agent_model_catalogs')
          .where('provider_config_id', '=', configId)
          .execute()
      }
    })
    return { securityIdentityChanged, credentialReplaced: ciphertext !== undefined }
  }

  async #updateImageSource(config: ImageSourceConfig): Promise<void> {
    const parsed = imageSourceConfigSchema.parse(config)
    const result = await this.database.kysely
      .updateTable('provider_configs')
      .set({ config_json: JSON.stringify(parsed), updated_at: this.now() })
      .where('id', '=', imageProviderConfigId(parsed.sourceId))
      .where('provider', '=', parsed.providerId)
      .executeTakeFirst()
    if (result.numUpdatedRows !== 1n) throw new Error('Image source is not configured')
  }

  async #requireImageSource(sourceId: string): Promise<ImageSourceConfig> {
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['provider', 'config_json'])
      .where('id', '=', imageProviderConfigId(sourceId))
      .executeTakeFirst()
    if (row === undefined) throw new Error('Image source is not configured')
    const config = this.#parseImageSource(row, sourceId)
    if (config === null) throw new Error('Image source configuration is invalid')
    return config
  }

  #parseImageSource(
    row: { provider: string; config_json: string },
    sourceId: string
  ): ImageSourceConfig | null {
    try {
      const config = imageSourceConfigSchema.parse(JSON.parse(row.config_json))
      if (config.sourceId !== sourceId || config.providerId !== row.provider) {
        throw new Error('Stored image source identity does not match its row')
      }
      return config
    } catch (err) {
      this.log.error(
        { event: 'provider.image_config.invalid', err, sourceId },
        'Stored image source configuration failed validation'
      )
      return null
    }
  }

  async #imageSourceUsable(configId: string, config: ImageSourceConfig): Promise<boolean> {
    if (config.providerId === 'google-vertex') return true
    return (
      (await this.credentials.hasCredential(configId)) &&
      this.credentials.backendStatus().securePersistence
    )
  }

  async #imageSourceStatus(row: {
    id: string
    provider: string
    config_json: string
  }): Promise<ImageSourceStatus | null> {
    const sourceId = row.id.slice(IMAGE_CONFIG_PREFIX.length)
    const providerId = imageProviderIdSchema.safeParse(row.provider)
    if (!providerId.success) {
      this.log.error(
        { event: 'provider.image_source.unknown_transport', err: providerId.error, sourceId },
        'Stored image source uses an unknown transport'
      )
      return null
    }
    const credentialBackend = this.credentials.backendStatus()
    const config = this.#parseImageSource(row, sourceId)
    const issues: string[] = []
    if (config === null) issues.push('Stored image source configuration is invalid.')
    const usesAmbientAuth = providerId.data === 'google-vertex'
    const configured = usesAmbientAuth
      ? config !== null
      : await this.credentials.hasCredential(row.id)
    if (config !== null && !configured) issues.push('Provider credential is missing.')
    if (config !== null && !usesAmbientAuth && !credentialBackend.securePersistence) {
      issues.push(credentialBackend.warning ?? 'Secure credential storage is unavailable.')
    }
    return {
      sourceId,
      providerId: providerId.data,
      name: config?.name ?? sourceId,
      label: IMAGE_TRANSPORT_LABELS[providerId.data],
      config,
      models: config === null ? [] : imageModelSummaries(config),
      configured,
      available:
        config !== null && configured && (usesAmbientAuth || credentialBackend.securePersistence),
      issues
    }
  }

  async #clearDefaultIfSelected(sourceId: string, modelId: string): Promise<void> {
    const selection = await this.settings.getImageDefaultSelection()
    if (selection?.sourceId === sourceId && selection.modelId === modelId) {
      await this.settings.setImageDefaultSelection(null)
    }
  }

  #agentCatalogService(): AgentCatalog {
    if (this.#agentCatalog === null) throw new Error('Agent provider catalog is unavailable')
    return this.#agentCatalog
  }
}

/** A selected image source or model cannot serve a request; never triggers fallback. */
export class ImageSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageSelectionError'
  }
}

const IMAGE_CONFIG_PREFIX = 'image:'
const MAX_IMAGE_SOURCES = 50

export function imageProviderConfigId(sourceId: string): string {
  return `${IMAGE_CONFIG_PREFIX}${sourceId}`
}

function usesAmbientAuthentication(config: ProviderConfig): boolean {
  return config.role === 'image' && config.providerId === 'google-vertex'
}

function allImageModels(config: ImageSourceConfig): ImageModelDefinition[] {
  return [...BUILTIN_IMAGE_MODELS[config.providerId], ...config.manualModels]
}

function enabledImageModels(config: ImageSourceConfig): ImageModelDefinition[] {
  const disabled = new Set(config.disabledModelIds)
  return allImageModels(config).filter((model) => !disabled.has(model.id))
}

function imageModelSummaries(config: ImageSourceConfig): ImageModelSummary[] {
  const disabled = new Set(config.disabledModelIds)
  const builtins = new Set(BUILTIN_IMAGE_MODELS[config.providerId].map((model) => model.id))
  return allImageModels(config).map((model) => ({
    ...model,
    source: builtins.has(model.id) ? 'builtin' : 'manual',
    enabled: !disabled.has(model.id)
  }))
}

function imageRuntimeConfig(
  config: ImageSourceConfig,
  model: ImageModelDefinition
): ImageProviderConfig {
  const {
    name: _name,
    manualModels: _manualModels,
    disabledModelIds: _disabledModelIds,
    ...runtime
  } = config
  return { ...runtime, model: model.id, imageSizes: [...model.imageSizes] }
}

function imageProviderCapability(providerId: ImageProviderId) {
  return {
    ...getProviderCapability('image'),
    providerId,
    supportedFormats: ['png', 'jpeg']
  }
}

function isMineruAuthCode(code?: string): boolean {
  return code === 'A0202' || code === 'A0211'
}

function result(
  ok: boolean,
  code: ProviderConnectionTestResult['code'],
  message: string,
  startedAt: number
): ProviderConnectionTestResult {
  return { ok, code, message, durationMs: Math.max(0, Date.now() - startedAt) }
}
