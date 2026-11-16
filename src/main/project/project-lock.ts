import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import type { Logger } from 'pino'
import { PROJECT_LOCK_RELATIVE_PATH, resolveProjectPath } from './project-paths'

const LOCK_METADATA_SUFFIX = '.json'
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000
export const PROJECT_LOCK_STALE_AFTER_MS = 60_000

export interface ProjectLockMetadata {
  ownerToken: string
  pid: number
  host: string
  acquiredAt: string
  heartbeatAt: string
}

export interface ProjectLockDependencies {
  randomUUID: () => string
  now: () => Date
  pid: () => number
  host: () => string
  setInterval: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
  clearInterval: (timer: ReturnType<typeof setInterval>) => void
}

export interface ProjectLockOptions {
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  heartbeatIntervalMs?: number
  dependencies?: Partial<ProjectLockDependencies>
}

export interface RecoverStaleProjectLockOptions extends ProjectLockOptions {
  expectedOwnerToken: string
  staleBefore: Date
}

export class ProjectLockContendedError extends Error {
  readonly #projectRoot?: string

  constructor(projectRoot?: string) {
    super('Project is already locked for writing')
    this.name = 'ProjectLockContendedError'
    this.#projectRoot = projectRoot
  }

  get projectRoot(): string | undefined {
    return this.#projectRoot
  }
}

export class ProjectLockRecoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProjectLockRecoveryError'
  }
}

const defaultDependencies: ProjectLockDependencies = {
  randomUUID,
  now: () => new Date(),
  pid: () => process.pid,
  host: hostname,
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (timer) => clearInterval(timer)
}

function dependenciesFor(options: ProjectLockOptions): ProjectLockDependencies {
  return { ...defaultDependencies, ...options.dependencies }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function metadataFileName(ownerToken: string): string {
  return `${ownerToken}${LOCK_METADATA_SUFFIX}`
}

function lockDirectory(projectRoot: string): string {
  return resolveProjectPath(projectRoot, PROJECT_LOCK_RELATIVE_PATH)
}

function parseMetadata(text: string): ProjectLockMetadata {
  const value = JSON.parse(text) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ownerToken' in value) ||
    typeof value.ownerToken !== 'string' ||
    !('pid' in value) ||
    typeof value.pid !== 'number' ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 0 ||
    !('host' in value) ||
    typeof value.host !== 'string' ||
    !('acquiredAt' in value) ||
    typeof value.acquiredAt !== 'string' ||
    !('heartbeatAt' in value) ||
    typeof value.heartbeatAt !== 'string' ||
    Number.isNaN(Date.parse(value.acquiredAt)) ||
    Number.isNaN(Date.parse(value.heartbeatAt))
  ) {
    throw new Error('Invalid project lock metadata')
  }
  return value as ProjectLockMetadata
}

async function readMetadataFile(file: FileHandle): Promise<ProjectLockMetadata> {
  return parseMetadata(await file.readFile('utf8'))
}

async function readCurrentLock(
  projectRoot: string,
  logger: ProjectLockOptions['logger']
): Promise<{ metadata: ProjectLockMetadata; metadataPath: string } | null> {
  const directory = lockDirectory(projectRoot)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (err) {
    if (isNodeError(err, 'ENOENT')) return null
    logger.error({ err, event: 'project_lock_inspect_failed' }, 'Failed to inspect project lock')
    throw new Error('Failed to inspect project lock', { cause: err })
  }

  const [entry] = entries
  if (entries.length !== 1 || entry === undefined || !entry.endsWith(LOCK_METADATA_SUFFIX)) {
    const err = new Error('Project lock directory has invalid contents')
    logger.error({ err, event: 'project_lock_invalid' }, 'Project lock is invalid')
    throw new ProjectLockRecoveryError('Project lock requires explicit recovery', { cause: err })
  }

  const metadataPath = join(directory, entry)
  try {
    const file = await open(metadataPath, 'r')
    try {
      const metadata = await readMetadataFile(file)
      if (metadataFileName(metadata.ownerToken) !== entry) {
        throw new Error('Project lock owner does not match its metadata filename')
      }
      return { metadata, metadataPath }
    } finally {
      await file.close()
    }
  } catch (err) {
    logger.error({ err, event: 'project_lock_read_failed' }, 'Failed to read project lock')
    throw new ProjectLockRecoveryError('Project lock requires explicit recovery', { cause: err })
  }
}

export async function inspectProjectWriteLock(
  projectRoot: string,
  options: ProjectLockOptions
): Promise<ProjectLockMetadata | null> {
  const lock = await readCurrentLock(projectRoot, options.logger)
  return lock?.metadata ?? null
}

