import type { Logger } from 'pino'
import type { AuthInteraction, AuthType } from '@earendil-works/pi-ai'
import {
  GOOGLE_GEMINI_IMAGE_MODELS,
  GOOGLE_VERTEX_IMAGE_MODELS,
  IMAGE_PROVIDER_IDS,
  OPENAI_IMAGE_MODELS,
  XAI_IMAGE_MODELS,
  providerConfigSchema,
  type ProviderConfig,
  type ProviderConfigForRole,
  type ProviderConnectionTestResult,
  type AgentCustomPresetInput,
  type AgentManualModel,
  type AgentModelSelection,
  type ImageProviderConfig,
  type ImageProviderId,
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
      'getActiveImageProviderId' | 'setActiveImageProviderId'
    >,
    private readonly log: Logger,
    private readonly probe: ConnectionProbe,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  setAgentCatalog(catalog: AgentCatalog): void {
    this.#agentCatalog = catalog
  }

  async snapshot(): Promise<ProviderSettingsSnapshot> {
    const rows = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['id', 'provider', 'config_json'])
      .execute()
    const byRole = new Map(rows.map((row) => [row.id, row]))
    const credentialBackend = this.credentials.backendStatus()
    const activeProviderId = await this.settings.getActiveImageProviderId()
    const imageSources = await Promise.all(
      IMAGE_PROVIDER_IDS.map(async (providerId) => {
        const configId = imageProviderConfigId(providerId)
        const row = byRole.get(configId)
        const issues: string[] = []
        let config: ImageProviderConfig | null = null
        if (row !== undefined) {
          try {
            const parsed = providerConfigSchema.parse(JSON.parse(row.config_json))
            if (
              parsed.role !== 'image' ||
              parsed.providerId !== providerId ||
              parsed.providerId !== row.provider
            ) {
              issues.push('Stored image provider identity does not match its source.')
            } else {
              config = parsed
            }
          } catch (err) {
            this.log.error(
              { event: 'provider.image_config.invalid', err, providerId },
              'Stored image provider configuration failed validation'
            )
            issues.push('Stored image provider configuration is invalid.')
          }
        }
        const usesAmbientAuth = providerId === 'google-vertex'
        const configured = usesAmbientAuth
          ? config !== null
          : await this.credentials.hasCredential(configId)
        if (config !== null && !configured) issues.push('Provider credential is missing.')
        if (config !== null && !usesAmbientAuth && !credentialBackend.securePersistence) {
          issues.push(credentialBackend.warning ?? 'Secure credential storage is unavailable.')
        }
        return {
          providerId,
          label: imageProviderLabel(providerId),
          models: [...imageProviderModels(providerId)],
          config,
          configured,
          available:
            config !== null &&
            configured &&
            (usesAmbientAuth || credentialBackend.securePersistence),
          active: activeProviderId === providerId,
          issues
        }
      })
    )
    const activeImage = imageSources.find((source) => source.providerId === activeProviderId)
    const providers = await Promise.all(
      providerRoles.map(async (role) => {
        if (role === 'image') {
          return {
            role,
            capability: imageProviderCapability(activeProviderId ?? 'google-gemini'),
            config: activeImage?.config ?? null,
            configured: activeImage?.configured ?? false,
            available: activeImage?.available ?? false,
            issues:
              activeProviderId === null
                ? ['No image provider is active.']
                : (activeImage?.issues ?? ['Active image provider is unavailable.'])
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
      imageCatalog: {
        activeProviderId,
        sources: imageSources as ProviderSettingsSnapshot['imageCatalog']['sources']
      },
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
    if (usesAmbientAuthentication(parsed) && apiKey !== undefined) {
      throw new Error('Google Vertex AI uses local Application Default Credentials')
    }
    const capability =
      parsed.role === 'image'
        ? imageProviderCapability(parsed.providerId)
        : getProviderCapability(parsed.role)
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

    const configId = providerConfigId(parsed)
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
      }) !==
        credentialBindingFingerprint({
          providerConfigId: configId,
          provider: parsed.providerId,
          configJson: JSON.stringify(parsed)
        })
    const ciphertext =
      apiKey === undefined ? undefined : this.credentials.encryptForPersistence(apiKey)
    const now = this.now()
    await this.database.kysely.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('provider_configs')
        .values({
          id: configId,
          provider: parsed.providerId,
          config_json: JSON.stringify(parsed),
          created_at: now,
          updated_at: now
        })
        .onConflict((conflict) =>
          conflict.column('id').doUpdateSet({
            provider: parsed.providerId,
            config_json: JSON.stringify(parsed),
            updated_at: now
          })
        )
        .execute()
      if (parsed.role === 'image' && parsed.providerId === 'google-vertex') {
        await this.credentials.removeCredential(configId, transaction)
      } else if (ciphertext !== undefined) {
        await this.credentials.persistEncrypted(configId, ciphertext, transaction)
      } else if (securityIdentityChanged) {
        await this.credentials.removeCredential(configId, transaction)
      }
      if (securityIdentityChanged && parsed.role !== 'image') {
        await transaction
          .deleteFrom('agent_model_catalogs')
          .where('provider_config_id', '=', configId)
          .execute()
      }
    })
    this.log.info(
      {
        event: 'provider.config.saved',
        role: parsed.role,
        providerId: parsed.providerId,
        securityIdentityChanged,
        credentialReplaced: ciphertext !== undefined
      },
      'Provider configuration saved'
    )
    if (
      parsed.role === 'image' &&
      (await this.settings.getActiveImageProviderId()) === null &&
      (usesAmbientAuthentication(parsed) ||
        ((await this.credentials.hasCredential(configId)) &&
          this.credentials.backendStatus().securePersistence))
    ) {
      await this.settings.setActiveImageProviderId(parsed.providerId)
      this.log.info(
        { event: 'provider.image.activated_initial', providerId: parsed.providerId },
        'Activated the first available image provider'
      )
    }
    return this.snapshot()
  }

  async remove(
    role: ProviderRole,
    imageProviderId?: ImageProviderId
  ): Promise<ProviderSettingsSnapshot> {
    const configId =
      role === 'image' ? imageProviderConfigId(requireImageProviderId(imageProviderId)) : role
    await this.database.kysely.deleteFrom('provider_configs').where('id', '=', configId).execute()
    if (role === 'image' && (await this.settings.getActiveImageProviderId()) === imageProviderId) {
      await this.settings.setActiveImageProviderId(null)
    }
    this.log.info(
      { event: 'provider.config.removed', role, imageProviderId },
      'Provider configuration removed'
    )
    return this.snapshot()
  }

  async setActiveImageProvider(providerId: ImageProviderId): Promise<ProviderSettingsSnapshot> {
    const configId = imageProviderConfigId(providerId)
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select(['provider', 'config_json'])
      .where('id', '=', configId)
      .executeTakeFirst()
    if (row === undefined) throw new Error('Image provider is not configured')
    const config = providerConfigSchema.parse(JSON.parse(row.config_json))
    if (
      config.role !== 'image' ||
      config.providerId !== providerId ||
      row.provider !== providerId
    ) {
      throw new Error('Image provider configuration is invalid')
    }
    if (!usesAmbientAuthentication(config) && !(await this.credentials.hasCredential(configId))) {
      throw new CredentialUnavailableError('Image provider credential is missing')
    }
    if (!usesAmbientAuthentication(config) && !this.credentials.backendStatus().securePersistence) {
      throw new CredentialUnavailableError('Secure credential storage is unavailable')
    }
    await this.settings.setActiveImageProviderId(providerId)
    this.log.info(
      { event: 'provider.image.activated', providerId },
      'Active image provider changed'
    )
    return this.snapshot()
  }

  async withConfiguredProvider<R extends ProviderRole, T>(
    role: R,
    operation: (
      config: ProviderConfigForRole<R>,
      credential: R extends 'image' ? string | undefined : string
    ) => Promise<T>
  ): Promise<T> {
    const config = await this.getConfiguredProvider(role)
    if (usesAmbientAuthentication(config)) {
      return operation(config, undefined as R extends 'image' ? string | undefined : string)
    }
    return this.credentials.withCredential(providerConfigId(config), (credential) =>
      operation(config, credential as R extends 'image' ? string | undefined : string)
    )
  }

  async getConfiguredProvider<R extends ProviderRole>(role: R): Promise<ProviderConfigForRole<R>> {
    const activeImageProviderId =
      role === 'image' ? await this.settings.getActiveImageProviderId() : null
    if (role === 'image' && activeImageProviderId === null) {
      throw new Error('image provider is not active')
    }
    const configId =
      role === 'image' ? imageProviderConfigId(activeImageProviderId as ImageProviderId) : role
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', configId)
      .executeTakeFirst()
    if (row === undefined) throw new Error(`${role} provider is not configured`)
    let config: ProviderConfig
    try {
      config = providerConfigSchema.parse(JSON.parse(row.config_json))
      if (
        config.role !== role ||
        (role === 'image' && config.providerId !== activeImageProviderId)
      ) {
        throw new Error('Stored provider role does not match')
      }
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
    role: ProviderRole,
    imageProviderId?: ImageProviderId
  ): Promise<ProviderConnectionTestResult> {
    const startedAt = Date.now()
    const configId =
      role === 'image' ? imageProviderConfigId(requireImageProviderId(imageProviderId)) : role
    const row = await this.database.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', configId)
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

  #agentCatalogService(): AgentCatalog {
    if (this.#agentCatalog === null) throw new Error('Agent provider catalog is unavailable')
    return this.#agentCatalog
  }
}

export function imageProviderConfigId(providerId: ImageProviderId): string {
  return `image:${providerId}`
}

function usesAmbientAuthentication(config: ProviderConfig): boolean {
  return config.role === 'image' && config.providerId === 'google-vertex'
}

function providerConfigId(config: ProviderConfig): string {
  return config.role === 'image' ? imageProviderConfigId(config.providerId) : config.role
}

function requireImageProviderId(providerId: ImageProviderId | undefined): ImageProviderId {
  if (providerId === undefined) throw new Error('Image provider ID is required')
  return providerId
}

function imageProviderLabel(providerId: ImageProviderId): string {
  if (providerId === 'google-gemini') return 'Google Gemini'
  if (providerId === 'google-vertex') return 'Google Vertex AI'
  if (providerId === 'openai') return 'OpenAI'
  return 'xAI'
}

function imageProviderModels(providerId: ImageProviderId): readonly string[] {
  if (providerId === 'google-gemini') return GOOGLE_GEMINI_IMAGE_MODELS
  if (providerId === 'google-vertex') return GOOGLE_VERTEX_IMAGE_MODELS
  if (providerId === 'openai') return OPENAI_IMAGE_MODELS
  return XAI_IMAGE_MODELS
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
