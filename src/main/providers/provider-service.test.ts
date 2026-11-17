import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  providerSettingsSnapshotSchema,
  type ProviderConfig
} from '../../shared/contracts/providers'
import { openDatabase } from '../db/open-database'
import type { AppDatabaseSchema } from '../app-db/database-types'
import { appMigrations } from '../app-db/migrations'
import {
  APP_DATABASE_APPLICATION_ID,
  openAppDatabase,
  type AppDatabase
} from '../app-db/connection'
import { AppSettingsRepository } from '../app-db/repositories/app-settings'
import { CredentialService, type SafeStorageAdapter } from './credential-service'
import { credentialBindingFingerprint } from './credential-binding'
import { ProviderService, type ConnectionProbe } from './provider-service'
import { AgentProviderCatalogService } from './agent-provider-catalog'

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

class FakeSafeStorage implements SafeStorageAdapter {
  constructor(
    private readonly available = true,
    private readonly backend = 'kwallet6'
  ) {}

  async isAsyncEncryptionAvailable(): Promise<boolean> {
    return this.available
  }

  async encryptStringAsync(value: string): Promise<Buffer> {
    return Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5))
  }

  async decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    return {
      result: Buffer.from(value.map((byte) => byte ^ 0xa5)).toString('utf8'),
      shouldReEncrypt: false
    }
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

