import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  schemaVersion: 5 as const,
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
  it('closes immediately while initialization is still pending', async () => {
    const { client, child } = fixture()
    const pending = client.initialize()

    await expect(client.close()).resolves.toBeUndefined()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.killed).toBe(true)
  })

  it('terminates pending initialization without starting recovery', async () => {
    const { client, child } = fixture()
    const pending = client.initialize()

    client.terminate()

    await expect(pending).rejects.toThrow('Index utility terminated')
    expect(child.killed).toBe(true)
    expect(child.posts).toHaveLength(1)
  })

  it('removes a damaged derived database family and retries initialization once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-index-client-'))
    const indexPath = join(root, 'index.sqlite')
    await Promise.all([
      writeFile(indexPath, 'damaged'),
      writeFile(`${indexPath}-wal`, 'damaged'),
      writeFile(`${indexPath}-shm`, 'damaged')
    ])
    const children = [new FakeUtilityProcess(), new FakeUtilityProcess()]
    let forkCount = 0
    const sessionId = randomUUID()
    const client = new IndexClient({
      modulePath: '/worker.js',
      indexPath,
      extensionPath: '/vec0.dylib',
      projectId: randomUUID(),
      projectSessionId: sessionId,
      collector: {} as LogCollector,
      log: pino({ level: 'silent' }),
      processFactory: {
        fork: () => children[forkCount++] as never
      }
    })
    try {
      const pending = client.initialize()
      const firstRequest = children[0]?.posts[0] as { requestId: string }
      children[0]?.emit('message', {
        type: 'error',
        requestId: firstRequest.requestId,
        projectSessionId: sessionId,
        error: { name: 'Error', message: 'Index database integrity check failed' }
      } satisfies IndexUtilityResponse)
      for (let attempt = 0; attempt < 100 && children[1]?.posts.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      expect(forkCount).toBe(2)
      const secondRequest = children[1]?.posts[0] as { requestId: string }
      children[1]?.emit('message', {
        type: 'ready',
        requestId: secondRequest.requestId,
        projectSessionId: sessionId,
        snapshot
      } satisfies IndexUtilityResponse)

      await expect(pending).resolves.toEqual(snapshot)
      await expect(access(indexPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(`${indexPath}-wal`)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(`${indexPath}-shm`)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(forkCount).toBe(2)
    } finally {
      client.terminate()
      await rm(root, { recursive: true, force: true })
    }
  })

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
