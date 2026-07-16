import { EventEmitter } from 'node:events'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { MineruProviderConfig } from '../../shared/contracts/providers'
import { MineruClient } from './mineru-client'

const config: MineruProviderConfig = {
  role: 'mineru',
  providerId: 'mineru',
  baseUrl: 'https://mineru.net',
  model: 'pipeline',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 50,
  fileSizeLimitMb: 200
}

class FakeUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly postMessage = vi.fn((request: { requestId: string }) => {
    queueMicrotask(() => {
      this.emit('message', {
        type: 'allocated',
        requestId: request.requestId,
        remoteTaskId: 'remote-1',
        uploadUrl: 'https://upload.example.test/file?signature=private',
        traceId: null
      })
    })
  })
}

describe('MineruClient', () => {
  it('keeps one background worker for sequential allocation responses', async () => {
    const child = new FakeUtilityProcess()
    const factory = { fork: vi.fn(() => child) }
    const client = new MineruClient('/private/mineru.js', pino({ level: 'silent' }), {
      fork: factory.fork
    } as never)
    const result = await client.allocate(
      config,
      'process-secret',
      { parseTaskId: 'parse-1', fileName: 'source.pdf' },
      new AbortController().signal
    )

    expect(result).toMatchObject({ remoteTaskId: 'remote-1', traceId: null })
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ config, credential: 'process-secret' })
    )
    await client.allocate(
      config,
      'process-secret',
      { parseTaskId: 'parse-2', fileName: 'source-2.pdf' },
      new AbortController().signal
    )
    expect(factory.fork).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('routes normalization through the utility without a provider credential', async () => {
    const child = new FakeUtilityProcess()
    child.postMessage.mockImplementation(
      (request: { requestId: string; operation?: string; credential?: string }) => {
        queueMicrotask(() => {
          child.emit('message', {
            type: 'normalized',
            requestId: request.requestId,
            blocksSha256: 'a'.repeat(64),
            documentSha256: 'b'.repeat(64),
            blockCount: 1,
            assets: []
          })
        })
      }
    )
    const client = new MineruClient('/private/mineru.js', pino({ level: 'silent' }), {
      fork: () => child
    } as never)
    const result = await client.normalize(
      {
        rawRoot: '/private/project/raw',
        stagingPath: '/private/project/staging',
        parseRevisionId: '33333333-3333-4333-8333-333333333333',
        normalizerVersion: 1,
        files: [
          { relativePath: 'raw/extracted/content_list.json', sha256: 'c'.repeat(64), byteSize: 2 }
        ]
      },
      new AbortController().signal
    )

    expect(result).toMatchObject({ blockCount: 1, assets: [] })
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'normalize', normalizerVersion: 1 })
    )
    expect(child.postMessage.mock.calls[0]?.[0]).not.toHaveProperty('credential')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('reconstructs only safe provider diagnostics and revokes active utilities', async () => {
    const failedChild = new FakeUtilityProcess()
    failedChild.postMessage.mockImplementation((request: { requestId: string }) => {
      queueMicrotask(() => {
        failedChild.emit('message', {
          type: 'error',
          requestId: request.requestId,
          error: {
            name: 'MineruRequestError',
            message: 'MinerU provider_unavailable',
            retryable: true,
            httpStatus: 503,
            providerCode: '-60008'
          }
        })
      })
    })
    const client = new MineruClient('/private/mineru.js', pino({ level: 'silent' }), {
      fork: () => failedChild
    } as never)
    await expect(
      client.poll(
        config,
        'process-secret',
        { parseTaskId: 'parse-1', remoteTaskId: 'remote-1' },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      retryable: true,
      httpStatus: 503,
      providerCode: '-60008'
    })

    const activeChild = new FakeUtilityProcess()
    activeChild.postMessage.mockImplementation(() => undefined)
    const activeClient = new MineruClient('/private/mineru.js', pino({ level: 'silent' }), {
      fork: () => activeChild
    } as never)
    const pending = activeClient.upload(
      {
        uploadUrl: 'https://upload.example.test/file?signature=private',
        sourcePath: '/private/source.pdf',
        expectedBytes: 10
      },
      new AbortController().signal
    )
    activeClient.terminateAll()
    activeChild.emit('exit', 1)
    await expect(pending).rejects.toThrow('terminated')
    expect(activeChild.kill).toHaveBeenCalledOnce()
  })
})
