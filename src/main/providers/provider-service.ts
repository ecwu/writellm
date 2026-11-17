import type { Kysely, Transaction } from 'kysely'
import type { AppDatabaseSchema } from '../app-db/database-types'
import {
  PurposeProviderService,
  PurposeSelectionUnavailableError,
  type ResolvedPurpose,
  purposeRuntimeConfig
} from './purpose-provider-service'
import { PurposeCatalogRepository } from '../app-db/repositories/purpose-catalog'
import { discoverSourceModels, SourceModelDiscoveryError } from './source-model-discovery'
import { sha256 } from '../../shared/hash'
import { z } from 'zod'
import { SpeechFailure, SPEECH_SETUP_REQUIRED } from '../../shared/speech-errors'
import type { Logger } from 'pino'
import type { AuthInteraction, AuthType } from '@earendil-works/pi-ai'
import { randomUUID } from 'node:crypto'
import {
  BUILTIN_IMAGE_MODELS,
  speechSourceConfigSchema,
  speechSourceSaveInputSchema,
  speechSourceIdSchema,
  sourceModelCandidateSchema,
  providerBaseUrlSchema,
  type SpeechSourceStatus,
  type SpeechSourceSaveInput,
  type SourceModelCandidate,
  type PurposeModelRefreshInput,
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
  type PurposeCatalog,
  type PurposeProviderRole,
  type ProviderSettingsSnapshot
} from '../../shared/contracts/providers'
import type { AppDatabase } from '../app-db/connection'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import { getProviderCapability, providerRoles } from './capability-registry'
import { type CredentialService, CredentialUnavailableError } from './credential-service'
import {
  agentProviderConfigFromResolved,
  agentCredentialFromResolved,
  agentRuntimeModelFromResolved,
  type AgentProviderCatalogService
} from './agent-provider-catalog'
import { credentialBindingFingerprint } from './credential-binding'

type AgentCatalog = Pick<
  AgentProviderCatalogService,
  | 'resolve'
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

const discoveryConnectionSchema = z.object({
  role: z.enum(['embedding', 'speech']),
  providerId: z.literal('openai-compatible'),
  baseUrl: providerBaseUrlSchema
})

export interface ConnectionProbeResult {
  invalidResponse?: true
  status: number
  providerCode?: string
}

export type ConnectionProbe = (
  config: ProviderConfig,
  credential: string | undefined,
  signal: AbortSignal,
  runtimeModel?: ReturnType<typeof agentRuntimeModelFromResolved>
) => Promise<ConnectionProbeResult>

export class ProviderService {
  readonly purpose: PurposeProviderService
  #agentCatalog: AgentCatalog | null = null
  readonly #catalogGenerations = new Map<string, number>()
  #catalogGeneration = 0

