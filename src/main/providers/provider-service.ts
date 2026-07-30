import type { Logger } from 'pino'
import type { AuthInteraction, AuthType } from '@earendil-works/pi-ai'
import {
  providerConfigSchema,
  type ProviderConfig,
  type ProviderConfigForRole,
  type ProviderConnectionTestResult,
  type AgentCustomPresetInput,
  type AgentManualModel,
  type AgentModelSelection,
  type ProviderRole,
  type ProviderSettingsSnapshot
} from '../../shared/contracts/providers'
import type { AppDatabase } from '../app-db/connection'
import { getProviderCapability, providerRoles } from './capability-registry'
import { type CredentialService, CredentialUnavailableError } from './credential-service'
import type { AgentProviderCatalogService } from './agent-provider-catalog'

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
  credential: string,
  signal: AbortSignal
) => Promise<ConnectionProbeResult>

export class ProviderService {
  #agentCatalog: AgentCatalog | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly credentials: CredentialService,
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
    const providers = await Promise.all(
      providerRoles.map(async (role) => {
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

    const ciphertext =
      apiKey === undefined ? undefined : this.credentials.encryptForPersistence(apiKey)
    const now = this.now()
    await this.database.kysely.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('provider_configs')
        .values({
          id: parsed.role,
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
      if (ciphertext !== undefined) {
        await this.credentials.persistEncrypted(parsed.role, ciphertext, transaction)
      }
    })
    this.log.info(
      {
        event: 'provider.config.saved',
        role: parsed.role,
        providerId: parsed.providerId,
        credentialReplaced: ciphertext !== undefined
      },
      'Provider configuration saved'
    )
    return this.snapshot()
  }

  async remove(role: ProviderRole): Promise<ProviderSettingsSnapshot> {
    await this.database.kysely.deleteFrom('provider_configs').where('id', '=', role).execute()
    this.log.info({ event: 'provider.config.removed', role }, 'Provider configuration removed')
    return this.snapshot()
  }

  async withConfiguredProvider<R extends ProviderRole, T>(
    role: R,
    operation: (config: ProviderConfigForRole<R>, credential: string) => Promise<T>
  ): Promise<T> {
    const config = await this.getConfiguredProvider(role)
    return this.credentials.withCredential(role, (credential) => operation(config, credential))
  }

  async getConfiguredProvider<R extends ProviderRole>(role: R): Promise<ProviderConfigForRole<R>> {
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

  async testConnection(role: ProviderRole): Promise<ProviderConnectionTestResult> {
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

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await this.credentials.withCredential(role, (credential) =>
        this.probe(config, credential, controller.signal)
      )
      if (
        response.status === 401 ||
        response.status === 403 ||
        isMineruAuthCode(response.providerCode)
      ) {
        return result(false, 'invalid_auth', 'Provider rejected the credential.', startedAt)
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
