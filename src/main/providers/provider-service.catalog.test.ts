import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase } from '../app-db/connection'
import { AppSettingsRepository } from '../app-db/repositories/app-settings'
import { CredentialService } from './credential-service'
import { ProviderService } from './provider-service'
import { SourceModelDiscoveryError, type discoverSourceModels } from './source-model-discovery'
import type { SourceModelCandidate } from '../../shared/contracts/providers'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'writellm-source-catalog-'))
  roots.push(root)
  const log = pino({ enabled: false })
  const db = await openAppDatabase({
    path: join(root, 'app.sqlite'),
    applicationVersion: 'test',
    log
  })
  const credentials = new CredentialService(
    db,
    {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value) => Buffer.from(value),
      decryptStringAsync: async (value) => ({ result: value.toString(), shouldReEncrypt: false }),
      getSelectedStorageBackend: () => 'keychain'
    },
    log,
    'darwin'
  )
  const settings = new AppSettingsRepository(db, log)
  const discover = vi.fn<typeof discoverSourceModels>(async () => [
    { id: 'fresh-model', name: 'Fresh model' }
  ])
  const service = new ProviderService(
    db,
    credentials,
    settings,
    log,
    async () => ({ status: 200 }),
    () => new Date().toISOString(),
    () => 'image-fixture',
    discover
  )
  const create = async (
    name = 'Local',
    baseUrl = 'http://localhost:8787/proxy/v1',
    apiKey?: string
  ) => {
    const snapshot = await service.saveSpeechSource({
      source: { name, baseUrl, model: 'manual-model', mode: 'file' },
      ...(apiKey === undefined ? {} : { apiKey })
    })
    const source = snapshot.speechCatalog.sources.find((source) => source.name === name)
    if (!source) throw new Error('Missing source')
    return source.sourceId
  }
  return { db, credentials, settings, service, discover, create }
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
describe('source model catalogs', () => {
  it('discards a refresh after its endpoint changes and returns to the original value', async () => {
    const { service, discover, create, db } = await setup()
    const wait = deferred<SourceModelCandidate[]>()
    try {
      const id = await create()
      discover.mockImplementationOnce(() => wait.promise)
      const refresh = service.refreshSpeechModels(id)
      await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
      for (const baseUrl of ['http://localhost:8787/other/v1', 'http://localhost:8787/proxy/v1'])
        await service.saveSpeechSource({
          sourceId: id,
          source: { name: 'Local', baseUrl, model: 'manual-model', mode: 'file' }
        })
      wait.resolve([{ id: 'obsolete', name: 'Obsolete' }])
      expect((await refresh).speechCatalog.sources[0].modelCandidates).toEqual([])
    } finally {
      db.close()
    }
  })

  it('keeps a capture provider snapshot when selection, endpoint and key change during permission preparation', async () => {
    const { service, create, db } = await setup()
    const entered = deferred<void>()
    const permission = deferred<void>()
    try {
      const first = await create('First', 'https://first.example.test/v1', 'first-key')
      const second = await create('Second', 'https://second.example.test/v1', 'second-key')
      await service.setActiveSpeechSource(first)
      const capture = service.withSpeechProvider(async (config, key) => {
        entered.resolve()
        await permission.promise
        return { config, key }
      })
      await entered.promise
      await service.setActiveSpeechSource(second)
      await service.saveSpeechSource({
        sourceId: first,
        source: {
          name: 'Changed',
          baseUrl: 'https://changed.example.test/v1',
          model: 'changed-model',
          mode: 'realtime'
        },
        apiKey: 'changed-key'
      })
      permission.resolve()
      expect(await capture).toMatchObject({
        config: { baseUrl: 'https://first.example.test/v1', model: 'manual-model', mode: 'file' },
        key: 'first-key'
      })
      await service.withConfiguredProvider('speech', async (config, key) => {
        expect(config.baseUrl).toBe('https://second.example.test/v1')
        expect(key).toBe('second-key')
      })
    } finally {
      db.close()
    }
  })
  it('does not revive a removed legacy source catalog after the same storage identity is recreated', async () => {
    const { service, discover, db } = await setup()
    const wait = deferred<SourceModelCandidate[]>()
    const config = {
      role: 'speech' as const,
      providerId: 'openai-compatible' as const,
      baseUrl: 'http://localhost:8787/v1',
      model: 'manual-model',
      mode: 'file' as const,
      timeoutMs: 60000,
      batchLimit: 1,
      embeddingDimension: null,
      fileSizeLimitMb: null
    }
    try {
      await service.save(config, 'same-key')
      discover.mockImplementationOnce(() => wait.promise)
      const refresh = service.refreshSpeechModels('legacy')
      await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
      await service.removeSpeechSource('legacy')
      await service.save(config, 'same-key')
      wait.resolve([{ id: 'obsolete', name: 'Obsolete' }])
      expect((await refresh).speechCatalog.sources[0].modelCandidates).toEqual([])
      expect(await db.kysely.selectFrom('source_model_catalogs').selectAll().execute()).toEqual([])
    } finally {
      db.close()
    }
  })
  it('bounds concurrent source creation to fifty persisted sources', async () => {
    const { service, db } = await setup()
    try {
      const now = new Date().toISOString()
      await db.kysely
        .insertInto('provider_configs')
        .values(
          Array.from({ length: 48 }, (_, index) => {
            const sourceId = `sp-${index}`
            return {
              id: `speech:${sourceId}`,
              provider: 'openai-compatible',
              config_json: JSON.stringify({
                sourceId,
                name: sourceId,
                role: 'speech',
                providerId: 'openai-compatible',
                baseUrl: 'http://localhost:8787/v1',
                model: 'manual',
                mode: 'file',
                timeoutMs: 60000,
                batchLimit: 1,
                embeddingDimension: null,
                fileSizeLimitMb: null
              }),
              created_at: now,
              updated_at: now
            }
          })
        )
        .execute()
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, (_, index) =>
          service.saveSpeechSource({
            source: {
              name: `new-${index}`,
              baseUrl: 'http://localhost:8787/v1',
              model: 'manual',
              mode: 'file'
            }
          })
        )
      )
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect((await service.snapshot()).speechCatalog.sources).toHaveLength(50)
    } finally {
      db.close()
    }
  })
  it('preserves model capability metadata and bounds aggregate cache bytes', async () => {
    const { service, discover, create, db } = await setup()
    try {
      const id = await create()
      const candidate = {
        id: 'transcriber',
        name: 'Transcriber',
        capability: 'transcription' as const,
        speechModes: ['realtime' as const],
        metadataSource: 'models.dev' as const,
        availability: 'provider' as const
      }
      discover.mockResolvedValueOnce([candidate])
      expect(
        (await service.refreshSpeechModels(id)).speechCatalog.sources[0].modelCandidates
      ).toEqual([candidate])
      discover.mockResolvedValueOnce(
        Array.from({ length: 2000 }, (_, index) => ({
          id: `${index}${'字'.repeat(190)}`,
          name: '字'.repeat(200)
        }))
      )
      const snapshot = await service.refreshSpeechModels(id)
      expect(snapshot.speechCatalog.sources[0].modelCandidates).toEqual([candidate])
      expect(snapshot.speechCatalog.sources[0].catalog.status).toBe('stale')
    } finally {
      db.close()
    }
  })

  it('keeps sources isolated, selects only explicitly, and snapshots without network', async () => {
    const { service, discover, create, db } = await setup()
    try {
      const first = await create('First', undefined, 'first-key')
      const second = await create('Second', 'http://localhost:9000/v1', 'second-key')
      expect((await service.snapshot()).speechCatalog.activeSourceId).toBeNull()
      await service.setActiveSpeechSource(first)
      await service.withSpeechProvider(async (config, key) => {
        expect(key).toBe('first-key')
        expect(config.model).toBe('manual-model')
      })
      await service.withSpeechProvider(async (_config, key) => {
        expect(key).toBe('second-key')
      }, second)
      expect((await service.snapshot()).speechCatalog.activeSourceId).toBe(first)
      expect(discover).not.toHaveBeenCalled()
      await service.removeSpeechSource(first)
      expect((await service.snapshot()).speechCatalog.activeSourceId).toBeNull()
      await expect(service.withSpeechProvider(async () => undefined)).rejects.toThrow(
        'Set up Speech input'
      )
    } finally {
      db.close()
    }
  })
  it('retains successful fresh candidates on failure without replacing the configured model', async () => {
    const { service, discover, create, db } = await setup()
    try {
      const id = await create()
      let snapshot = await service.refreshSpeechModels(id)
      expect(snapshot.speechCatalog.sources[0]).toMatchObject({
        modelCandidates: [{ id: 'fresh-model', name: 'Fresh model' }],
        catalog: { status: 'current' },
        config: { model: 'manual-model' }
      })
      discover.mockRejectedValueOnce(new SourceModelDiscoveryError('network_error'))
      snapshot = await service.refreshSpeechModels(id)
      expect(snapshot.speechCatalog.sources[0]).toMatchObject({
        modelCandidates: [{ id: 'fresh-model', name: 'Fresh model' }],
        catalog: { status: 'stale', lastErrorCode: 'network_error' },
        config: { model: 'manual-model' }
      })
    } finally {
      db.close()
    }
  })
  it.each(['endpoint', 'key', 'delete'] as const)(
    'discards in-flight results after %s changes',
    async (change) => {
      const { service, discover, create, db } = await setup()
      const wait = deferred<SourceModelCandidate[]>()
      try {
        const id = await create('Original', undefined, 'old-key')
        discover.mockImplementationOnce(() => wait.promise)
        const refresh = service.refreshSpeechModels(id)
        await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
        if (change === 'delete') await service.removeSpeechSource(id)
        else
          await service.saveSpeechSource({
            sourceId: id,
            source: {
              name: 'Original',
              baseUrl:
                change === 'endpoint'
                  ? 'http://localhost:8787/new-prefix/v1'
                  : 'http://localhost:8787/proxy/v1',
              model: 'manual-model',
              mode: 'file'
            },
            ...(change === 'key' ? { apiKey: 'new-key' } : {})
          })
        wait.resolve([{ id: 'stale-result', name: 'Stale' }])
        const result = await refresh
        expect(result.speechCatalog.sources.flatMap((source) => source.modelCandidates)).toEqual([])
      } finally {
        db.close()
      }
    }
  )
  it('never sends a newly replaced key to the old endpoint while credential resolution waits', async () => {
    const { service, discover, create, db, credentials } = await setup()
    const wait = deferred<void>()
    try {
      const id = await create('Original', 'https://old.example.test/v1', 'old-key')
      const original = credentials.withCredential.bind(credentials)
      const entered = deferred<void>()
      vi.spyOn(credentials, 'withCredential').mockImplementationOnce(
        async (configId, operation) => {
          entered.resolve()
          await wait.promise
          return original(configId, operation)
        }
      )
      const refresh = service.refreshSpeechModels(id)
      await entered.promise
      await service.saveSpeechSource({
        sourceId: id,
        source: {
          name: 'Original',
          baseUrl: 'https://new.example.test/v1',
          model: 'manual-model',
          mode: 'file'
        },
        apiKey: 'new-key'
      })
      wait.resolve()
      await refresh
      expect(discover).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })
  it('only commits the newest of overlapping refreshes', async () => {
    const { service, discover, create, db } = await setup()
    const first = deferred<SourceModelCandidate[]>()
    const second = deferred<SourceModelCandidate[]>()
    try {
      const id = await create()
      discover
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
      const old = service.refreshSpeechModels(id)
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1))
      const latest = service.refreshSpeechModels(id)
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
      second.resolve([{ id: 'newest', name: 'Newest' }])
      await latest
      first.resolve([{ id: 'older', name: 'Older' }])
      expect((await old).speechCatalog.sources[0].modelCandidates).toEqual([
        { id: 'newest', name: 'Newest' }
      ])
    } finally {
      db.close()
    }
  })
  it('retains candidates across model/name edits and rejects oversized catalog refreshes', async () => {
    const { service, discover, create, db } = await setup()
    try {
      const id = await create()
      await service.refreshSpeechModels(id)
      await service.saveSpeechSource({
        sourceId: id,
        source: {
          name: 'Renamed',
          baseUrl: 'http://localhost:8787/proxy/v1',
          model: 'new-manual-model',
          mode: 'realtime'
        }
      })
      expect((await service.snapshot()).speechCatalog.sources[0].modelCandidates).toHaveLength(1)
      discover.mockResolvedValueOnce(
        Array.from({ length: 2001 }, (_, index) => ({ id: `m-${index}`, name: 'Model' }))
      )
      const result = await service.refreshSpeechModels(id)
      expect(result.speechCatalog.sources[0].modelCandidates).toHaveLength(1)
      expect(result.speechCatalog.sources[0].catalog.status).toBe('stale')
    } finally {
      db.close()
    }
  })
  it('refreshes image candidates independently from its adopted model catalog', async () => {
    const { service, discover, db } = await setup()
    try {
      await service.saveImageSource({
        source: { providerId: 'openai', name: 'Image', baseUrl: 'https://images.example.test/v1' },
        apiKey: 'image-key'
      })
      const result = await service.refreshImageModels('image-fixture')
      expect(discover).toHaveBeenCalledWith(
        { transport: 'openai', baseUrl: 'https://images.example.test/v1', credential: 'image-key' },
        expect.any(AbortSignal),
        expect.objectContaining({ warn: expect.any(Function) })
      )
      expect(result.imageCatalog.sources[0].modelCandidates).toEqual([
        { id: 'fresh-model', name: 'Fresh model' }
      ])
      expect(
        result.imageCatalog.sources[0].models.some((model) => model.id === 'fresh-model')
      ).toBe(false)
    } finally {
      db.close()
    }
  })
})