export class ProjectWriteLock {
  readonly metadata: ProjectLockMetadata
  #projectRoot: string
  readonly #logger: ProjectLockOptions['logger']
  readonly #dependencies: ProjectLockDependencies
  readonly #heartbeatIntervalMs: number
  #timer: ReturnType<typeof setInterval> | undefined
  #operation: Promise<void> = Promise.resolve()
  #releaseState: 'held' | 'releasing' | 'released' = 'held'
  #releaseInFlight?: Promise<boolean>
  #retirement?: { dev: bigint; ino: bigint; markerRemoved: boolean }

  private constructor(
    projectRoot: string,
    metadata: ProjectLockMetadata,
    options: ProjectLockOptions,
    dependencies: ProjectLockDependencies
  ) {
    this.#projectRoot = projectRoot
    this.metadata = metadata
    this.#logger = options.logger
    this.#dependencies = dependencies
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  }

  static async acquire(
    projectRoot: string,
    options: ProjectLockOptions
  ): Promise<ProjectWriteLock> {
    const dependencies = dependenciesFor(options)
    const ownerToken = dependencies.randomUUID()
    const now = dependencies.now().toISOString()
    const metadata: ProjectLockMetadata = {
      ownerToken,
      pid: dependencies.pid(),
      host: dependencies.host(),
      acquiredAt: now,
      heartbeatAt: now
    }
    const directory = lockDirectory(projectRoot)

    try {
      await mkdir(directory)
    } catch (err) {
      if (isNodeError(err, 'EEXIST')) {
        options.logger.info({ event: 'project_lock_contended' }, 'Project write lock is held')
        throw new ProjectLockContendedError(projectRoot)
      }
      options.logger.error(
        { err, event: 'project_lock_acquire_failed' },
        'Failed to acquire project lock'
      )
      throw new Error('Failed to acquire project lock', { cause: err })
    }

    try {
      const file = await open(join(directory, metadataFileName(ownerToken)), 'wx')
      try {
        await file.writeFile(JSON.stringify(metadata), 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
    } catch (err) {
      options.logger.error(
        { err, event: 'project_lock_initialize_failed' },
        'Failed to initialize project lock'
      )
      try {
        await rmdir(directory)
      } catch (cleanupErr) {
        options.logger.error(
          { err: cleanupErr, event: 'project_lock_cleanup_failed' },
          'Failed to clean up project lock'
        )
      }
      throw new Error('Failed to initialize project lock', { cause: err })
    }

    const lock = new ProjectWriteLock(projectRoot, metadata, options, dependencies)
    lock.#startHeartbeat()
    options.logger.info({ event: 'project_lock_acquired' }, 'Project write lock acquired')
    return lock
  }

  #startHeartbeat(): void {
    if (this.#heartbeatIntervalMs <= 0) return
    this.#timer = this.#dependencies.setInterval(() => {
      // error-handling: allow owner=project-lock reason=heartbeat-background
      void this.heartbeat().catch(() => undefined)
    }, this.#heartbeatIntervalMs)
    this.#timer.unref?.()
  }

  heartbeat(): Promise<void> {
    return this.#serialize(() => this.#heartbeatNow())
  }

  get projectRoot(): string {
    return this.#projectRoot
  }

  moveProjectRoot(destination: string): Promise<void> {
    return this.#serialize(async () => {
      await this.#heartbeatNow()
      await rename(this.#projectRoot, destination)
      this.#projectRoot = destination
    })
  }

