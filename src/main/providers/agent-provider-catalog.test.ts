import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase, type AppDatabase } from '../app-db/connection'
import { AppSettingsRepository } from '../app-db/repositories/app-settings'
import { AgentProviderCatalogService } from './agent-provider-catalog'
import { CredentialService, type SafeStorageAdapter } from './credential-service'

const directories: string[] = []
const log = pino({ level: 'silent' })

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean {
    return true
  }

  encryptString(value: string): Buffer {
    return Buffer.from(value, 'utf8')
  }

  decryptString(value: Buffer): string {
    return value.toString('utf8')
  }

  getSelectedStorageBackend(): string {
    return 'keychain'
  }
}

async function createHarness(): Promise<{
  database: AppDatabase
  credentials: CredentialService
  catalog: AgentProviderCatalogService
}> {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-agent-catalog-'))
  directories.push(directory)
  const database = await openAppDatabase({
    path: join(directory, 'app.sqlite'),
    applicationVersion: 'test',
    log
  })
  const credentials = new CredentialService(database, new FakeSafeStorage(), log, 'darwin')
  return {
    database,
    credentials,
    catalog: new AgentProviderCatalogService(
      database,
      credentials,
      new AppSettingsRepository(database, log),
      log,
      () => new Date('2026-07-30T12:00:00.000Z')
    )
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('AgentProviderCatalogService', () => {
  it('discovers and caches a custom endpoint only on explicit refresh', async () => {
    const { database, catalog } = await createHarness()
    const saved = await catalog.saveCustomPreset({
      presetId: 'custom:loopback',
      name: 'Loopback',
      baseUrl: 'https://models.example.test/v1',
      api: 'openai-responses',
      authMode: 'api_key',
      timeoutMs: 30_000,
      apiKey: 'catalog-secret'
    })
    expect(saved.presets.find((preset) => preset.presetId === 'custom:loopback')).toMatchObject({
      authConfigured: true,
      catalogStatus: 'empty',
      models: []
    })

    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer catalog-secret')
      return new Response(
        JSON.stringify({ data: [{ id: 'writer-1' }, { id: 'writer-2', displayName: 'Writer 2' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const refreshed = await catalog.refreshPreset('custom:loopback', new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(refreshed.presets.find((preset) => preset.presetId === 'custom:loopback')).toMatchObject(
      {
        catalogStatus: 'current',
        models: [
          { id: 'writer-1', api: 'openai-responses' },
          { id: 'writer-2', name: 'Writer 2', api: 'openai-responses' }
        ]
      }
    )

    await catalog.setDefaultSelection({ presetId: 'custom:loopback', modelId: 'writer-2' })
    const resolved = await catalog.resolve({
      presetId: 'custom:loopback',
      modelId: 'writer-2'
    })
    expect(resolved).toMatchObject({
      presetId: 'custom:loopback',
      providerId: 'writellm-custom:loopback',
      auth: { auth: { apiKey: 'catalog-secret' } }
    })
    expect(JSON.stringify(await catalog.snapshot())).not.toContain('catalog-secret')

    fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    await expect(
      catalog.refreshPreset('custom:loopback', new AbortController().signal)
    ).rejects.toThrow('Agent model catalog refresh failed')
    expect(
      (await catalog.snapshot()).presets.find((preset) => preset.presetId === 'custom:loopback')
    ).toMatchObject({ catalogStatus: 'stale', models: [{ id: 'writer-1' }, { id: 'writer-2' }] })
    database.close()
  })

  it('migrates a singleton Agent configuration without decrypting or removing it', async () => {
    const { database, credentials, catalog } = await createHarness()
    const now = '2026-07-01T12:00:00.000Z'
    await database.kysely
      .insertInto('provider_configs')
      .values({
        id: 'agent',
        provider: 'openai-compatible',
        config_json: JSON.stringify({
          role: 'agent',
          providerId: 'openai-compatible',
          baseUrl: 'https://legacy.example.test/v1',
          model: 'legacy-writer',
          modelRevision: 'legacy-r1',
          timeoutMs: 60_000,
          embeddingDimension: null,
          batchLimit: 1,
          fileSizeLimitMb: null
        }),
        created_at: now,
        updated_at: now
      })
      .execute()
    const ciphertext = credentials.encryptForPersistence('legacy-secret')
    await credentials.persistEncrypted('agent', ciphertext)

    const snapshot = await catalog.snapshot()
    expect(snapshot.defaultSelection).toEqual({
      presetId: 'custom:legacy-agent',
      modelId: 'legacy-writer'
    })
    expect(
      snapshot.presets.find((preset) => preset.presetId === 'custom:legacy-agent')
    ).toMatchObject({
      name: 'Legacy Agent',
      authConfigured: true,
      models: [{ id: 'legacy-writer' }]
    })
    const copied = await database.kysely
      .selectFrom('encrypted_credentials')
      .select('ciphertext')
      .where('provider_config_id', '=', 'agent:custom:legacy-agent')
      .executeTakeFirstOrThrow()
    expect(copied.ciphertext).toBe(ciphertext)
    expect(
      await database.kysely
        .selectFrom('provider_configs')
        .select('id')
        .where('id', '=', 'agent')
        .executeTakeFirst()
    ).toBeDefined()
    database.close()
  })
})