function providerService(
  appDatabase: AppDatabase,
  credentials: CredentialService,
  probe: ConnectionProbe = noProbe
): ProviderService {
  let nextSourceId = 0
  return new ProviderService(
    appDatabase,
    credentials,
    new AppSettingsRepository(appDatabase, log),
    log,
    probe,
    () => new Date().toISOString(),
    () => `img-${++nextSourceId}`
  )
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('ProviderService', () => {
  it.each([3, 12])(
    'opens a v%i incomplete singleton and repairs it without rebinding its old credential',
    async (version) => {
      const directory = await mkdtemp(join(tmpdir(), 'writellm-old-singleton-'))
      directories.push(directory)
      const options = { path: join(directory, 'app.sqlite'), applicationVersion: 'test', log }
      const old = await openDatabase<AppDatabaseSchema>({
        ...options,
        applicationId: APP_DATABASE_APPLICATION_ID,
        databaseRole: 'app',
        migrations: appMigrations.filter((m) => m.version <= version)
      })
      const stamp = new Date().toISOString()
      const original = {
        role: 'embedding' as const,
        providerId: 'openai-compatible' as const,
        baseUrl: 'https://original.example.test/v1'
      }
      try {
        await old.kysely
          .insertInto('provider_configs')
          .values({
            id: 'embedding',
            provider: original.providerId,
            config_json: JSON.stringify(original),
            created_at: stamp,
            updated_at: stamp
          })
          .execute()
        if (version === 12) {
          const oldCredentials = new CredentialService(old, new FakeSafeStorage(), log, 'linux')
          await oldCredentials.persistEncrypted(
            'embedding',
            await oldCredentials.encryptForPersistence('original-key')
          )
        }
      } finally {
        old.close()
      }
      const db = await openAppDatabase(options)
      try {
        const credentials = new CredentialService(db, new FakeSafeStorage(), log, 'linux')
        const service = providerService(db, credentials)
        const upgraded = await service.snapshot()
        expect(upgraded.purposeCatalog.embedding).toEqual({ sources: [], defaultSelection: null })
        expect(await credentials.hasCredential('embedding')).toBe(version === 12)
        expect(
          (
            await db.kysely
              .selectFrom('provider_configs')
              .select('config_json')
              .where('id', '=', 'embedding')
              .executeTakeFirstOrThrow()
          ).config_json
        ).toBe(JSON.stringify(original))
        const config = {
          ...original,
          baseUrl: 'https://replacement.example.test/v1',
          model: 'embed',
          modelRevision: 'v1',
          embeddingDimension: 8,
          timeoutMs: 2000,
          batchLimit: 1,
          fileSizeLimitMb: null
        }
        const repaired = await service.save(config)
        expect(repaired.purposeCatalog.embedding.defaultSelection).toEqual({
          sourceId: 'legacy',
          configId: 'legacy'
        })
        expect(await credentials.hasCredential('embedding')).toBe(false)
        await service.save(config, 'replacement-key')
        await expect(
          service.withConfiguredProvider('embedding', async (resolved, key) => [
            resolved.baseUrl,
            key
          ])
        ).resolves.toEqual([config.baseUrl, 'replacement-key'])
      } finally {
        db.close()
      }
    }
  )
  it('keeps purpose defaults explicit and binds credentials to the resolved connection', async () => {
    const db = await database()
    const credentials = new CredentialService(db, new FakeSafeStorage(), log, 'linux')
    const service = providerService(db, credentials)
    const purpose = service.purpose
    const role = 'rerank' as const
    const source = {
      role,
      providerId: 'cohere-compatible' as const,
      name: 'Local reranker',
      enabled: true,
      baseUrl: 'https://first.example.test',
      timeoutMs: 1000,
      batchLimit: 10,
      fileSizeLimitMb: null
    }
    try {
      const added = await purpose.savePurposeSource({ source })
      const sourceId = added.purposeCatalog[role].sources[0].sourceId
      const model = {
        modelId: 'rerank',
        modelRevision: 'v1',
        enabled: true,
        embeddingDimension: null,
        mode: null
      }
      const models = await purpose.savePurposeModel({ role, sourceId, model })
      const configId = models.purposeCatalog[role].sources[0].models[0].configId
      const selection = { sourceId, configId }
      expect(models.purposeCatalog[role].defaultSelection).toBeNull()
      await expect(purpose.setPurposeDefault({ role, selection })).rejects.toThrow('credential')
      await purpose.savePurposeSource({ sourceId, source, apiKey: 'first-token' })
      await purpose.setPurposeDefault({ role, selection })
      const resolved = await purpose.resolve(role)
      const changed = await purpose.savePurposeSource({
        sourceId,
        source: { ...source, baseUrl: 'https://second.example.test' }
      })
      expect(changed.purposeCatalog[role]).toMatchObject({
        defaultSelection: selection,
        sources: [{ authConfigured: false, available: false }]
      })
      await purpose.savePurposeSource({
        sourceId,
        source: { ...source, baseUrl: 'https://second.example.test' },
        apiKey: 'second-token'
      })
      const staleOperation = vi.fn(async () => true)
      await expect(purpose.withResolved(resolved, staleOperation)).rejects.toThrow('credential')
      expect(staleOperation).not.toHaveBeenCalled()
      await expect(
        purpose.withResolved(await purpose.resolve(role), async (config, key) => [
          config.baseUrl,
          key
        ])
      ).resolves.toEqual(['https://second.example.test', 'second-token'])
      const disabled = await purpose.setPurposeModelEnabled({ role, ...selection, enabled: false })
      expect(disabled.purposeCatalog[role].defaultSelection).toBeNull()
      await expect(purpose.resolve(role, selection)).rejects.toThrow('unavailable')
    } finally {
      db.close()
    }
  })
  it('retains an unavailable speech default and prevents anonymous dispatch when a stored credential binding does not match', async () => {
    const db = await database()
    try {
      const service = providerService(
        db,
        new CredentialService(db, new FakeSafeStorage(), log, 'linux')
      )
      await service.save(
        {
          role: 'speech',
          providerId: 'openai-compatible',
          baseUrl: 'https://speech.example.test',
          model: 'voice',
          mode: 'file',
          timeoutMs: 1000,
          batchLimit: 1,
          fileSizeLimitMb: null,
          embeddingDimension: null
        },
        'bound-key'
      )
      await db.kysely
        .updateTable('encrypted_credentials')
        .set({ binding_fingerprint: 'a'.repeat(64) })
        .where('provider_config_id', '=', 'speech')
        .execute()
      const { speech } = (await service.snapshot()).purposeCatalog
      expect(speech.defaultSelection).toEqual({ sourceId: 'legacy', configId: 'legacy' })
      expect(speech.sources[0]).toMatchObject({
        available: false,
        authConfigured: false,
        issues: ['Save the credential again for this source.']
      })
      const operation = vi.fn(async () => true)
      await expect(service.withSpeechProvider(operation)).rejects.toThrow('credential')
      expect(operation).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })
  it('stores one speech mode, permits no-key loopback and clears credentials on origin change', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const service = providerService(appDatabase, credentials)
    const config: ProviderConfig = {
      role: 'speech',
      providerId: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8787/prefix/v1',
      model: 'whisper',
      mode: 'file',
      timeoutMs: 60000,
      batchLimit: 1,
      embeddingDimension: null,
      fileSizeLimitMb: null
    }
    try {
      const initial = providerSettingsSnapshotSchema.parse(await service.save(config))
      expect(initial.providers.find((provider) => provider.role === 'speech')).toMatchObject({
        available: true,
        config: { mode: 'file' }
      })
      await service.withSpeechProvider(async (current, key) => {
        expect(current.baseUrl).toBe(config.baseUrl)
        expect(key).toBeUndefined()
      })
      await service.save(config, 'speech-secret')
      await service.withSpeechProvider(async (_current, key) => {
        expect(key).toBe('speech-secret')
      })
      await service.save({ ...config, baseUrl: 'http://127.0.0.1:8787/other/v1', mode: 'realtime' })
      expect(await credentials.hasCredential('speech')).toBe(true)
      await service.save({ ...config, baseUrl: 'http://localhost:8787/v1' })
      expect(await credentials.hasCredential('speech')).toBe(false)
      const rows = await appDatabase.kysely
        .selectFrom('provider_configs')
        .select('id')
        .where('id', '=', 'speech')
        .execute()
      expect(rows).toEqual([{ id: 'speech' }])
      expect((await service.testConnection('speech')).ok).toBe(false)
    } finally {
      appDatabase.close()
    }
  })

  it('builds one final catalog for real preset, manual-model and availability writes', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const catalog = new AgentProviderCatalogService(
      appDatabase,
      credentials,
      new AppSettingsRepository(appDatabase, log),
      log
    )
    const probe = vi.fn<ConnectionProbe>()
    const service = providerService(appDatabase, credentials, probe)
    service.setAgentCatalog(catalog)
    const snapshot = vi.spyOn(catalog, 'snapshot')
    try {
      const created = await service.saveAgentCustomPreset({
        presetId: 'custom:once',
        name: 'Once',
        api: 'openai-responses',
        baseUrl: 'https://models.example.test/v1',
        authMode: 'none'
      })
      expect(created.agentCatalog.presets).toEqual(
        expect.arrayContaining([expect.objectContaining({ presetId: 'custom:once' })])
      )
      expect(snapshot).toHaveBeenCalledTimes(1)
      snapshot.mockClear()
      const saved = await service.saveAgentManualModel('custom:once', {
        id: 'manual-once',
        name: 'Manual Once',
        api: 'openai-responses',
        contextWindow: 32768,
        maxTokens: 4096,
        reasoning: false,
        input: ['text']
      })
      expect(
        saved.agentCatalog.presets.find((preset) => preset.presetId === 'custom:once')?.models
      ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'manual-once' })]))
      expect(snapshot).toHaveBeenCalledTimes(1)
      snapshot.mockClear()
      const selection = { presetId: 'custom:once', modelId: 'manual-once' }
      probe.mockRejectedValueOnce(new Error('private SDK diagnostic'))
      await expect(service.testAgentPreset(selection)).resolves.toMatchObject({
        ok: false,
        code: 'network_error',
        message: 'Provider connection failed.'
      })
      probe.mockResolvedValueOnce({ status: 401 })
      await expect(service.testAgentPreset(selection)).resolves.toMatchObject({
        ok: false,
        code: 'invalid_auth'
      })
      expect(probe).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'manual-once', presetId: 'custom:once' }),
        '{}',
        expect.any(AbortSignal),
        expect.objectContaining({ id: 'manual-once' })
      )
      await service.setAgentModelEnabled('custom:once', 'manual-once', false)
      expect(snapshot).toHaveBeenCalledTimes(1)
    } finally {
      snapshot.mockRestore()
      appDatabase.close()
    }
  })
  it('persists only ciphertext, reports status, replaces keys, and removes the provider', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const service = providerService(appDatabase, credentials)

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

  it.each(['agent', 'embedding', 'rerank'] as const)(
    'persists HTTP %s endpoints and invalidates credentials on protocol changes',
    async (role) => {
      const appDatabase = await database()
      const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
      const service = providerService(appDatabase, credentials)
      const config = {
        ...agentConfig,
        role,
        providerId: role === 'rerank' ? 'cohere-compatible' : 'openai-compatible',
        embeddingDimension: role === 'embedding' ? 8 : null
      } as ProviderConfig
      await service.save(config, 'https-secret')
      const httpConfig = { ...config, baseUrl: 'http://api.example.test/v1' }
      await service.save(httpConfig)
      await expect(credentials.withCredential(role, async (value) => value)).rejects.toThrow(
        'missing'
      )
      await service.save(httpConfig, 'http-secret')
      const reloaded = providerService(appDatabase, credentials)
      expect(
        (await reloaded.snapshot()).providers.find((provider) => provider.role === role)
      ).toMatchObject({ config: httpConfig, configured: true })
      await expect(credentials.withCredential(role, async (value) => value)).resolves.toBe(
        'http-secret'
      )
      appDatabase.close()
    }
  )

  it.each(['embedding', 'rerank', 'mineru'] as const)(
    'keeps the legacy %s diagnostic local until a credential is configured',
    async (role) => {
      const appDatabase = await database()
      const probe = vi.fn<ConnectionProbe>().mockResolvedValue({ status: 200 })
      const service = providerService(
        appDatabase,
        new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
        probe
      )
      try {
        expect((await service.testConnection(role)).code).toBe('missing_config')
        const config = {
          ...agentConfig,
          role,
          providerId:
            role === 'mineru'
              ? 'mineru'
              : role === 'rerank'
                ? 'cohere-compatible'
                : 'openai-compatible',
          model: role === 'mineru' ? 'vlm' : 'example-model',
          embeddingDimension: role === 'embedding' ? 3 : null,
          fileSizeLimitMb: role === 'mineru' ? 64 : null
        } as ProviderConfig
        await service.save(config)
        expect((await service.testConnection(role)).code).toBe('missing_credential')
        expect(probe).not.toHaveBeenCalled()
        await service.save(config, 'fixture-key')
        expect((await service.testConnection(role)).ok).toBe(true)
        expect(probe).toHaveBeenCalledTimes(1)
        await service.remove(role)
        expect((await service.testConnection(role)).code).toBe('missing_config')
      } finally {
        appDatabase.close()
      }
    }
  )

  it('reports a missing key before attempting the network request', async () => {
    const appDatabase = await database()
    const probe = vi.fn<ConnectionProbe>()
    const service = providerService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
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
    const service = providerService(appDatabase, credentials)
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
    const service = providerService(appDatabase, credentials)
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
    const service = providerService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
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
    probe.mockResolvedValueOnce({ status: 200, invalidResponse: true })
    await expect(service.testConnection('agent')).resolves.toMatchObject({
      ok: false,
      code: 'provider_rejected',
      message: 'Provider returned an invalid response.'
    })
    appDatabase.close()
  })

  it('tests Vertex with ambient ADC and rejects any supplied Vertex API key', async () => {
    const appDatabase = await database()
    const probe = vi.fn<ConnectionProbe>(async (config, credential) => {
      expect(config).toMatchObject({
        providerId: 'google-vertex',
        projectId: 'writellm-images-123',
        model: 'gemini-2.5-flash-image'
      })
      expect(credential).toBeUndefined()
      return { status: 403 }
    })
    const service = providerService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux'),
      probe
    )
    const source = {
      providerId: 'google-vertex' as const,
      name: 'Vertex',
      projectId: 'writellm-images-123'
    }

    await expect(service.saveImageSource({ source, apiKey: 'must-not-be-stored' })).rejects.toThrow(
      'Application Default Credentials'
    )
    const snapshot = await service.saveImageSource({ source })
    expect(snapshot.imageCatalog.defaultSelection).toBeNull()
    await expect(service.testImageSource('img-1')).resolves.toMatchObject({
      ok: false,
      code: 'invalid_auth',
      message: expect.stringContaining('local ADC')
    })
    expect(probe).toHaveBeenCalledOnce()
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
    const service = providerService(appDatabase, credentials)

    expect(await credentials.backendStatus()).toMatchObject({
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
        ciphertext: (
          await new FakeSafeStorage(true, 'basic_text').encryptStringAsync('legacy-unsafe')
        ).toString('base64'),
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
    const service = providerService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    )

    await expect(service.save({ ...agentConfig, batchLimit: 2 }, 'secret')).rejects.toThrow(
      'registered capability'
    )
    expect(await appDatabase.kysely.selectFrom('provider_configs').select('id').execute()).toEqual(
      []
    )
    appDatabase.close()
  })

  it.each(['request', 'probe'] as const)(
    'blocks an image %s when another origin replaces the resolved credential',
    async (kind) => {
      const appDatabase = await database()
      const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
      const probe = vi.fn<ConnectionProbe>(async () => ({ status: 200 }))
      const service = providerService(appDatabase, credentials, probe)
      try {
        const source = {
          providerId: 'openai' as const,
          name: 'Gateway',
          baseUrl: 'https://original.example.test/v1'
        }
        await service.saveImageSource({ source, apiKey: 'original-key' })
        const withCredential = credentials.withCredential.bind(credentials)
        vi.spyOn(credentials, 'withCredential').mockImplementationOnce(
          async (id, callback, binding) => {
            await service.saveImageSource({
              sourceId: 'img-1',
              source: { ...source, baseUrl: 'https://replacement.example.test/v1' },
              apiKey: 'replacement-key'
            })
            return withCredential(id, callback, binding)
          }
        )
        const operation = vi.fn(async () => undefined)
        if (kind === 'request') {
          await expect(
            service.withImageProvider({ sourceId: 'img-1', modelId: 'gpt-image-2' }, operation)
          ).rejects.toThrow('credential')
        } else {
          await expect(service.testImageSource('img-1', 'gpt-image-2')).resolves.toMatchObject({
            ok: false,
            code: 'missing_credential'
          })
        }
        expect(probe).not.toHaveBeenCalled()
        expect(operation).not.toHaveBeenCalled()
      } finally {
        appDatabase.close()
      }
    }
  )

  it('rejects a default model disabled while its credential is checked', async () => {
    const appDatabase = await database()
    const service = providerService(
      appDatabase,
      new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    )
    const selection = { sourceId: 'img-1', modelId: 'gpt-image-2' }
    try {
      await service.saveImageSource({
        source: { providerId: 'openai', name: 'Images' },
        apiKey: 'saved-key'
      })
      const resolve = service.resolveImageSelection.bind(service)
      vi.spyOn(service, 'resolveImageSelection').mockImplementationOnce(async (input) => {
        const config = await resolve(input)
        await service.setImageModelEnabled(selection.sourceId, selection.modelId, false)
        return config
      })
      await expect(service.setImageDefaultSelection(selection)).rejects.toThrow()
      expect((await service.snapshot()).imageCatalog.defaultSelection).toBeNull()
    } finally {
      appDatabase.close()
    }
  })

  it('keeps several instances of one transport independently bound to their endpoints', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const service = providerService(appDatabase, credentials)

    let snapshot = await service.saveImageSource({
      source: { providerId: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'official-secret'
    })
    expect(snapshot.imageCatalog.defaultSelection).toBeNull()
    await service.setImageDefaultSelection({ sourceId: 'img-1', modelId: 'gpt-image-2' })
    const official = snapshot.imageCatalog.sources[0]
    expect(official).toMatchObject({ sourceId: 'img-1', name: 'OpenAI', available: true })
    expect(official?.config).not.toHaveProperty('baseUrl')

    snapshot = await service.saveImageSource({
      source: { providerId: 'openai', name: 'Gateway', baseUrl: 'https://gateway.example.test/v1' },
      apiKey: 'gateway-secret'
    })
    expect(snapshot.imageCatalog.sources.map((source) => source.sourceId)).toEqual([
      'img-1',
      'img-2'
    ])
    expect(snapshot.imageCatalog.defaultSelection?.sourceId).toBe('img-1')
    await expect(credentials.withCredential('image:img-1', async (value) => value)).resolves.toBe(
      'official-secret'
    )
    await expect(credentials.withCredential('image:img-2', async (value) => value)).resolves.toBe(
      'gateway-secret'
    )

    snapshot = await service.saveImageSource({
      sourceId: 'img-2',
      source: {
        providerId: 'openai',
        name: 'Renamed gateway',
        baseUrl: 'https://gateway.example.test/v1'
      }
    })
    expect(snapshot.imageCatalog.sources[1]).toMatchObject({
      name: 'Renamed gateway',
      available: true
    })
    snapshot = await service.saveImageSource({
      sourceId: 'img-2',
      source: {
        providerId: 'openai',
        name: 'Renamed gateway',
        baseUrl: 'https://other.example.test/v1'
      }
    })
    expect(snapshot.imageCatalog.sources[1]).toMatchObject({ configured: false, available: false })
    await expect(
      service.saveImageSource({ sourceId: 'img-2', source: { providerId: 'xai', name: 'Changed' } })
    ).rejects.toThrow('transport')

    await expect(
      service.withImageProvider(
        { sourceId: 'img-1', modelId: 'gpt-image-2' },
        async (config, key) => ({
          config,
          key
        })
      )
    ).resolves.toEqual({
      config: expect.objectContaining({
        providerId: 'openai',
        sourceId: 'img-1',
        model: 'gpt-image-2',
        imageSizes: ['1K', '2K']
      }),
      key: 'official-secret'
    })
    await expect(
      service.resolveImageSelection({ sourceId: 'img-2', modelId: 'gpt-image-2' })
    ).rejects.toThrow('not authenticated')

    snapshot = await service.removeImageSource('img-1')
    expect(snapshot.imageCatalog.defaultSelection).toBeNull()
    await expect(service.getConfiguredProvider('image')).rejects.toThrow('No image model')
    appDatabase.close()
  })

  it('combines built-in and manual models and never substitutes a disabled selection', async () => {
    const appDatabase = await database()
    const credentials = new CredentialService(appDatabase, new FakeSafeStorage(), log, 'linux')
    const service = providerService(appDatabase, credentials)
    await service.saveImageSource({
      source: { providerId: 'google-gemini', name: 'Gemini' },
      apiKey: 'gemini-secret'
    })

    let snapshot = await service.saveImageManualModel('img-1', {
      id: 'gemini-next-image',
      name: 'Gemini Next',
      imageSizes: ['1K', '2K']
    })
    expect(
      snapshot.imageCatalog.sources[0]?.models.map((model) => [model.id, model.source])
    ).toEqual([
      ['gemini-3.1-flash-lite-image', 'builtin'],
      ['gemini-3.1-flash-image', 'builtin'],
      ['gemini-3-pro-image', 'builtin'],
      ['gemini-2.5-flash-image', 'builtin'],
      ['gemini-next-image', 'manual']
    ])
    await expect(
      service.saveImageManualModel('img-1', {
        id: 'gemini-3-pro-image',
        name: 'Duplicate',
        imageSizes: ['1K']
      })
    ).rejects.toThrow('Built-in')

    snapshot = await service.setImageDefaultSelection({
      sourceId: 'img-1',
      modelId: 'gemini-next-image'
    })
    expect(snapshot.providers.find((provider) => provider.role === 'image')).toMatchObject({
      available: true,
      config: expect.objectContaining({ model: 'gemini-next-image', imageSizes: ['1K', '2K'] })
    })
    snapshot = await service.setImageModelEnabled('img-1', 'gemini-next-image', false)
    expect(snapshot.imageCatalog.defaultSelection).toBeNull()
    await expect(
      service.resolveImageSelection({ sourceId: 'img-1', modelId: 'gemini-next-image' })
    ).rejects.toThrow('disabled')
    await expect(
      service.setImageDefaultSelection({ sourceId: 'img-1', modelId: 'gemini-next-image' })
    ).rejects.toThrow('disabled')

    await service.setImageDefaultSelection({ sourceId: 'img-1', modelId: 'gemini-3-pro-image' })
    await expect(
      service.resolveImageSelection({ sourceId: 'img-1', modelId: 'gemini-2.5-flash-image' })
    ).resolves.toMatchObject({ model: 'gemini-2.5-flash-image', imageSizes: ['1K'] })
    snapshot = await service.removeImageManualModel('img-1', 'gemini-next-image')
    expect(snapshot.imageCatalog.sources[0]?.config?.disabledModelIds).toEqual([])
    expect(snapshot.imageCatalog.defaultSelection).toEqual({
      sourceId: 'img-1',
      modelId: 'gemini-3-pro-image'
    })
    appDatabase.close()
  })
})
