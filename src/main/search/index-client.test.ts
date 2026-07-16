import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import type { IndexUtilityResponse } from '../../shared/contracts/indexing'
import type { LogCollector } from '../observability/log-collector'
import { IndexClient, type IndexUtilityProcessFactory } from './index-client'

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

describe('IndexClient protocol boundaries', () => {
  it('terminates and rejects stale-session responses', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)
    const pending = client.inspect()
    const request = child.posts.at(-1) as { requestId: string }
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
    child.emit('message', {
      type: 'snapshot',
      requestId: randomUUID(),
      projectSessionId: sessionId,
      snapshot
    } satisfies IndexUtilityResponse)
    await expect(pending).rejects.toThrow('unmatched response')
    expect(child.killed).toBe(true)
  })
})