  #serialize(run: () => Promise<void>): Promise<void> {
    const operation = this.#operation.then(run)
    // error-handling: allow owner=project-lock reason=caller-handles-lock-operation-failure
    this.#operation = operation.catch(() => undefined)
    return operation
  }

  async #heartbeatNow(): Promise<void> {
    if (this.#releaseState !== 'held') throw new Error('Project lock has already been released')
    const path = join(lockDirectory(this.#projectRoot), metadataFileName(this.metadata.ownerToken))
    let file: FileHandle | undefined
    try {
      file = await open(path, 'r+')
      const current = await readMetadataFile(file)
      if (current.ownerToken !== this.metadata.ownerToken) {
        throw new Error('Project lock ownership changed')
      }
      const next = { ...current, heartbeatAt: this.#dependencies.now().toISOString() }
      const serialized = Buffer.from(JSON.stringify(next))
      await file.write(serialized, 0, serialized.length, 0)
      await file.truncate(serialized.length)
      await file.sync()
      this.metadata.heartbeatAt = next.heartbeatAt
      this.#logger.info({ event: 'project_lock_heartbeat' }, 'Project write lock heartbeat updated')
    } catch (err) {
      this.#logger.error(
        { err, event: 'project_lock_heartbeat_failed' },
        'Failed to update project lock heartbeat'
      )
      throw new Error('Failed to update project lock heartbeat', { cause: err })
    } finally {
      await file?.close()
    }
  }

  release(): Promise<boolean> {
    if (this.#releaseState === 'released') return Promise.resolve(false)
    if (this.#releaseInFlight !== undefined) return this.#releaseInFlight.then(() => false)
    if (this.#releaseState === 'held') {
      this.#releaseState = 'releasing'
      if (this.#timer !== undefined) this.#dependencies.clearInterval(this.#timer)
    }
    this.#releaseInFlight = this.#releaseNow()
      .then((released) => {
        this.#releaseState = 'released'
        return released
      })
      .finally(() => {
        this.#releaseInFlight = undefined
      })
    return this.#releaseInFlight
  }

  async #releaseNow(): Promise<boolean> {
    await this.#operation

    const directory = lockDirectory(this.#projectRoot)
    const metadataPath = join(directory, metadataFileName(this.metadata.ownerToken))
    const releaseMarker = join(directory, `.release-${this.metadata.ownerToken}`)
    try {
      const { dev, ino } = await lstat(directory, { bigint: true })
      if (this.#retirement === undefined) {
        const file = await open(metadataPath, 'r')
        try {
          const current = await readMetadataFile(file)
          if (current.ownerToken !== this.metadata.ownerToken) return this.#skipRelease()
        } finally {
          await file.close()
        }
        await rename(metadataPath, releaseMarker)
        this.#retirement = { dev, ino, markerRemoved: false }
      } else if (this.#retirement.dev !== dev || this.#retirement.ino !== ino) {
        return this.#skipRelease()
      }
      if (!this.#retirement.markerRemoved) {
        await rm(releaseMarker, { force: true })
        this.#retirement.markerRemoved = true
      }
      await rmdir(directory)
      this.#logger.info({ event: 'project_lock_released' }, 'Project write lock released')
      return true
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) return this.#skipRelease()
      this.#logger.error(
        { err, event: 'project_lock_release_failed' },
        'Failed to release project lock'
      )
      throw new Error('Failed to release project lock', { cause: err })
    }
  }

  #skipRelease(): false {
    this.#logger.warn(
      { event: 'project_lock_release_not_owner' },
      'Project lock release skipped because ownership changed'
    )
    return false
  }
}

export async function recoverStaleProjectWriteLock(
  projectRoot: string,
  options: RecoverStaleProjectLockOptions
): Promise<boolean> {
  const observed = await readCurrentLock(projectRoot, options.logger)
  if (observed === null) return false
  const { metadata, metadataPath } = observed
  if (metadata.ownerToken !== options.expectedOwnerToken) {
    throw new ProjectLockRecoveryError('Project lock owner changed before recovery')
  }
  if (Date.parse(metadata.heartbeatAt) > options.staleBefore.getTime()) {
    throw new ProjectLockRecoveryError('Project lock is still live')
  }

  const dependencies = dependenciesFor(options)
  const directory = dirname(metadataPath)
  const recoveryMarker = join(directory, `.recover-${dependencies.randomUUID()}`)
  try {
    const file = await open(metadataPath, 'r')
    try {
      const current = await readMetadataFile(file)
      if (
        current.ownerToken !== options.expectedOwnerToken ||
        current.heartbeatAt !== metadata.heartbeatAt
      ) {
        throw new ProjectLockRecoveryError('Project lock changed before recovery')
      }
    } finally {
      await file.close()
    }
    await rename(metadataPath, recoveryMarker)
  } catch (err) {
    if (isNodeError(err, 'ENOENT')) {
      throw new ProjectLockRecoveryError('Project lock owner changed before recovery', {
        cause: err
      })
    }
    options.logger.error(
      { err, event: 'project_lock_recovery_failed' },
      'Failed to recover stale project lock'
    )
    throw new ProjectLockRecoveryError('Failed to recover stale project lock', { cause: err })
  }

  try {
    await unlink(recoveryMarker)
    await rmdir(directory)
    options.logger.warn(
      { event: 'project_lock_stale_recovered' },
      'Explicitly recovered stale project lock'
    )
    return true
  } catch (err) {
    options.logger.error(
      { err, event: 'project_lock_recovery_failed' },
      'Failed to recover stale project lock'
    )
    throw new ProjectLockRecoveryError('Failed to recover stale project lock', { cause: err })
  }
}
