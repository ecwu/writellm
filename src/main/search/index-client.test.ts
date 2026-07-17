import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { IndexUtilityResponse } from '../../shared/contracts/indexing'
import type { LogCollector } from '../observability/log-collector'
import { IndexClient, type IndexUtilityProcessFactory } from './index-client'

// The canonical runner executes with ELECTRON_RUN_AS_NODE=1, where the
// `electron` module resolves to the binary-path shim instead of the main-process
// API, so `MessageChannelMain` is undefined. The client only needs a log-port
// channel here; the utility process itself is already replaced by the fake
// factory below.
vi.mock('electron', () => {
  class FakeMessagePortMain {
    on(): void {}
    off(): void {}
    start(): void {}
    close(): void {}
  }
  return {
    MessageChannelMain: class {
      readonly port1 = new FakeMessagePortMain()
      readonly port2 = new FakeMessagePortMain()
    },
    utilityProcess: {
      fork: (): never => {
        throw new Error('utilityProcess.fork is unavailable in unit tests')
      }
    }
  }
})

class FakeUtilityProcess extends EventEmitter {
  readonly posts: unknown[] = []
  killed = false

  postMessage(value: unknown): void {
    this.posts.push(value)
  }

  kill(): void {
    this.killed = true
  }
}

function fixture(): {
  client: IndexClient
  child: FakeUtilityProcess
  sessionId: string
} {
  const child = new FakeUtilityProcess()
  const sessionId = randomUUID()
  const factory: IndexUtilityProcessFactory = {
    fork: () => child as never
  }
  const client = new IndexClient({
    modulePath: '/worker.js',
    indexPath: '/index.sqlite',
    extensionPath: '/vec0.dylib',
    projectId: randomUUID(),
    projectSessionId: sessionId,
    collector: {} as LogCollector,
    log: pino({ level: 'silent' }),
    processFactory: factory
  })
  return { client, child, sessionId }
}

const snapshot = {
  schemaVersion: 4 as const,
  activeGenerationId: null,
  generationCount: 0,
  chunkCount: 0,
  sourceCount: 0,
  activeSourceSetSha256: null
}

async function initialize(client: IndexClient, child: FakeUtilityProcess, sessionId: string) {
  const pending = client.initialize()
  const request = child.posts[0] as { requestId: string }
  child.emit('message', {
    type: 'ready',
    requestId: request.requestId,
    projectSessionId: sessionId,
    snapshot
  } satisfies IndexUtilityResponse)
  await pending
}

// Requests are posted from a promise continuation inside IndexClient.#send
// (after `await this.initialize()`), so the test must yield once before the
// request lands in the fake child and can be answered.
async function flushRequestPosts(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('IndexClient protocol boundaries', () => {
  it('terminates and rejects stale-session responses', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)
    const pending = client.inspect()
    await flushRequestPosts()
    const request = child.posts.at(-1) as { requestId: string }
    expect(child.posts).toHaveLength(2)
    child.emit('message', {
      type: 'snapshot',
      requestId: request.requestId,
      projectSessionId: randomUUID(),
      snapshot
    } satisfies IndexUtilityResponse)
    await expect(pending).rejects.toThrow('stale project session')
    expect(child.killed).toBe(true)
  })

  it('terminates and rejects unmatched responses', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)
    const pending = client.inspect()
    await flushRequestPosts()
    expect(child.posts).toHaveLength(2)
    child.emit('message', {
      type: 'snapshot',
      requestId: randomUUID(),
      projectSessionId: sessionId,
      snapshot
    } satisfies IndexUtilityResponse)
    await expect(pending).rejects.toThrow('request ID is not pending')
    expect(child.killed).toBe(true)
  })
})
