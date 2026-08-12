import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import type { AuthEvent } from '@earendil-works/pi-ai'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase, type AppDatabase } from '../app-db/connection'
import { AppSettingsRepository } from '../app-db/repositories/app-settings'
import { AgentProviderCatalogService } from './agent-provider-catalog'
import { CredentialService, type SafeStorageAdapter } from './credential-service'

const directories: string[] = []
const log = pino({ level: 'silent' })

registerBunOAuthFlows()

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

async function seedLegacyAgentConfig(
  database: AppDatabase,
  credentials: CredentialService
): Promise<string> {
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
  return ciphertext
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('AgentProviderCatalogService', () => {
  it('projects exact Pi Thinking levels only for built-in non-manual models', async () => {
    const { database, catalog } = await createHarness()
    const snapshot = await catalog.snapshot()
    expect(snapshot.defaultThinkingLevel).toBe('medium')
    const bedrock = snapshot.presets.find((preset) => preset.presetId === 'builtin:amazon-bedrock')
    const nova = bedrock?.models.find((model) => model.id === 'amazon.nova-2-lite-v1:0')

    expect(nova).toMatchObject({
      reasoning: true,
      supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high']
    })
    database.close()
  })

  it('loads the statically registered xAI OAuth device flow', async () => {
    const { database, catalog } = await createHarness()
    const controller = new AbortController()
    const notices: AuthEvent[] = []
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe('https://auth.x.ai/oauth2/device/code')
      return new Response(
        JSON.stringify({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.x.ai/activate',
          expires_in: 900,
          interval: 1
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      catalog.login('builtin:xai', 'oauth', {
        signal: controller.signal,
        prompt: async () => '',
        notify: (event) => {
          notices.push(event)
          controller.abort()
        }
      })
    ).rejects.toThrow('Login cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(notices).toEqual([
      expect.objectContaining({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.x.ai/activate'
      })
    ])
    database.close()
  })

  it('resolves and persists bounded custom Provider logo overrides', async () => {
    const { database, catalog } = await createHarness()
    const automatic = await catalog.saveCustomPreset({
      presetId: 'custom:deepseek',
      name: 'Legacy Agent - DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      authMode: 'none',
      timeoutMs: 30_000
    })
    expect(automatic.presets.find((preset) => preset.presetId === 'custom:deepseek')).toMatchObject(
      { logoId: 'deepseek', logoOverrideId: null }
    )

    const overridden = await catalog.saveCustomPreset({
      presetId: 'custom:deepseek',
      name: 'Legacy Agent - DeepSeek',
      logoOverrideId: 'openai',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      authMode: 'none',
      timeoutMs: 30_000
    })
    expect(
      overridden.presets.find((preset) => preset.presetId === 'custom:deepseek')
    ).toMatchObject({ logoId: 'openai', logoOverrideId: 'openai' })

    const preserved = await catalog.saveCustomPreset({
      presetId: 'custom:deepseek',
      name: 'DeepSeek renamed',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      authMode: 'none',
      timeoutMs: 30_000
    })
    expect(preserved.presets.find((preset) => preset.presetId === 'custom:deepseek')).toMatchObject(
      { logoId: 'openai', logoOverrideId: 'openai' }
    )

    const reset = await catalog.saveCustomPreset({
      presetId: 'custom:deepseek',
      name: 'DeepSeek renamed',
      logoOverrideId: null,
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      authMode: 'none',
      timeoutMs: 30_000
    })
    expect(reset.presets.find((preset) => preset.presetId === 'custom:deepseek')).toMatchObject({
      logoId: 'deepseek',
      logoOverrideId: null
    })

    await database.kysely
      .insertInto('provider_configs')
      .values({
        id: 'agent:custom:legacy-json',
        provider: 'writellm-custom:legacy-json',
        config_json: JSON.stringify({
          schemaVersion: 1,
          role: 'agent-preset',
          kind: 'custom',
          presetId: 'custom:legacy-json',
          providerId: 'writellm-custom:legacy-json',
          name: 'Legacy DeepSeek JSON',
          baseUrl: 'https://api.deepseek.com',
          api: 'openai-completions',
          authMode: 'none',
          timeoutMs: 30_000
        }),
        created_at: '2026-07-30T12:00:00.000Z',
        updated_at: '2026-07-30T12:00:00.000Z'
      })
      .execute()
    expect(
      (await catalog.snapshot()).presets.find((preset) => preset.presetId === 'custom:legacy-json')
    ).toMatchObject({ logoId: 'deepseek', logoOverrideId: null })
    database.close()
  })

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
    const renamed = await catalog.saveCustomPreset({
      presetId: 'custom:loopback',
      name: 'Loopback Renamed',
      baseUrl: 'https://models.example.test/v1',
      api: 'openai-responses',
      authMode: 'api_key',
      timeoutMs: 30_000
    })
    expect(renamed.presets.find((preset) => preset.presetId === 'custom:loopback')).toMatchObject({
      name: 'Loopback Renamed',
      catalogStatus: 'current',
      models: [{ id: 'writer-1' }, { id: 'writer-2' }]
    })

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
    const disabled = await catalog.setModelEnabled('custom:loopback', 'writer-2', false)
    expect(disabled.defaultSelection).toBeNull()
    await expect(
      catalog.resolve({ presetId: 'custom:loopback', modelId: 'writer-2' })
    ).rejects.toThrow('Agent model is disabled')

    fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    await expect(
      catalog.refreshPreset('custom:loopback', new AbortController().signal)
    ).rejects.toThrow('Agent model catalog refresh failed')
    expect(
      (await catalog.snapshot()).presets.find((preset) => preset.presetId === 'custom:loopback')
    ).toMatchObject({ catalogStatus: 'stale', models: [{ id: 'writer-1' }, { id: 'writer-2' }] })
    database.close()
  })

  it('keeps manual model overlays and rejects disabled selections', async () => {
    const { database, catalog } = await createHarness()
    await catalog.saveCustomPreset({
      presetId: 'custom:overlay',
      name: 'Overlay',
      baseUrl: 'https://models.example.test/v1',
      api: 'openai-responses',
      authMode: 'api_key',
      timeoutMs: 30_000,
      apiKey: 'overlay-secret'
    })
    await catalog.saveManualModel('custom:overlay', {
      id: 'writer-1',
      name: 'Manual Writer',
      api: 'openai-responses',
      contextWindow: 32_768,
      maxTokens: 4_096,
      reasoning: true,
      input: ['text', 'image']
    })

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: 'writer-1' }, { id: 'writer-2' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )
    const refreshed = await catalog.refreshPreset('custom:overlay', new AbortController().signal)
    expect(
      refreshed.presets.find((preset) => preset.presetId === 'custom:overlay')?.models
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'writer-1',
          name: 'Manual Writer',
          source: 'manual',
          enabled: true,
          reasoning: true,
          supportedThinkingLevels: ['off'],
          input: ['text', 'image']
        }),
        expect.objectContaining({ id: 'writer-2', source: 'discovered', enabled: true })
      ])
    )

    await catalog.setDefaultSelection({ presetId: 'custom:overlay', modelId: 'writer-1' })
    const disabled = await catalog.setModelEnabled('custom:overlay', 'writer-1', false)
    expect(disabled.defaultSelection).toBeNull()
    await expect(
      catalog.resolve({ presetId: 'custom:overlay', modelId: 'writer-1' })
    ).rejects.toThrow('Agent model is disabled')

    await catalog.setModelEnabled('custom:overlay', 'writer-1', true)
    await expect(
      catalog.resolve({ presetId: 'custom:overlay', modelId: 'writer-1' })
    ).resolves.toMatchObject({ model: { reasoning: false } })
    const withoutManual = await catalog.removeManualModel('custom:overlay', 'writer-1')
    expect(
      withoutManual.presets
        .find((preset) => preset.presetId === 'custom:overlay')
        ?.models.find((model) => model.id === 'writer-1')
    ).toMatchObject({ name: 'writer-1', source: 'discovered', enabled: true })
    database.close()
  })

  it('invalidates custom endpoint credentials and catalogs when the security identity changes', async () => {
    const { database, credentials, catalog } = await createHarness()
    await catalog.saveCustomPreset({
      presetId: 'custom:bound',
      name: 'Bound',
      baseUrl: 'https://models.example.test/v1',
      api: 'openai-responses',
      authMode: 'api_key',
      timeoutMs: 30_000,
      apiKey: 'first-secret'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: 'writer-1' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )
    await catalog.refreshPreset('custom:bound', new AbortController().signal)

    const sameOrigin = await catalog.saveCustomPreset({
      presetId: 'custom:bound',
      name: 'Bound renamed',
      baseUrl: 'https://models.example.test/v2',
      api: 'openai-responses',
      authMode: 'api_key'
    })
    expect(sameOrigin.presets.find((preset) => preset.presetId === 'custom:bound')).toMatchObject({
      authConfigured: true,
      catalogStatus: 'current',
      models: [{ id: 'writer-1' }]
    })
    expect(
      JSON.parse(
        (
          await database.kysely
            .selectFrom('provider_configs')
            .select('config_json')
            .where('id', '=', 'agent:custom:bound')
            .executeTakeFirstOrThrow()
        ).config_json
      )
    ).toMatchObject({ timeoutMs: 30_000 })

    const changedOrigin = await catalog.saveCustomPreset({
      presetId: 'custom:bound',
      name: 'Bound renamed',
      baseUrl: 'https://other.example.test/v2',
      api: 'openai-responses',
      authMode: 'api_key',
      timeoutMs: 45_000
    })
    expect(
      changedOrigin.presets.find((preset) => preset.presetId === 'custom:bound')
    ).toMatchObject({
      authConfigured: false,
      catalogStatus: 'empty',
      models: []
    })
    await expect(
      credentials.withCredential('agent:custom:bound', async (value) => value)
    ).rejects.toThrow('missing')

    const replaced = await catalog.saveCustomPreset({
      presetId: 'custom:bound',
      name: 'Bound renamed',
      baseUrl: 'https://other.example.test/v2',
      api: 'anthropic-messages',
      authMode: 'api_key',
      timeoutMs: 45_000,
      apiKey: 'replacement-secret'
    })
    expect(replaced.presets.find((preset) => preset.presetId === 'custom:bound')).toMatchObject({
      authConfigured: true,
      catalogStatus: 'empty'
    })
    await expect(
      credentials.withCredential('agent:custom:bound', async (value) => value)
    ).resolves.toBe(JSON.stringify({ type: 'api_key', key: 'replacement-secret' }))
    database.close()
  })

  it('rejects a streamed custom model catalog above 2 MiB before JSON parsing', async () => {
    const { database, catalog } = await createHarness()
    await catalog.saveCustomPreset({
      presetId: 'custom:oversized',
      name: 'Oversized',
      baseUrl: 'https://models.example.test/v1',
      api: 'openai-responses',
      authMode: 'api_key',
      timeoutMs: 30_000,
      apiKey: 'catalog-secret'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(
          new Response(`{"data":[{"id":"${'x'.repeat(2 * 1024 * 1024)}"}]}`, {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )

    await expect(
      catalog.refreshPreset('custom:oversized', new AbortController().signal)
    ).rejects.toThrow('Agent model catalog refresh failed')
    expect(
      (await catalog.snapshot()).presets.find((preset) => preset.presetId === 'custom:oversized')
    ).toMatchObject({ catalogStatus: 'empty', models: [] })
    database.close()
  })

  it('migrates a singleton Agent configuration without decrypting or removing it', async () => {
    const { database, credentials, catalog } = await createHarness()
    const ciphertext = await seedLegacyAgentConfig(database, credentials)

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

  it('permanently removes a disabled migrated legacy Agent configuration', async () => {
    const { database, credentials, catalog } = await createHarness()
    await seedLegacyAgentConfig(database, credentials)
    await catalog.snapshot()
    await catalog.setProviderEnabled('custom:legacy-agent', false)

    const removed = await catalog.removePreset('custom:legacy-agent')
    expect(removed.defaultSelection).toBeNull()
    expect(
      removed.presets.find((preset) => preset.presetId === 'custom:legacy-agent')
    ).toBeUndefined()

    const providerConfigIds = ['agent', 'agent:custom:legacy-agent']
    expect(
      await database.kysely
        .selectFrom('provider_configs')
        .select('id')
        .where('id', 'in', providerConfigIds)
        .execute()
    ).toEqual([])
    expect(
      await database.kysely
        .selectFrom('encrypted_credentials')
        .select('id')
        .where('provider_config_id', 'in', providerConfigIds)
        .execute()
    ).toEqual([])
    expect(
      await database.kysely
        .selectFrom('agent_model_catalogs')
        .select('provider_config_id')
        .where('provider_config_id', 'in', providerConfigIds)
        .execute()
    ).toEqual([])
    expect(
      await database.kysely
        .selectFrom('agent_provider_preferences')
        .select('provider_config_id')
        .where('provider_config_id', 'in', providerConfigIds)
        .execute()
    ).toEqual([])
    expect(
      await database.kysely
        .selectFrom('agent_model_preferences')
        .select('provider_config_id')
        .where('provider_config_id', 'in', providerConfigIds)
        .execute()
    ).toEqual([])

    const nextSnapshot = await catalog.snapshot()
    expect(
      nextSnapshot.presets.find((preset) => preset.presetId === 'custom:legacy-agent')
    ).toBeUndefined()
    database.close()
  })
})
