import type { Kysely, Transaction } from 'kysely'
import type { Logger } from 'pino'
import type { CredentialBackendStatus } from '../../shared/contracts/providers'
import type { AppDatabase } from '../app-db/connection'
import type { AppDatabaseSchema } from '../app-db/database-types'
import { expectedCredentialBinding } from './credential-binding'

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}

export class CredentialUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialUnavailableError'
  }
}

export class CredentialService {
  constructor(
    private readonly database: AppDatabase,
    private readonly storage: SafeStorageAdapter,
    private readonly log: Logger,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  backendStatus(): CredentialBackendStatus {
    const encryptionAvailable = this.storage.isEncryptionAvailable()
    const platform = normalizePlatform(this.platform)
    const backend =
      platform === 'linux'
        ? (this.storage.getSelectedStorageBackend?.() ?? 'unknown')
        : platform === 'darwin'
          ? 'keychain'
          : platform === 'win32'
            ? 'dpapi'
            : 'unsupported'
    const basicText = platform === 'linux' && backend === 'basic_text'
    const securePersistence = encryptionAvailable && !basicText && platform !== 'other'
    const persistenceAllowed = securePersistence
    const warning = basicText
      ? 'Linux selected basic_text; secure credential persistence is disabled.'
      : !encryptionAvailable
        ? 'Operating-system credential encryption is unavailable.'
        : platform === 'other'
          ? 'Credential persistence is unsupported on this platform.'
          : null

    return {
      platform,
      backend,
      encryptionAvailable,
      securePersistence,
      persistenceAllowed,
      warning
    }
  }

  async hasCredential(providerConfigId: string): Promise<boolean> {
    const row = await this.database.kysely
      .selectFrom('encrypted_credentials')
      .select(['id', 'binding_fingerprint'])
      .where('provider_config_id', '=', providerConfigId)
      .executeTakeFirst()
    if (row === undefined) return false
    return this.bindingMatches(providerConfigId, row.binding_fingerprint)
  }

  encryptForPersistence(plainText: string): string {
    if (plainText.length === 0 || plainText.length > 16_384) {
      throw new CredentialUnavailableError('Credential length is invalid')
    }
    const status = this.backendStatus()
    if (!status.persistenceAllowed) {
      throw new CredentialUnavailableError(status.warning ?? 'Credential encryption is unavailable')
    }
    return this.storage.encryptString(plainText).toString('base64')
  }

  decryptPersistedValue(ciphertext: string): string {
    const status = this.backendStatus()
    if (!status.securePersistence) {
      throw new CredentialUnavailableError(
        status.warning ?? 'Secure value decryption is unavailable'
      )
    }
    try {
      return this.storage.decryptString(Buffer.from(ciphertext, 'base64'))
    } catch (err) {
      this.log.error(
        { event: 'credential.persisted_value.decrypt_failed', err },
        'Failed to decrypt a persisted sensitive value'
      )
      throw new CredentialUnavailableError('Persisted sensitive value could not be decrypted')
    }
  }

  async persistEncrypted(
    providerConfigId: string,
    ciphertext: string,
    database: Kysely<AppDatabaseSchema> | Transaction<AppDatabaseSchema> = this.database.kysely
  ): Promise<void> {
    const now = this.now()
    const bindingFingerprint = await expectedCredentialBinding(database, providerConfigId)
    await database
      .insertInto('encrypted_credentials')
      .values({
        id: `${providerConfigId}:api-key`,
        provider_config_id: providerConfigId,
        ciphertext,
        binding_fingerprint: bindingFingerprint,
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet({
          ciphertext,
          binding_fingerprint: bindingFingerprint,
          updated_at: now
        })
      )
      .execute()
  }

  async removeCredential(
    providerConfigId: string,
    database: Kysely<AppDatabaseSchema> | Transaction<AppDatabaseSchema> = this.database.kysely
  ): Promise<void> {
    await database
      .deleteFrom('encrypted_credentials')
      .where('provider_config_id', '=', providerConfigId)
      .execute()
  }

  async withCredential<T>(
    providerConfigId: string,
    operation: (credential: string) => Promise<T>
  ): Promise<T> {
    const row = await this.database.kysely
      .selectFrom('encrypted_credentials')
      .select(['ciphertext', 'binding_fingerprint'])
      .where('provider_config_id', '=', providerConfigId)
      .executeTakeFirst()
    if (row === undefined) throw new CredentialUnavailableError('Provider credential is missing')
    if (!(await this.bindingMatches(providerConfigId, row.binding_fingerprint))) {
      throw new CredentialUnavailableError('Provider credential is missing')
    }
    const status = this.backendStatus()
    if (!status.securePersistence) {
      throw new CredentialUnavailableError(
        status.warning ?? 'Secure credential decryption is unavailable'
      )
    }

    let credential: string
    try {
      credential = this.decryptPersistedValue(row.ciphertext)
    } catch (err) {
      this.log.error(
        { event: 'credential.decrypt.failed', err, providerConfigId },
        'Failed to resolve provider credential'
      )
      throw new CredentialUnavailableError('Provider credential could not be decrypted')
    }
    return operation(credential)
  }

  async readPersistedValue(providerConfigId: string): Promise<string | undefined> {
    const row = await this.database.kysely
      .selectFrom('encrypted_credentials')
      .select(['ciphertext', 'binding_fingerprint'])
      .where('provider_config_id', '=', providerConfigId)
      .executeTakeFirst()
    if (
      row === undefined ||
      !(await this.bindingMatches(providerConfigId, row.binding_fingerprint))
    ) {
      return undefined
    }
    return this.decryptPersistedValue(row.ciphertext)
  }

  private async bindingMatches(
    providerConfigId: string,
    actualBinding: string | null
  ): Promise<boolean> {
    let expectedBinding: string
    try {
      expectedBinding = await expectedCredentialBinding(this.database.kysely, providerConfigId)
    } catch (err) {
      this.log.error(
        { event: 'credential.binding_resolution.failed', err, providerConfigId },
        'Failed to resolve provider credential security identity'
      )
      return false
    }
    if (actualBinding === expectedBinding) return true
    this.log.warn(
      {
        subsystem: 'providers',
        component: 'credential-binding',
        event: 'security.credential_binding_mismatch',
        providerConfigId
      },
      'Rejected a provider credential bound to a different security identity'
    )
    return false
  }
}

function normalizePlatform(platform: NodeJS.Platform): CredentialBackendStatus['platform'] {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform
  return 'other'
}
