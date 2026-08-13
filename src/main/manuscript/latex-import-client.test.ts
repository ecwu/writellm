import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { LatexImportWorkerRequest } from '../../shared/contracts/latex-import'
import { LatexImportClient } from './latex-import-client'

const log = pino({ level: 'silent' })

describe('LatexImportClient', () => {
  it('uses a disposable child and returns only the matching bounded response', async () => {
    const child = new FakeUtilityProcess((request) => {
      queueMicrotask(() =>
        child.emit('message', {
          type: 'latex-import-result',
          requestId: request.requestId,
          sourceHash: request.sourceHash,
          proposedTitle: null,
          sections: [],
          warnings: [],
          unsupported: [],
          losses: []
        })
      )
    })
    const client = new LatexImportClient({
      modulePath: '/fixture/background-worker.js',
      log,
      factory: { fork: vi.fn(() => child as never) }
    })
    await expect(
      client.parse({ source: 'hello', sourceHash: hash('hello') })
    ).resolves.toMatchObject({
      type: 'latex-import-result',
      sourceHash: hash('hello')
    })
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('kills a parser that exceeds the hard timeout or is cancelled', async () => {
    const timeoutChild = new FakeUtilityProcess(() => undefined)
    const timeoutClient = new LatexImportClient({
      modulePath: '/fixture/background-worker.js',
      log,
      factory: { fork: () => timeoutChild as never },
      timeoutMs: 5
    })
    await expect(
      timeoutClient.parse({ source: 'slow', sourceHash: hash('slow') })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(timeoutChild.kill).toHaveBeenCalledOnce()

    const cancelledChild = new FakeUtilityProcess(() => undefined)
    const cancelledClient = new LatexImportClient({
      modulePath: '/fixture/background-worker.js',
      log,
      factory: { fork: () => cancelledChild as never }
    })
    const controller = new AbortController()
    const pending = cancelledClient.parse({
      source: 'cancel',
      sourceHash: hash('cancel'),
      signal: controller.signal
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelledChild.kill).toHaveBeenCalledOnce()
  })
})

class FakeUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)

  constructor(private readonly onPost: (request: LatexImportWorkerRequest) => void) {
    super()
  }

  postMessage(value: unknown): void {
    this.onPost(value as LatexImportWorkerRequest)
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
