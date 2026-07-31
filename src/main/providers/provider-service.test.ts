import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { openAppDatabase, type AppDatabase } from '../app-db/connection'
import { CredentialService, type SafeStorageAdapter } from './credential-service'
import { credentialBindingFingerprint } from './credential-binding'
import { ProviderService, type ConnectionProbe } from './provider-service'

const directories: string[] = []
const log = pino({ level: 'silent' })
const noProbe: ConnectionProbe = async () => ({ status: 200 })

const agentConfig: ProviderConfig = {
  role: 'agent',
  providerId: 'openai-compatible',
  baseUrl: 'https://api.example.test/v1',
  model: 'writer-1',
  modelRevision: 'writer-rev-1',
  timeoutMs: 1_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

const imageConfig: ProviderConfig = {
  role: 'image',
  providerId: 'google-gemini',
  model: 'gemini-3.1-flash-image',
  timeoutMs: 120_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null,
  defaultAspectRatio: 'auto',
  defaultImageSize: '1K'
}

class FakeSafeStorage implements SafeStorageAdapter {
  constructor(
    private readonly available = true,
    private readonly backend = 'kwallet6'
  ) {}

  isEncryptionAvailable(): boolean {
    return this.available
  }

  encryptString(value: string): Buffer {
    return Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5))
  }

  decryptString(value: Buffer): string {
    return Buffer.from(value.map((byte) => byte ^ 0xa5)).toString('utf8')
  }

  getSelectedStorageBackend(): string {
    return this.backend
  }
}

