import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { openAppDatabase, type AppDatabase } from '../app-db/connection'
import { CredentialService, type SafeStorageAdapter } from './credential-service'

const log = pino({ level: 'silent' })
const directories: string[] = []

/** Encodes values with a key generation, so a rotated key is visible in the ciphertext. */
class RotatingSafeStorage implements SafeStorageAdapter {
  generation = 1
  failEncrypt = false
  beforeEncrypt: (() => Promise<void>) | undefined
  async isAsyncEncryptionAvailable(): Promise<boolean> {
    return true
  }
  async encryptStringAsync(value: string): Promise<Buffer> {
    if (this.failEncrypt) throw new Error('key store unavailable')
    const hook = this.beforeEncrypt
    this.beforeEncrypt = undefined
    await hook?.()
    return Buffer.from(`${this.generation}:${value}`, 'utf8')
  }
  async decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    const [generation, ...rest] = value.toString('utf8').split(':')
    return { result: rest.join(':'), shouldReEncrypt: Number(generation) !== this.generation }
  }
  getSelectedStorageBackend(): string {
    return 'gnome_libsecret'
  }
}

async function database(): Promise<AppDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-credentials-'))
  directories.push(directory)
  const appDatabase = await openAppDatabase({
    path: join(directory, 'app.sqlite'),
    applicationVersion: 'test',
    log
  })
  await appDatabase.kysely
    .insertInto('provider_configs')
    .values({
      id: 'agent',
      provider: 'openai-compatible',
      config_json: '{}',
      created_at: '2026-11-07T00:00:00.000Z',
      updated_at: '2026-11-07T00:00:00.000Z'
    })
    .execute()
  return appDatabase
}

async function storedCiphertext(appDatabase: AppDatabase): Promise<string> {
  const row = await appDatabase.kysely
    .selectFrom('encrypted_credentials')
    .select('ciphertext')
    .where('provider_config_id', '=', 'agent')
    .executeTakeFirstOrThrow()
  return Buffer.from(row.ciphertext, 'base64').toString('utf8')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('CredentialService asynchronous safeStorage', () => {
  it('round-trips a credential through the asynchronous key store', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new RotatingSafeStorage(), log, 'linux')
    await credentials.persistEncrypted('agent', await credentials.encryptForPersistence('secret'))

    await expect(credentials.readPersistedValue('agent')).resolves.toBe('secret')
    await expect(credentials.withCredential('agent', async (value) => value)).resolves.toBe(
      'secret'
    )
    expect(await storedCiphertext(appDatabase)).toBe('1:secret')
  })

  it('re-encrypts a value that the key store reports under a rotated key', async () => {
    const appDatabase = await database()
    const storage = new RotatingSafeStorage()
    const credentials = new CredentialService(appDatabase, storage, log, 'linux')
    await credentials.persistEncrypted('agent', await credentials.encryptForPersistence('secret'))
    storage.generation = 2

    await expect(credentials.withCredential('agent', async (value) => value)).resolves.toBe(
      'secret'
    )
    expect(await storedCiphertext(appDatabase)).toBe('2:secret')
    await expect(credentials.readPersistedValue('agent')).resolves.toBe('secret')
  })

  it('keeps the previous ciphertext readable when re-encryption fails', async () => {
    const appDatabase = await database()
    const storage = new RotatingSafeStorage()
    const credentials = new CredentialService(appDatabase, storage, log, 'linux')
    await credentials.persistEncrypted('agent', await credentials.encryptForPersistence('secret'))
    storage.generation = 2
    storage.failEncrypt = true

    await expect(credentials.readPersistedValue('agent')).resolves.toBe('secret')
    expect(await storedCiphertext(appDatabase)).toBe('1:secret')
  })

  it('never overwrites a credential saved while the rotated value is re-encrypted', async () => {
    const appDatabase = await database()
    const storage = new RotatingSafeStorage()
    const credentials = new CredentialService(appDatabase, storage, log, 'linux')
    await credentials.persistEncrypted('agent', await credentials.encryptForPersistence('old'))
    storage.generation = 2
    // A save lands after the rotated value was read and before its re-encryption is written.
    storage.beforeEncrypt = () =>
      credentials.persistEncrypted('agent', Buffer.from('2:new', 'utf8').toString('base64'))

    await expect(credentials.readPersistedValue('agent')).resolves.toBe('old')
    expect(await storedCiphertext(appDatabase)).toBe('2:new')
  })
})
