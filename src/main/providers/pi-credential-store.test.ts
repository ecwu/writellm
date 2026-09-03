import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase, type AppDatabase } from '../app-db/connection'
import { CredentialService, type SafeStorageAdapter } from './credential-service'
import { MainPiCredentialStore } from './pi-credential-store'

const directories: string[] = []
const log = pino({ level: 'silent' })

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean {
    return true
  }
  encryptString(value: string): Buffer {
    return Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xa5))
  }
  decryptString(value: Buffer): string {
    return Buffer.from(value.map((byte) => byte ^ 0xa5)).toString()
  }
  getSelectedStorageBackend(): string {
    return 'kwallet6'
  }
}

async function database(): Promise<AppDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-pi-credentials-'))
  directories.push(directory)
  const database = await openAppDatabase({
    path: join(directory, 'app.sqlite'),
    applicationVersion: 'test',
    log
  })
  await database.kysely
    .insertInto('provider_configs')
    .values({
      id: 'agent',
      provider: 'openai-compatible',
      config_json: '{}',
      created_at: '2026-07-16T00:00:00.000Z',
      updated_at: '2026-07-16T00:00:00.000Z'
    })
    .execute()
  return database
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('MainPiCredentialStore', () => {
  it('cancels queued credential changes without releasing an active modification', async () => {
    const appDatabase = await database()
    const store = new MainPiCredentialStore(
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    )
    await store.modify('openai-compatible', async () => ({ type: 'api_key', key: 'original' }))
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const activeController = new AbortController()
    const active = store.modify(
      'openai-compatible',
      async () => {
        entered.resolve()
        await finish.promise
        return { type: 'api_key', key: 'cancelled-active' }
      },
      { signal: activeController.signal }
    )
    const activeRejected = expect(active).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise

    const queuedController = new AbortController()
    const queuedOperation = vi.fn(async () => ({
      type: 'api_key' as const,
      key: 'cancelled-queue'
    }))
    const queued = store.modify('openai-compatible', queuedOperation, {
      signal: queuedController.signal
    })
    const queuedRejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    queuedController.abort()
    await queuedRejected
    activeController.abort()
    const nextOperation = vi.fn(async (current) => {
      expect(current).toEqual({ type: 'api_key', key: 'original' })
      return { type: 'api_key' as const, key: 'fresh' }
    })
    const next = store.modify('openai-compatible', nextOperation)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(queuedOperation).not.toHaveBeenCalled()
    expect(nextOperation).not.toHaveBeenCalled()
    finish.resolve()
    await activeRejected
    await next
    expect(await store.read('openai-compatible')).toEqual({ type: 'api_key', key: 'fresh' })
    const aborted = { signal: AbortSignal.abort() }
    await expect(store.read('openai-compatible', aborted)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await expect(store.list(aborted)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(store.delete('openai-compatible', aborted)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(await store.read('openai-compatible')).toEqual({ type: 'api_key', key: 'fresh' })
    appDatabase.close()
  })

  it('implements serialized read-modify-write through encrypted app storage', async () => {
    const appDatabase = await database()
    const credentialService = new CredentialService(
      appDatabase,
      new FakeSafeStorage(),
      log,
      'linux'
    )
    const store = new MainPiCredentialStore(credentialService)
    expect(await store.read('openai-compatible')).toBeUndefined()
    expect(await store.list()).toEqual([])

    await store.modify('openai-compatible', async () => ({ type: 'api_key', key: 'first-key' }))
    const observed: string[] = []
    await Promise.all([
      store.modify('openai-compatible', async (current) => {
        observed.push(current?.type === 'api_key' ? (current.key ?? '') : '')
        await Promise.resolve()
        return { type: 'api_key', key: 'second-key' }
      }),
      store.modify('openai-compatible', async (current) => {
        observed.push(current?.type === 'api_key' ? (current.key ?? '') : '')
        return { type: 'api_key', key: 'third-key' }
      })
    ])
    expect(observed).toEqual(['first-key', 'second-key'])
    expect(await store.read('openai-compatible')).toEqual({ type: 'api_key', key: 'third-key' })
    expect(await store.list()).toEqual([{ providerId: 'openai-compatible', type: 'api_key' }])
    const persisted = await appDatabase.kysely
      .selectFrom('encrypted_credentials')
      .select('ciphertext')
      .executeTakeFirstOrThrow()
    expect(persisted.ciphertext).not.toContain('third-key')

    await store.delete('openai-compatible')
    expect(await store.read('openai-compatible')).toBeUndefined()
    await expect(store.read('other-provider')).rejects.toThrow('not available')
    appDatabase.close()
  })
})