async function database(): Promise<AppDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-provider-'))
  directories.push(directory)
  return openAppDatabase({
    path: join(directory, 'app.sqlite'),
    applicationVersion: 'test',
    log
  })
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('ProviderService', () => {
  it('persists only ciphertext, reports status, replaces keys, and removes the provider', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const service = new ProviderService(appDatabase, credentials, log, noProbe)

    let snapshot = await service.save(agentConfig, 'first-secret')
    expect(snapshot.providers.find((provider) => provider.role === 'agent')).toMatchObject({
      configured: true,
      available: true,
      config: agentConfig
    })
    let encrypted = await appDatabase.kysely
      .selectFrom('encrypted_credentials')
      .select('ciphertext')
      .executeTakeFirstOrThrow()
    expect(encrypted.ciphertext).not.toContain('first-secret')
    expect(JSON.stringify(snapshot)).not.toContain('first-secret')
    await expect(credentials.withCredential('agent', async (value) => value)).resolves.toBe(
      'first-secret'
    )

    await service.save({ ...agentConfig, model: 'writer-2' }, 'replacement-secret')
    await expect(credentials.withCredential('agent', async (value) => value)).resolves.toBe(
      'replacement-secret'
    )
    encrypted = await appDatabase.kysely
      .selectFrom('encrypted_credentials')
      .select('ciphertext')
      .executeTakeFirstOrThrow()
    expect(encrypted.ciphertext).not.toContain('replacement-secret')

    snapshot = await service.remove('agent')
    expect(snapshot.providers.find((provider) => provider.role === 'agent')).toMatchObject({
      configured: false,
      config: null
    })
    expect(
      await appDatabase.kysely.selectFrom('encrypted_credentials').select('id').execute()
    ).toEqual([])
    appDatabase.close()
  })

  it('reports a missing key before attempting the network request', async () => {
    const appDatabase = await database()
    const probe = vi.fn<ConnectionProbe>()
    const service = new ProviderService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
      log,
      probe
    )
    await service.save(agentConfig)

    await expect(service.testConnection('agent')).resolves.toMatchObject({
      ok: false,
      code: 'missing_credential'
    })
    expect(probe).not.toHaveBeenCalled()
    appDatabase.close()
  })

  it('binds credentials to the endpoint security identity and changes it atomically', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const service = new ProviderService(appDatabase, credentials, log, noProbe)
    await service.save(agentConfig, 'first-secret')

    await service.save({
      ...agentConfig,
      baseUrl: 'https://api.example.test/v2',
      model: 'renamed-model',
      timeoutMs: 2_000
    })
    await expect(credentials.withCredential('agent', async (value) => value)).resolves.toBe(
      'first-secret'
    )

    const changedOrigin = {
      ...agentConfig,
      baseUrl: 'https://other.example.test/v1'
    }
    const withoutReplacement = await service.save(changedOrigin)
    expect(
      withoutReplacement.providers.find((provider) => provider.role === 'agent')
    ).toMatchObject({ configured: false, available: false })
    await expect(credentials.withCredential('agent', async (value) => value)).rejects.toThrow(
      'missing'
    )

    await service.save(changedOrigin, 'replacement-secret')
    await expect(credentials.withCredential('agent', async (value) => value)).resolves.toBe(
      'replacement-secret'
    )

    const operation = vi.fn(async () => 'must-not-run')
    await appDatabase.kysely
      .updateTable('provider_configs')
      .set({ config_json: JSON.stringify(agentConfig) })
      .where('id', '=', 'agent')
      .execute()
    await expect(credentials.withCredential('agent', operation)).rejects.toThrow('missing')
    expect(operation).not.toHaveBeenCalled()
    appDatabase.close()
  })

  it('rolls back an endpoint update when credential invalidation cannot commit', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const service = new ProviderService(appDatabase, credentials, log, noProbe)
    await service.save(agentConfig, 'first-secret')
    appDatabase.immediate((nativeDatabase) => {
      nativeDatabase.exec(`
        CREATE TRIGGER reject_agent_endpoint_update
        BEFORE UPDATE ON provider_configs
        WHEN OLD.id = 'agent'
        BEGIN
          SELECT RAISE(ABORT, 'fixture rollback');
        END;
      `)
    })

    await expect(
      service.save({ ...agentConfig, baseUrl: 'https://other.example.test/v1' })
    ).rejects.toThrow('fixture rollback')
    await expect(credentials.withCredential('agent', async (value) => value)).resolves.toBe(
      'first-secret'
    )
    appDatabase.close()
  })

  it('classifies invalid authentication without returning the credential', async () => {
    const appDatabase = await database()
    const probe = vi.fn<ConnectionProbe>(async (_config, credential) => {
      expect(credential).toBe('bad-secret')
      return { status: 401 }
    })
    const service = new ProviderService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
      log,
      probe
    )
    await service.save(agentConfig, 'bad-secret')

    const result = await service.testConnection('agent')
    expect(result).toMatchObject({ ok: false, code: 'invalid_auth' })
    expect(JSON.stringify(result)).not.toContain('bad-secret')
    probe.mockResolvedValueOnce({ status: 200, providerCode: 'A0202' })
    await expect(service.testConnection('agent')).resolves.toMatchObject({
      ok: false,
      code: 'invalid_auth'
    })
    appDatabase.close()
  })

  it('rejects insecure Linux basic_text persistence and reports the backend', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(
      appDatabase,
      new FakeSafeStorage(true, 'basic_text'),
      log,
      'linux'
    )
    const service = new ProviderService(appDatabase, credentials, log, noProbe)

    expect(credentials.backendStatus()).toMatchObject({
      platform: 'linux',
      backend: 'basic_text',
      encryptionAvailable: true,
      securePersistence: false,
      persistenceAllowed: false
    })
    await appDatabase.kysely
      .insertInto('provider_configs')
      .values({
        id: 'agent',
        provider: 'openai-compatible',
        config_json: JSON.stringify(agentConfig),
        created_at: '2026-07-16T00:00:00.000Z',
        updated_at: '2026-07-16T00:00:00.000Z'
      })
      .execute()
    await appDatabase.kysely
      .insertInto('encrypted_credentials')
      .values({
        id: 'agent:api-key',
        provider_config_id: 'agent',
        ciphertext: new FakeSafeStorage(true, 'basic_text')
          .encryptString('legacy-unsafe')
          .toString('base64'),
        binding_fingerprint: credentialBindingFingerprint({
          providerConfigId: 'agent',
          provider: 'openai-compatible',
          configJson: JSON.stringify(agentConfig)
        }),
        created_at: '2026-07-16T00:00:00.000Z',
        updated_at: '2026-07-16T00:00:00.000Z'
      })
      .execute()
    await expect(credentials.withCredential('agent', async (value) => value)).rejects.toThrow(
      'basic_text'
    )
    await appDatabase.kysely.deleteFrom('provider_configs').where('id', '=', 'agent').execute()
    await expect(service.save(agentConfig, 'must-not-persist')).rejects.toThrow('basic_text')
    expect(await appDatabase.kysely.selectFrom('provider_configs').select('id').execute()).toEqual(
      []
    )
    appDatabase.close()
  })

  it('validates registered limits before durable configuration is written', async () => {
    const appDatabase = await database()
    const service = new ProviderService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
      log,
      noProbe
    )

    await expect(service.save({ ...agentConfig, batchLimit: 2 }, 'secret')).rejects.toThrow(
      'registered capability'
    )
    expect(await appDatabase.kysely.selectFrom('provider_configs').select('id').execute()).toEqual(
      []
    )
    appDatabase.close()
  })

  it('persists Gemini without an endpoint and reads only the legacy official marker', async () => {
    const appDatabase = await database()
    const service = new ProviderService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
      log,
      noProbe
    )

    let snapshot = await service.save(imageConfig, 'gemini-secret')
    expect(snapshot.providers.find((provider) => provider.role === 'image')?.config).toEqual(
      imageConfig
    )
    let stored = await appDatabase.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', 'image')
      .executeTakeFirstOrThrow()
    expect(stored.config_json).not.toContain('baseUrl')
    await appDatabase.kysely
      .updateTable('provider_configs')
      .set({
        config_json: JSON.stringify({
          ...imageConfig,
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
        })
      })
      .where('id', '=', 'image')
      .execute()
    snapshot = await service.snapshot()
    expect(snapshot.providers.find((provider) => provider.role === 'image')?.config).toEqual(
      imageConfig
    )
    await expect(
      service.save(
        {
          ...imageConfig,
          baseUrl: 'https://gemini-proxy.example.test'
        } as ProviderConfig,
        'gemini-secret'
      )
    ).rejects.toThrow()
    await expect(
      service.save(
        {
          ...imageConfig,
          model: 'gemini-custom-image'
        } as ProviderConfig,
        'gemini-secret'
      )
    ).rejects.toThrow()
    await service.save(imageConfig)
    stored = await appDatabase.kysely
      .selectFrom('provider_configs')
      .select('config_json')
      .where('id', '=', 'image')
      .executeTakeFirstOrThrow()
    expect(stored.config_json).not.toContain('baseUrl')
    appDatabase.close()
  })
})
