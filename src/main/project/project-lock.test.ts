import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inspectProjectWriteLock,
  ProjectLockContendedError,
  ProjectLockRecoveryError,
  ProjectWriteLock,
  recoverStaleProjectWriteLock,
  type ProjectLockDependencies
} from './project-lock'
import { WRITELLM_INTERNAL_DIRECTORY } from './project-paths'

const temporaryDirectories: string[] = []

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-lock-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, WRITELLM_INTERNAL_DIRECTORY))
  return root
}

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}

function deterministicDependencies(
  overrides: Partial<ProjectLockDependencies> = {}
): ProjectLockDependencies {
  return {
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
    now: () => new Date('2026-07-14T12:00:00.000Z'),
    pid: () => 4242,
    host: () => 'test-host',
    setInterval: () => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>,
    clearInterval: vi.fn(),
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('project write lock', () => {
  it('atomically acquires with owner, process, host, and timestamps', async () => {
    const root = await temporaryProject()
    const log = logger()
    const lock = await ProjectWriteLock.acquire(root, {
      logger: log,
      heartbeatIntervalMs: 0,
      dependencies: deterministicDependencies()
    })

    expect(await inspectProjectWriteLock(root, { logger: log })).toEqual({
      ownerToken: '11111111-1111-4111-8111-111111111111',
      pid: 4242,
      host: 'test-host',
      acquiredAt: '2026-07-14T12:00:00.000Z',
      heartbeatAt: '2026-07-14T12:00:00.000Z'
    })
    expect(log.info).toHaveBeenCalledWith(
      { event: 'project_lock_acquired' },
      'Project write lock acquired'
    )
    expect(await lock.release()).toBe(true)
    expect(await inspectProjectWriteLock(root, { logger: log })).toBeNull()
  })

  it('allows only one winner under concurrent exclusive acquisition', async () => {
    const root = await temporaryProject()
    const log = logger()
    let token = 0
    const dependencies = deterministicDependencies({
      randomUUID: () => `00000000-0000-4000-8000-${String(++token).padStart(12, '0')}`
    })

    const results = await Promise.allSettled([
      ProjectWriteLock.acquire(root, { logger: log, heartbeatIntervalMs: 0, dependencies }),
      ProjectWriteLock.acquire(root, { logger: log, heartbeatIntervalMs: 0, dependencies })
    ])
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<ProjectWriteLock> => result.status === 'fulfilled'
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(ProjectLockContendedError)
    await fulfilled[0].value.release()
  })

  it('updates heartbeat deterministically and starts and clears its timer', async () => {
    const root = await temporaryProject()
    const log = logger()
    const times = [new Date('2026-07-14T12:00:00.000Z'), new Date('2026-07-14T12:00:05.000Z')]
    let timerCallback: (() => void) | undefined
    const clearInterval = vi.fn()
    const dependencies = deterministicDependencies({
      now: () => times.shift() ?? new Date('2026-07-14T12:00:05.000Z'),
      setInterval: (callback) => {
        timerCallback = callback
        return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>
      },
      clearInterval
    })
    const lock = await ProjectWriteLock.acquire(root, {
      logger: log,
      heartbeatIntervalMs: 5_000,
      dependencies
    })

    expect(timerCallback).toBeTypeOf('function')
    await lock.heartbeat()
    expect((await inspectProjectWriteLock(root, { logger: log }))?.heartbeatAt).toBe(
      '2026-07-14T12:00:05.000Z'
    )
    await lock.release()
    expect(clearInterval).toHaveBeenCalledOnce()
  })

  it('requires explicit stale recovery and rejects recovery of a live lock', async () => {
    const root = await temporaryProject()
    const log = logger()
    const lock = await ProjectWriteLock.acquire(root, {
      logger: log,
      heartbeatIntervalMs: 0,
      dependencies: deterministicDependencies()
    })

    await expect(
      recoverStaleProjectWriteLock(root, {
        logger: log,
        expectedOwnerToken: lock.metadata.ownerToken,
        staleBefore: new Date('2026-07-14T11:59:59.000Z'),
        dependencies: deterministicDependencies()
      })
    ).rejects.toThrow(ProjectLockRecoveryError)
    await expect(
      ProjectWriteLock.acquire(root, {
        logger: log,
        heartbeatIntervalMs: 0,
        dependencies: deterministicDependencies()
      })
    ).rejects.toThrow(ProjectLockContendedError)
    await lock.release()
  })

  it('recovers only the observed stale owner and logs the explicit recovery', async () => {
    const root = await temporaryProject()
    const log = logger()
    const staleOwner = await ProjectWriteLock.acquire(root, {
      logger: log,
      heartbeatIntervalMs: 0,
      dependencies: deterministicDependencies()
    })

    await expect(
      recoverStaleProjectWriteLock(root, {
        logger: log,
        expectedOwnerToken: '22222222-2222-4222-8222-222222222222',
        staleBefore: new Date('2026-07-14T12:01:00.000Z'),
        dependencies: deterministicDependencies()
      })
    ).rejects.toThrow('owner changed')
    expect(
      await recoverStaleProjectWriteLock(root, {
        logger: log,
        expectedOwnerToken: staleOwner.metadata.ownerToken,
        staleBefore: new Date('2026-07-14T12:01:00.000Z'),
        dependencies: deterministicDependencies({
          randomUUID: () => '33333333-3333-4333-8333-333333333333'
        })
      })
    ).toBe(true)
    expect(log.warn).toHaveBeenCalledWith(
      { event: 'project_lock_stale_recovered' },
      'Explicitly recovered stale project lock'
    )
  })

  it('prevents a stale owner release from deleting its successor', async () => {
    const root = await temporaryProject()
    const log = logger()
    const staleOwner = await ProjectWriteLock.acquire(root, {
      logger: log,
      heartbeatIntervalMs: 0,
      dependencies: deterministicDependencies()
    })
    await recoverStaleProjectWriteLock(root, {
      logger: log,
      expectedOwnerToken: staleOwner.metadata.ownerToken,
      staleBefore: new Date('2026-07-14T12:01:00.000Z'),
      dependencies: deterministicDependencies({
        randomUUID: () => '33333333-3333-4333-8333-333333333333'
      })
    })
    const successor = await ProjectWriteLock.acquire(root, {
      logger: log,
      heartbeatIntervalMs: 0,
      dependencies: deterministicDependencies({
        randomUUID: () => '22222222-2222-4222-8222-222222222222'
      })
    })

    expect(await staleOwner.release()).toBe(false)
    expect((await inspectProjectWriteLock(root, { logger: log }))?.ownerToken).toBe(
      successor.metadata.ownerToken
    )
    expect(await successor.release()).toBe(true)
  })

  it('does not place absolute paths or owner tokens in lifecycle log fields', async () => {
    const root = await temporaryProject()
    const log = logger()
    const lock = await ProjectWriteLock.acquire(root, {
      logger: log,
      heartbeatIntervalMs: 0,
      dependencies: deterministicDependencies()
    })
    await lock.heartbeat()
    await lock.release()

    const serializedLogs = JSON.stringify([
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls
    ])
    expect(serializedLogs).not.toContain(root)
    expect(serializedLogs).not.toContain(lock.metadata.ownerToken)
  })
})
