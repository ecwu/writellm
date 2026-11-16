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

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, rm: vi.fn(original.rm) }
})

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

function fixture(
  restartChild?: FakeUtilityProcess,
  onRestart?: (activeGenerationId: string | null) => void
): {
  client: IndexClient
  child: FakeUtilityProcess
  sessionId: string
} {
  const child = new FakeUtilityProcess()
  const sessionId = randomUUID()
  const factory: IndexUtilityProcessFactory = {
    fork: vi
      .fn()
      .mockReturnValueOnce(child)
      .mockReturnValue(restartChild ?? child)
  }
  const client = new IndexClient({
    modulePath: '/worker.js',
    indexPath: '/index.sqlite',
    extensionPath: '/vec0.dylib',
    projectId: randomUUID(),
    projectSessionId: sessionId,
    collector: {} as LogCollector,
    log: pino({ level: 'silent' }),
    onRestart,
    processFactory: factory
  })
  return { client, child, sessionId }
}

async function initialize(client: IndexClient, child: FakeUtilityProcess, sessionId: string) {
  const pending = client.initialize()
  const request = child.posts[0] as { requestId: string }
  child.emit('message', {
    type: 'ready',
    requestId: request.requestId,
    projectSessionId: sessionId,
    activeGenerationId: null
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

    await client.terminate()

    await expect(pending).rejects.toThrow('Index utility terminated')
    expect(child.killed).toBe(true)
    expect(child.posts).toHaveLength(1)
  })

  it('shares graceful close and rejects requests that have not reached the worker', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)

    const probe = client.activeGenerationId()
    const closing = client.close()
    const settled = Promise.allSettled([probe, closing])
    try {
      expect(client.close()).toBe(closing)
      await expect(probe).rejects.toThrow('Index utility client is closed')
      await expect(client.activeGenerationId()).rejects.toThrow('Index utility client is closed')
      expect(child.posts).toHaveLength(2)
      const request = child.posts[1] as { requestId: string }
      expect(request).toMatchObject({ operation: 'close', projectSessionId: sessionId })
      child.emit('message', {
        type: 'closed',
        requestId: request.requestId,
        projectSessionId: sessionId
      } satisfies IndexUtilityResponse)

      await expect(closing).resolves.toBeUndefined()
      expect(child.killed).toBe(true)
    } finally {
      await client.terminate()
      await settled
    }
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
      const concurrent = client.initialize()
      expect(concurrent).toBe(pending)
      const firstRequest = children[0]?.posts[0] as { requestId: string }
      children[0]?.emit('message', {
        type: 'error',
        requestId: firstRequest.requestId,
        projectSessionId: sessionId,
        error: { name: 'Error', message: 'Index database integrity check failed' }
      } satisfies IndexUtilityResponse)
      await vi.waitFor(() => expect(children[1]?.posts).toHaveLength(1))
      expect(forkCount).toBe(2)
      const secondRequest = children[1]?.posts[0] as { requestId: string }
      children[1]?.emit('message', {
        type: 'ready',
        requestId: secondRequest.requestId,
        projectSessionId: sessionId,
        activeGenerationId: null
      } satisfies IndexUtilityResponse)

      await expect(pending).resolves.toBeNull()
      await expect(concurrent).resolves.toBeNull()
      await expect(access(indexPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(`${indexPath}-wal`)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(`${indexPath}-shm`)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(forkCount).toBe(2)
    } finally {
      await client.terminate()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['close', 'terminate'] as const)(
    'waits for recovery file removal on %s',
    async (stop) => {
      const { client, child, sessionId } = fixture()
      const removing = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const remove = vi
        .mocked(rm)
        .mockClear()
        .mockImplementation(async (path) => {
          if (path === '/index.sqlite') {
            removing.resolve()
            await release.promise
          }
        })
      const pending = client.initialize()
      const rejected = expect(pending).rejects.toThrow('Index utility client is closed')
      try {
        const firstRequest = child.posts[0] as { requestId: string }
        child.emit('message', {
          type: 'error',
          requestId: firstRequest.requestId,
          projectSessionId: sessionId,
          error: { name: 'Error', message: 'Index database integrity check failed' }
        } satisfies IndexUtilityResponse)
        await removing.promise

        const completions: string[] = []
        const closed = [
          client[stop]().then(() => completions.push(stop)),
          client.close().then(() => completions.push('repeated close'))
        ]
        await flushRequestPosts()
        expect(completions).toEqual([])

        release.resolve()
        await Promise.all(closed)
        await rejected
        expect(remove.mock.calls.map(([path]) => path)).toEqual([
          '/index.sqlite',
          '/index.sqlite-wal',
          '/index.sqlite-shm'
        ])
        expect(child.posts).toHaveLength(1)
      } finally {
        release.resolve()
        await client.terminate()
        await Promise.allSettled([rejected])
        remove.mockRestore()
      }
    }
  )

  it('waits for one new worker to initialize before posting concurrent requests', async () => {
    const restarted = new FakeUtilityProcess()
    const onRestart = vi.fn()
    const { client, child, sessionId } = fixture(restarted, onRestart)
    try {
      await initialize(client, child, sessionId)
      expect(onRestart).not.toHaveBeenCalled()
      child.emit('exit', 1)
      const first = client.activeGenerationId()
      const second = client.activeGenerationId()
      await flushRequestPosts()

      expect(restarted.posts).toHaveLength(1)
      const start = restarted.posts[0] as { requestId: string }
      expect(start).toMatchObject({ type: 'initialize' })
      restarted.emit('message', {
        type: 'ready',
        requestId: start.requestId,
        projectSessionId: sessionId,
        activeGenerationId: null
      } satisfies IndexUtilityResponse)
      await flushRequestPosts()
      expect(restarted.posts).toHaveLength(3)
      expect(onRestart).toHaveBeenCalledExactlyOnceWith(null)
      for (const post of restarted.posts.slice(1)) {
        const request = post as { requestId: string }
        restarted.emit('message', {
          type: 'active-generation',
          requestId: request.requestId,
          projectSessionId: sessionId,
          activeGenerationId: null
        } satisfies IndexUtilityResponse)
      }
      await expect(Promise.all([first, second])).resolves.toEqual([null, null])
    } finally {
      await client.terminate()
    }
  })

  it('reads the active generation from a fresh worker reply', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)
    const pending = client.activeGenerationId()
    await flushRequestPosts()
    const request = child.posts.at(-1) as { requestId: string }
    expect(request).toMatchObject({
      operation: 'active-generation',
      projectSessionId: sessionId
    })
    child.emit('message', {
      type: 'active-generation',
      requestId: request.requestId,
      projectSessionId: sessionId,
      activeGenerationId: 'generation-current'
    } satisfies IndexUtilityResponse)
    await expect(pending).resolves.toBe('generation-current')
    await client.terminate()
  })

  it('terminates and rejects stale-session responses', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)
    const pending = client.activeGenerationId()
    await flushRequestPosts()
    const request = child.posts.at(-1) as { requestId: string }
    expect(child.posts).toHaveLength(2)
    child.emit('message', {
      type: 'active-generation',
      requestId: request.requestId,
      projectSessionId: randomUUID(),
      activeGenerationId: null
    } satisfies IndexUtilityResponse)
    await expect(pending).rejects.toThrow('stale project session')
    expect(child.killed).toBe(true)
  })

  it('terminates and rejects unmatched responses', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)
    const pending = client.activeGenerationId()
    await flushRequestPosts()
    expect(child.posts).toHaveLength(2)
    child.emit('message', {
      type: 'active-generation',
      requestId: randomUUID(),
      projectSessionId: sessionId,
      activeGenerationId: null
    } satisfies IndexUtilityResponse)
    await expect(pending).rejects.toThrow('request ID is not pending')
    expect(child.killed).toBe(true)
  })

  it('terminates the index worker when a request is cancelled', async () => {
    const { client, child, sessionId } = fixture()
    await initialize(client, child, sessionId)
    const controller = new AbortController()
    const pending = client.activeGenerationId(controller.signal)
    await flushRequestPosts()

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.killed).toBe(true)
  })
})
