import type { Kysely, Transaction } from 'kysely'
import type { Logger } from 'pino'
import type { CredentialBackendStatus } from '../../shared/contracts/providers'
import type { AppDatabase } from '../app-db/connection'
import type { AppDatabaseSchema } from '../app-db/database-types'

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
      .select('id')
      .where('provider_config_id', '=', providerConfigId)
      .executeTakeFirst()
    return row !== undefined
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
    await database
      .insertInto('encrypted_credentials')
      .values({
        id: `${providerConfigId}:api-key`,
        provider_config_id: providerConfigId,
        ciphertext,
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) => conflict.column('id').doUpdateSet({ ciphertext, updated_at: now }))
      .execute()
  }

  async removeCredential(providerConfigId: string): Promise<void> {
    await this.database.kysely
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
      .select('ciphertext')
      .where('provider_config_id', '=', providerConfigId)
      .executeTakeFirst()
    if (row === undefined) throw new CredentialUnavailableError('Provider credential is missing')
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
}

function normalizePlatform(platform: NodeJS.Platform): CredentialBackendStatus['platform'] {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform
  return 'other'
}