  constructor(
    private readonly database: AppDatabase,
    private readonly credentials: CredentialService,
    private readonly settings: Pick<
      AppSettingsRepository,
      | 'getImageDefaultSelection'
      | 'setImageDefaultSelection'
      | 'getActiveSpeechSource'
      | 'setActiveSpeechSource'
    >,
    private readonly log: Logger,
    private readonly probe: ConnectionProbe,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createImageSourceId: () => string = () => `img-${randomUUID()}`,
    private readonly discoverModels: typeof discoverSourceModels = discoverSourceModels
  ) {
    this.purpose = new PurposeProviderService(
      database,
      credentials,
      log,
      now,
      () => this.snapshot(),
      (id, db) => this.#modelCatalog(id, db),
      (resolved) =>
        this.#probeConnection(
          resolved.config.role,
          resolved.config,
          resolved.providerConfigId,
          Date.now(),
          (signal) =>
            this.purpose.withResolved(resolved, (config, credential) =>
              this.probe(config, credential, signal)
            )
        ),
      (id) => this.#catalogGenerations.set(id, ++this.#catalogGeneration)
    )
  }

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
    const credentialBackend = await this.credentials.backendStatus()
    const imageSources = (
      await Promise.all(
        rows
          .filter((row) => row.id.startsWith(IMAGE_CONFIG_PREFIX))
          .map((row) => this.#imageSourceStatus(row))
      )
    ).filter((source): source is ImageSourceStatus => source !== null)
    const purposeCatalog = await this.purpose.snapshot(credentialBackend.securePersistence)
    const activeSpeechSourceId = purposeCatalog.speech.defaultSelection?.sourceId ?? null
    const speechSources = purposeCatalog.speech.sources.map((source): SpeechSourceStatus => {
      const selected = purposeCatalog.speech.defaultSelection
      const model =
        (selected?.sourceId === source.sourceId
          ? source.models.find((m) => m.configId === selected.configId)
          : undefined) ??
        source.models.find((m) => m.configId === 'legacy') ??
        source.models[0]
      return {
        sourceId: source.sourceId,
        name: source.name,
        configured: true,
        available: source.available,
        config: model
          ? speechSourceConfigSchema.parse({
              ...purposeRuntimeConfig('speech', source, source.sourceId, model),
              sourceId: source.sourceId,
              name: source.name
            })
          : null,
        issues: source.issues,
        catalog: source.catalog,
        modelCandidates: source.modelCandidates
      }
    })
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
        if (role !== 'agent' && role !== 'image') return defaultPurposeStatus(role, purposeCatalog)
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
        const credentialConfigured = await this.credentials.hasCredential(role)
        const configured = credentialConfigured
        const requiresSecureStorage = true
        if (config !== null && !configured) issues.push('Provider credential is missing.')
        if (config !== null && requiresSecureStorage && !credentialBackend.securePersistence) {
          issues.push(credentialBackend.warning ?? 'Secure credential storage is unavailable.')
        }
        return {
          role,
          capability,
          config,
          configured,
          available:
            config !== null &&
            configured &&
            (!requiresSecureStorage || credentialBackend.securePersistence),
          issues
        }
      })
    )
    return {
      credentialBackend,
      providers,
      imageCatalog: { defaultSelection, sources: imageSources },
      purposeCatalog,
      speechCatalog: { activeSourceId: activeSpeechSourceId, sources: speechSources },
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
    enabled: boolean,
    onAutocompleteDefaultCleared: () => void
  ): Promise<ProviderSettingsSnapshot> {
    if (await this.#agentCatalogService().setProviderEnabled(presetId, enabled)) {
      onAutocompleteDefaultCleared()
    }
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
    if (parsed.role === 'speech') {
      return this.purpose.saveLegacy(parsed, 'legacy', 'Speech input', apiKey, true)
    }
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
    if (parsed.role !== 'agent') {
      const name =
        parsed.role === 'embedding'
          ? 'OpenAI-compatible'
          : parsed.role === 'rerank'
            ? 'Cohere-compatible'
            : 'MinerU'
      return this.purpose.saveLegacy(parsed, 'legacy', name, apiKey, true)
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
    if (role === 'speech') {
      const selection = await this.purpose.repo.getDefault(role)
      return selection ? this.removeSpeechSource(selection.sourceId) : this.snapshot()
    }
    if (role !== 'agent') return this.purpose.removePurposeSource({ role, sourceId: 'legacy' })
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
    return this.snapshot()
  }

  async removeImageSource(sourceId: string): Promise<ProviderSettingsSnapshot> {
    this.#catalogGenerations.set(imageProviderConfigId(sourceId), ++this.#catalogGeneration)
    await this.database.kysely.transaction().execute(async (tx) => {
      await tx
        .deleteFrom('provider_configs')
        .where('id', '=', imageProviderConfigId(sourceId))
        .execute()
      await this.#clearDefaultIfSelected(tx, sourceId)
    })
    this.log.info({ event: 'provider.image_source.removed', sourceId }, 'Image source removed')
    return this.snapshot()
  }

  async saveImageManualModel(
    sourceId: string,
    model: ImageModelDefinition
  ): Promise<ProviderSettingsSnapshot> {
    const exists = await this.database.kysely.transaction().execute(async (tx) => {
      const config = await this.#requireImageSource(sourceId, tx)
      if (BUILTIN_IMAGE_MODELS[config.providerId].some((builtin) => builtin.id === model.id)) {
        throw new Error('Built-in image models cannot be replaced')
      }
      const exists = config.manualModels.some((item) => item.id === model.id)
      await this.#updateImageSource(tx, {
        ...config,
        manualModels: exists
          ? config.manualModels.map((item) => (item.id === model.id ? model : item))
          : [...config.manualModels, model]
      })
      return exists
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
    await this.database.kysely.transaction().execute(async (tx) => {
      const config = await this.#requireImageSource(sourceId, tx)
      await this.#updateImageSource(tx, {
        ...config,
        manualModels: config.manualModels.filter((item) => item.id !== modelId),
        disabledModelIds: config.disabledModelIds.filter((id) => id !== modelId)
      })
      await this.#clearDefaultIfSelected(tx, sourceId, modelId)
    })
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
    await this.database.kysely.transaction().execute(async (tx) => {
      const config = await this.#requireImageSource(sourceId, tx)
      if (!allImageModels(config).some((model) => model.id === modelId)) {
        throw new Error('Image model is not part of this source')
      }
      const disabled = config.disabledModelIds.filter((id) => id !== modelId)
      await this.#updateImageSource(tx, {
        ...config,
        disabledModelIds: enabled ? disabled : [...disabled, modelId]
      })
      if (!enabled) await this.#clearDefaultIfSelected(tx, sourceId, modelId)
    })
    this.log.info(
      { event: 'provider.image_model.enabled_changed', sourceId, modelId, enabled },
      'Image model availability changed'
    )
    return this.snapshot()
  }

  async setImageDefaultSelection(
    selection: ImageModelSelection | null
  ): Promise<ProviderSettingsSnapshot> {
    if (selection === null) {
      await this.settings.setImageDefaultSelection(null)
    } else {
      const checked = await this.resolveImageSelection(selection)
      await this.database.kysely.transaction().execute(async (tx) => {
        const source = await this.#requireImageSource(selection.sourceId, tx)
        const model = enabledImageModels(source).find((item) => item.id === selection.modelId)
        if (
          !model ||
          JSON.stringify(imageRuntimeConfig(source, model)) !== JSON.stringify(checked)
        ) {
          throw new ImageSelectionError(
            'The selected image model changed. Choose an enabled model.'
          )
        }
        await this.settings.setImageDefaultSelection(selection, tx)
      })
    }
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
    return this.#withResolvedImage(config, operation)
  }

  async #withResolvedImage<T>(
    config: ImageProviderConfig,
    operation: (config: ImageProviderConfig, credential: string | undefined) => Promise<T>
  ): Promise<T> {
    const run = async (credential: string | undefined) => {
      const current = await this.resolveImageSelection({
        sourceId: config.sourceId,
        modelId: config.model
      })
      if (JSON.stringify(current) !== JSON.stringify(config)) {
        throw new ImageSelectionError('The image source configuration changed. Try again.')
      }
      return operation(config, credential)
    }
    if (config.providerId === 'google-vertex') return run(undefined)
    const providerConfigId = imageProviderConfigId(config.sourceId)
    const binding = credentialBindingFingerprint({
      providerConfigId,
      provider: config.providerId,
      configJson: JSON.stringify(config)
    })
    return this.credentials.withCredential(providerConfigId, run, binding)
  }

  async saveSpeechSource(input: SpeechSourceSaveInput): Promise<ProviderSettingsSnapshot> {
    const parsed = speechSourceSaveInputSchema.parse(input)
    const sourceId = parsed.sourceId ?? `sp-${randomUUID()}`
    return this.purpose.saveLegacy(
      {
        role: 'speech',
        providerId: 'openai-compatible',
        baseUrl: parsed.source.baseUrl,
        model: parsed.source.model,
        mode: parsed.source.mode,
        timeoutMs: 60000,
        batchLimit: 1,
        embeddingDimension: null,
        fileSizeLimitMb: null
      },
      sourceId,
      parsed.source.name,
      parsed.apiKey,
      false,
      parsed.sourceId !== undefined
    )
  }

  async removeSpeechSource(sourceId: string): Promise<ProviderSettingsSnapshot> {
    return this.purpose.removePurposeSource({
      role: 'speech',
      sourceId: speechSourceIdSchema.parse(sourceId)
    })
  }

  async setActiveSpeechSource(sourceId: string | null): Promise<ProviderSettingsSnapshot> {
    if (sourceId === null)
      return this.purpose.setPurposeDefault({ role: 'speech', selection: null })
    const id = speechSourceIdSchema.parse(sourceId)
    const current = await this.purpose.repo.getDefault('speech')
    if (current?.sourceId === id) return this.snapshot()
    const models = (await this.purpose.repo.listModels('speech')).filter(
      (model) => model.source_id === id && model.enabled
    )
    const model =
      models.find((candidate) => candidate.config_id === 'legacy') ??
      (models.length === 1 ? models[0] : undefined)
    if (!model) throw new Error('Choose a specific speech model in Settings.')
    return this.purpose.setPurposeDefault({
      role: 'speech',
      selection: { sourceId: id, configId: model.config_id }
    })
  }
  async withSpeechProvider<T>(
    operation: (
      config: ProviderConfigForRole<'speech'>,
      credential: string | undefined
    ) => Promise<T>,
    sourceId?: string,
    configId?: string
  ): Promise<T> {
    let resolved: ResolvedPurpose<'speech'>
    try {
      const model =
        sourceId !== undefined && configId === undefined
          ? (await this.purpose.repo.listModels('speech')).find(
              (m) => m.source_id === sourceId && m.enabled
            )?.config_id
          : configId
      if (sourceId !== undefined && !model)
        throw new PurposeSelectionUnavailableError('No speech model is enabled')
      resolved = await this.purpose.resolve(
        'speech',
        sourceId && model ? { sourceId, configId: model } : undefined
      )
    } catch (err) {
      this.log.warn(
        { event: 'provider.speech.resolve_failed', err },
        'Speech configuration is unavailable'
      )
      if (err instanceof PurposeSelectionUnavailableError)
        throw new SpeechFailure(SPEECH_SETUP_REQUIRED, { cause: err })
      throw err
    }
    return this.purpose.withResolved(resolved, operation)
  }
  async refreshSpeechModels(sourceId: string): Promise<ProviderSettingsSnapshot> {
    return this.#refreshPurposeCatalog('speech', sourceId)
  }
  async refreshPurposeModels(input: PurposeModelRefreshInput): Promise<ProviderSettingsSnapshot> {
    return this.#refreshPurposeCatalog(input.role, input.sourceId)
  }
  async #refreshPurposeCatalog(
    role: 'speech' | 'embedding',
    sourceId: string
  ): Promise<ProviderSettingsSnapshot> {
    const source = await new PurposeCatalogRepository(this.database.kysely).getSource(
      role,
      speechSourceIdSchema.parse(sourceId)
    )
    if (!source) throw new Error('Source was removed')
    return this.#refreshModels(source.provider_config_id, role)
  }
  async refreshImageModels(sourceId: string): Promise<ProviderSettingsSnapshot> {
    await this.#requireImageSource(sourceId)
    return this.#refreshModels(imageProviderConfigId(sourceId))
  }

  async #catalogFingerprint(
    configId: string,
    database: Kysely<AppDatabaseSchema> | Transaction<AppDatabaseSchema> = this.database.kysely
  ): Promise<string | null> {
    const row = await database
      .selectFrom('provider_configs')
      .select(['provider', 'config_json'])
      .where('id', '=', configId)
      .executeTakeFirst()
    if (row === undefined) return null
    const config = JSON.parse(row.config_json) as Record<string, unknown>
    const credential = await database
      .selectFrom('encrypted_credentials')
      .select(['ciphertext', 'binding_fingerprint'])
      .where('provider_config_id', '=', configId)
      .execute()
    return sha256(
      JSON.stringify({
        configId,
        provider: row.provider,
        baseUrl: config.baseUrl ?? null,
        projectId: config.projectId ?? null,
        location: config.location ?? null,
        credentials: credential
      })
    )
  }
  async #modelCatalog(
    configId: string,
    database: Kysely<AppDatabaseSchema> = this.database.kysely
  ): Promise<{
    modelCandidates: SourceModelCandidate[]
    catalog: {
      status: 'never' | 'current' | 'stale' | 'unsupported'
      checkedAt: string | null
      lastErrorCode: string | null
    }
  }> {
    const empty = {
      modelCandidates: [],
      catalog: { status: 'never' as const, checkedAt: null, lastErrorCode: null }
    }
    const row = await database
      .selectFrom('source_model_catalogs')
      .selectAll()
      .where('provider_config_id', '=', configId)
      .executeTakeFirst()
    if (
      row === undefined ||
      row.fingerprint !== (await this.#catalogFingerprint(configId, database))
    )
      return empty
    try {
      if (Buffer.byteLength(row.models_json) > 2 * 1024 * 1024)
        throw new Error('Stored model catalog exceeds its size limit')
      return {
        modelCandidates: z
          .array(sourceModelCandidateSchema)
          .max(2000)
          .parse(JSON.parse(row.models_json)),
        catalog: {
          status:
            row.last_error_code === 'unsupported'
              ? 'unsupported'
              : row.last_error_code === null
                ? 'current'
                : 'stale',
          checkedAt: row.checked_at,
          lastErrorCode: row.last_error_code
        }
      }
    } catch (err) {
      this.log.error(
        { event: 'provider.model_catalog.invalid', err },
        'Stored source catalog is invalid'
      )
      return empty
    }
  }
  async #refreshModels(
    configId: string,
    role?: 'embedding' | 'speech'
  ): Promise<ProviderSettingsSnapshot> {
    const generation = ++this.#catalogGeneration
    this.#catalogGenerations.set(configId, generation)
    const saved = await this.database.kysely.transaction().execute(async (transaction) => {
      const row = await transaction
        .selectFrom('provider_configs')
        .select(['provider', 'config_json'])
        .where('id', '=', configId)
        .executeTakeFirst()
      if (row === undefined) throw new Error('Source was removed')
      const raw = JSON.parse(row.config_json)
      let input: Parameters<typeof discoverSourceModels>[0]
      if (role) {
        const config = discoveryConnectionSchema.parse(raw)
        if (config.role !== role) throw new Error('Source purpose changed')
        input = {
          transport: 'openai-compatible',
          baseUrl: config.baseUrl,
          ...(role === 'embedding' ? { purpose: role } : {})
        }
      } else {
        const config = imageSourceConfigSchema.parse(raw)
        input = {
          transport: config.providerId,
          ...('baseUrl' in config && config.baseUrl !== undefined
            ? { baseUrl: config.baseUrl }
            : {})
        }
      }
      const fingerprint = await this.#catalogFingerprint(configId, transaction)
      const binding = credentialBindingFingerprint({
        providerConfigId: configId,
        provider: row.provider,
        configJson: row.config_json
      })
      return { fingerprint, input, binding }
    })
    const { fingerprint, input, binding } = saved
    if (fingerprint === null) throw new Error('Source was removed')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const operation = async (credential: string | undefined) => {
        if (
          this.#catalogGenerations.get(configId) !== generation ||
          (await this.#catalogFingerprint(configId)) !== fingerprint
        )
          throw new Error('Source changed while refreshing')
        return this.discoverModels(
          { ...input, ...(credential === undefined ? {} : { credential }) },
          controller.signal,
          this.log
        )
      }
      const candidates = await this.credentials.withOptionalCredential(configId, operation, binding)
      const models = z.array(sourceModelCandidateSchema).max(2000).parse(candidates)
      const modelsJson = JSON.stringify(models)
      if (Buffer.byteLength(modelsJson) > 2 * 1024 * 1024)
        throw new Error('Model catalog exceeds its size limit')
      if (
        this.#catalogGenerations.get(configId) !== generation ||
        (await this.#catalogFingerprint(configId)) !== fingerprint
      )
        return this.snapshot()
      const now = this.now()
      await this.database.kysely.transaction().execute(async (transaction) => {
        if (
          this.#catalogGenerations.get(configId) !== generation ||
          (await this.#catalogFingerprint(configId, transaction)) !== fingerprint
        )
          return
        await transaction
          .insertInto('source_model_catalogs')
          .values({
            provider_config_id: configId,
            fingerprint,
            models_json: modelsJson,
            checked_at: now,
            last_attempted_at: now,
            last_error_code: null
          })
          .onConflict((conflict) =>
            conflict.column('provider_config_id').doUpdateSet({
              fingerprint,
              models_json: modelsJson,
              checked_at: now,
              last_attempted_at: now,
              last_error_code: null
            })
          )
          .execute()
      })
      this.log.info(
        { event: 'provider.model_catalog.refreshed', modelCount: models.length },
        'Source model candidates refreshed'
      )
    } catch (err) {
      this.log.error(
        { event: 'provider.model_catalog.refresh_failed', err },
        'Source model discovery failed'
      )
      if (
        this.#catalogGenerations.get(configId) === generation &&
        (await this.#catalogFingerprint(configId)) === fingerprint
      ) {
        const code = err instanceof SourceModelDiscoveryError ? err.code : 'invalid_response'
        const now = this.now()
        await this.database.kysely.transaction().execute(async (transaction) => {
          if (
            this.#catalogGenerations.get(configId) !== generation ||
            (await this.#catalogFingerprint(configId, transaction)) !== fingerprint
          )
            return
          const previous = await transaction
            .selectFrom('source_model_catalogs')
            .selectAll()
            .where('provider_config_id', '=', configId)
            .executeTakeFirst()
          const retained = previous?.fingerprint === fingerprint ? previous : undefined
          await transaction
            .insertInto('source_model_catalogs')
            .values({
              provider_config_id: configId,
              fingerprint,
              models_json: retained?.models_json ?? '[]',
              checked_at: retained?.checked_at ?? null,
              last_attempted_at: now,
              last_error_code: code
            })
            .onConflict((conflict) =>
              conflict.column('provider_config_id').doUpdateSet({
                fingerprint,
                models_json: retained?.models_json ?? '[]',
                checked_at: retained?.checked_at ?? null,
                last_attempted_at: now,
                last_error_code: code
              })
            )
            .execute()
        })
      }
    } finally {
      clearTimeout(timeout)
    }
    return this.snapshot()
  }

  async withConfiguredProvider<R extends ProviderRole, T>(
    role: R,
    operation: (
      config: ProviderConfigForRole<R>,
      credential: R extends 'image' | 'speech' ? string | undefined : string
    ) => Promise<T>
  ): Promise<T> {
    if (role === 'image') {
      return this.withImageProvider(null, (config, credential) =>
        operation(
          config as ProviderConfigForRole<R>,
          credential as R extends 'image' | 'speech' ? string | undefined : string
        )
      )
    }
    if (role === 'speech')
      return this.withSpeechProvider((config, credential) =>
        operation(
          config as ProviderConfigForRole<R>,
          credential as R extends 'image' | 'speech' ? string | undefined : string
        )
      )
    if (role === 'embedding' || role === 'mineru' || role === 'rerank') {
      return this.purpose.withResolved(await this.purpose.resolve(role), (config, credential) =>
        operation(
          config as ProviderConfigForRole<R>,
          credential as R extends 'image' | 'speech' ? string | undefined : string
        )
      )
    }
    const config = await this.getConfiguredProvider(role)
    return this.credentials.withCredential(role, (credential) =>
      operation(config, credential as R extends 'image' | 'speech' ? string | undefined : string)
    )
  }

  async getConfiguredProvider<R extends ProviderRole>(role: R): Promise<ProviderConfigForRole<R>> {
    if (role === 'image') {
      return (await this.resolveImageSelection(null)) as ProviderConfigForRole<R>
    }
    if (role !== 'agent') {
      try {
        return (await this.purpose.resolve(role)).config as ProviderConfigForRole<R>
      } catch (err) {
        this.log.debug(
          { event: 'provider.runtime.default_unavailable', err, role },
          'Default model is unavailable'
        )
        if (role === 'speech' && err instanceof PurposeSelectionUnavailableError)
          throw new SpeechFailure(SPEECH_SETUP_REQUIRED, { cause: err })
        throw err
      }
    }
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', role)
      .executeTakeFirst()
    if (row === undefined) {
      throw new Error(`${role} provider is not configured`)
    }
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

  async testAgentPreset(selection: AgentModelSelection): Promise<ProviderConnectionTestResult> {
    const startedAt = Date.now()
    const resolved = await this.#agentCatalogService().resolve(selection)
    const config = agentProviderConfigFromResolved(resolved)
    return this.#probeConnection('agent', config, selection.presetId, startedAt, (signal) =>
      this.probe(
        config,
        agentCredentialFromResolved(resolved),
        signal,
        agentRuntimeModelFromResolved(resolved)
      )
    )
  }

  async testConnection(
    role: Exclude<ProviderRole, 'image'>
  ): Promise<ProviderConnectionTestResult> {
    const startedAt = Date.now()
    if (role === 'speech')
      return result(false, 'provider_rejected', 'Use the speech connection test.', startedAt)
    if (role !== 'agent') {
      const selection = await this.purpose.repo.getDefault(role)
      return selection
        ? this.purpose.testPurposeModel({ role, ...selection })
        : result(false, 'missing_config', 'Provider is not configured.', startedAt)
    }
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
    const config = imageRuntimeConfig(source, model)
    return this.#probeConnection('image', config, configId, startedAt, (signal) =>
      this.#withResolvedImage(config, (current, credential) =>
        this.probe(current, credential, signal)
      )
    )
  }

  async #probeConnection(
    role: ProviderRole,
    config: ProviderConfig,
    configId: string,
    startedAt: number,
    probeResolved?: (signal: AbortSignal) => Promise<ConnectionProbeResult>
  ): Promise<ProviderConnectionTestResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = probeResolved
        ? await probeResolved(controller.signal)
        : usesAmbientAuthentication(config)
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
    config: ProviderConfigForRole<'agent'> | ImageSourceConfig,
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
      apiKey === undefined ? undefined : await this.credentials.encryptForPersistence(apiKey)
    const previousEndpoint =
      previous === undefined
        ? undefined
        : discoveryEndpointIdentity(JSON.parse(previous.config_json) as Record<string, unknown>)
    if (
      config.role === 'image' &&
      (securityIdentityChanged ||
        apiKey !== undefined ||
        previousEndpoint !== discoveryEndpointIdentity(config))
    ) {
      this.#catalogGenerations.set(configId, ++this.#catalogGeneration)
    }
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

  async #updateImageSource(
    tx: Transaction<AppDatabaseSchema>,
    config: ImageSourceConfig
  ): Promise<void> {
    const parsed = imageSourceConfigSchema.parse(config)
    const result = await tx
      .updateTable('provider_configs')
      .set({ config_json: JSON.stringify(parsed), updated_at: this.now() })
      .where('id', '=', imageProviderConfigId(parsed.sourceId))
      .where('provider', '=', parsed.providerId)
      .executeTakeFirst()
    if (result.numUpdatedRows !== 1n) throw new Error('Image source is not configured')
  }

  async #requireImageSource(
    sourceId: string,
    executor = this.database.kysely
  ): Promise<ImageSourceConfig> {
    const row = await executor
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
      (await this.credentials.backendStatus()).securePersistence
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
    const credentialBackend = await this.credentials.backendStatus()
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
      issues,
      ...(await this.#modelCatalog(row.id))
    }
  }

  async #clearDefaultIfSelected(
    tx: Transaction<AppDatabaseSchema>,
    sourceId: string,
    modelId?: string
  ): Promise<void> {
    const selection = await this.settings.getImageDefaultSelection(tx)
    if (
      selection?.sourceId === sourceId &&
      (modelId === undefined || selection.modelId === modelId)
    ) {
      await this.settings.setImageDefaultSelection(null, tx)
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

export function speechProviderConfigId(sourceId: string): string {
  return sourceId === 'legacy' ? 'speech' : `speech:${sourceId}`
}
function defaultPurposeStatus(role: PurposeProviderRole, catalog: PurposeCatalog) {
  const { sources, defaultSelection } = catalog[role]
  const source = sources.find((source) => source.sourceId === defaultSelection?.sourceId)
  const model = source?.models.find((model) => model.configId === defaultSelection?.configId)
  return {
    role,
    capability: getProviderCapability(role),
    config: source && model ? purposeRuntimeConfig(role, source, source.sourceId, model) : null,
    configured: source !== undefined && (role === 'speech' || source.authConfigured),
    available: Boolean(source?.available && model?.enabled),
    issues: source?.issues ?? []
  }
}

function discoveryEndpointIdentity(config: object): string {
  const value = config as { baseUrl?: unknown; projectId?: unknown; location?: unknown }
  return JSON.stringify([value.baseUrl ?? null, value.projectId ?? null, value.location ?? null])
}
