import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import type { JobState, JobTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import {
  jobErrorSchema,
  jobPayloadSchema,
  jobProgressSchema,
  jobStateSchema,
  jobTypeSchema,
  type JobError,
  type JobPayload,
  type JobProgress
} from './job-schemas'

const MAX_PAYLOAD_BYTES = 16_384
const MAX_PROGRESS_BYTES = 4_096
const MAX_JSON_DEPTH = 8
const MAX_LEASE_MS = 60 * 60 * 1_000
const forbiddenPayloadKeys = new Set([
  'absolutepath',
  'accesstoken',
  'apikey',
  'authorization',
  'blocknote',
  'body',
  'contentjson',
  'credential',
  'credentials',
  'documentbody',
  'embedding',
  'embeddings',
  'password',
  'prompt',
  'refreshtoken',
  'response',
  'secret',
  'signedurl',
  'token',
  'vector',
  'vectors'
])
const absolutePath = /^(?:[/\\]|[a-z]:[/\\])/i
const signedUrl = /^https?:\/\/[^\s?]+\?[^\s]*(?:signature|x-amz-|x-goog-|token=)/i

export interface JobRecord {
  jobId: string
  type: string
  payload: JobPayload
  state: JobState
  priority: number
  attempts: number
  maxAttempts: number
  runAfter: string
  leaseOwner: string | null
  lockedUntil: string | null
  heartbeatAt: string | null
  progress: JobProgress | null
  deduplicationKey: string | null
  cancellationRequested: boolean
  error: JobError | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface JobStoreOptions {
  database: ProjectDatabase
  projectId: string
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => Date
  random?: () => number
  createId?: () => string
  createWorkerId?: () => string
  retryability?: (error: unknown) => boolean
  retryBaseMs?: number
  retryMaxMs?: number
}

export interface EnqueueJobInput {
  type: string
  payload: JobPayload
  priority?: number
  maxAttempts?: number
  runAfter?: Date
  deduplicationKey?: string
}

export interface EnqueueJobResult {
  job: JobRecord
  created: boolean
}

export interface ClaimJobOptions {
  workerId?: string
  leaseMs: number
  types?: readonly string[]
}

export interface FailJobResult {
  job: JobRecord
  willRetry: boolean
}

export class JobOwnershipError extends Error {
  constructor() {
    super('Job is not running under this worker lease')
    this.name = 'JobOwnershipError'
  }
}

export class JobStore {
  readonly #database: ProjectDatabase
  readonly #projectId: string
  readonly #log: JobStoreOptions['log']
  readonly #now: () => Date
  readonly #random: () => number
  readonly #createId: () => string
  readonly #createWorkerId: () => string
  readonly #retryability: (error: unknown) => boolean
  readonly #retryBaseMs: number
  readonly #retryMaxMs: number

  constructor(options: JobStoreOptions) {
    this.#database = options.database
    this.#projectId = options.projectId
    this.#log = options.log
    this.#now = options.now ?? (() => new Date())
    this.#random = options.random ?? Math.random
    this.#createId = options.createId ?? randomUUID
    this.#createWorkerId = options.createWorkerId ?? (() => `main-${process.pid}-${randomUUID()}`)
    this.#retryability = options.retryability ?? defaultRetryability
    this.#retryBaseMs = options.retryBaseMs ?? 1_000
    this.#retryMaxMs = options.retryMaxMs ?? 15 * 60 * 1_000
  }

  createWorkerId(): string {
    return this.#createWorkerId()
  }

  enqueue(input: EnqueueJobInput): EnqueueJobResult {
    const type = jobTypeSchema.parse(input.type)
    const payloadJson = serializePayload(input.payload)
    const priority = integerInRange(input.priority ?? 0, -1_000, 1_000, 'priority')
    const maxAttempts = integerInRange(input.maxAttempts ?? 3, 1, 100, 'maxAttempts')
    const deduplicationKey = parseOptionalString(input.deduplicationKey, 256, 'deduplicationKey')
    const now = this.#now().toISOString()
    const runAfter = (input.runAfter ?? new Date(now)).toISOString()

    const result = this.#database.immediate((database) => {
      if (deduplicationKey !== null) {
        const existing = database
          .prepare(
            `SELECT * FROM jobs
             WHERE type = ? AND deduplication_key = ?
               AND state IN ('queued', 'running', 'paused')`
          )
          .get(type, deduplicationKey) as JobTable | undefined
        if (existing !== undefined) return { job: parseRow(existing), created: false }
      }
      const jobId = this.#createId()
      database
        .prepare(
          `INSERT INTO jobs (
             job_id, type, payload_json, state, priority, attempts, max_attempts, run_after,
             deduplication_key, cancellation_requested, created_at, updated_at
           ) VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?, 0, ?, ?)`
        )
        .run(jobId, type, payloadJson, priority, maxAttempts, runAfter, deduplicationKey, now, now)
      return { job: this.#readOrThrow(database, jobId), created: true }
    })
    this.#log.info(
      {
        event: result.created ? 'queue.job.enqueued' : 'queue.job.deduplicated',
        projectId: this.#projectId,
        jobId: result.job.jobId,
        jobType: result.job.type
      },
      result.created ? 'Project job enqueued' : 'Project job deduplicated'
    )
    return result
  }

  claimNext(options: ClaimJobOptions): JobRecord | null {
    const workerId = parseRequiredString(options.workerId ?? this.createWorkerId(), 256, 'workerId')
    const leaseMs = integerInRange(options.leaseMs, 1, MAX_LEASE_MS, 'leaseMs')
    const types = options.types?.map((type) => jobTypeSchema.parse(type)) ?? []
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    const lockedUntil = new Date(nowDate.getTime() + leaseMs).toISOString()
    const typeClause = types.length === 0 ? '' : `AND type IN (${types.map(() => '?').join(', ')})`

    const claimed = this.#database.immediate((database) => {
      const candidate = database
        .prepare(
          `SELECT job_id FROM jobs
           WHERE state = 'queued' AND cancellation_requested = 0 AND run_after <= ? ${typeClause}
           ORDER BY priority DESC, run_after, created_at, job_id
           LIMIT 1`
        )
        .pluck()
        .get(now, ...types) as string | undefined
      if (candidate === undefined) return null
      const row = database
        .prepare(
          `UPDATE jobs
           SET state = 'running', attempts = attempts + 1, lease_owner = ?, locked_until = ?,
               heartbeat_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?, error_json = NULL
           WHERE job_id = ? AND state = 'queued' AND cancellation_requested = 0
           RETURNING *`
        )
        .get(workerId, lockedUntil, now, now, now, candidate) as JobTable | undefined
      return row === undefined ? null : parseRow(row)
    })
    if (claimed !== null) {
      this.#log.info(
        {
          event: 'queue.job.claimed',
          projectId: this.#projectId,
          jobId: claimed.jobId,
          jobType: claimed.type,
          attempt: claimed.attempts,
          workerId
        },
        'Project job claimed'
      )
    }
    return claimed
  }

  heartbeat(jobId: string, workerId: string, leaseMs: number, progress?: JobProgress): JobRecord {
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    const lockedUntil = new Date(
      nowDate.getTime() + integerInRange(leaseMs, 1, MAX_LEASE_MS, 'leaseMs')
    ).toISOString()
    const progressJson = progress === undefined ? undefined : serializeProgress(progress)
    return this.#transitionOwned(
      jobId,
      workerId,
      `UPDATE jobs
       SET locked_until = ?, heartbeat_at = ?, updated_at = ?,
           progress_json = COALESCE(?, progress_json)
       WHERE job_id = ? AND state = 'running' AND lease_owner = ?
       RETURNING *`,
      [lockedUntil, now, now, progressJson ?? null, jobId, workerId],
      'queue.job.heartbeat',
      'Project job lease renewed'
    )
  }

  complete(jobId: string, workerId: string, progress?: JobProgress): JobRecord {
    const now = this.#now().toISOString()
    const progressJson = progress === undefined ? null : serializeProgress(progress)
    return this.#transitionOwned(
      jobId,
      workerId,
      `UPDATE jobs
       SET state = 'succeeded', lease_owner = NULL, locked_until = NULL, heartbeat_at = ?,
           progress_json = COALESCE(?, progress_json), cancellation_requested = 0,
           error_json = NULL, completed_at = ?, updated_at = ?
       WHERE job_id = ? AND state = 'running' AND lease_owner = ?
         AND cancellation_requested = 0
       RETURNING *`,
      [now, progressJson, now, now, jobId, workerId],
      'queue.job.succeeded',
      'Project job completed'
    )
  }

  fail(jobId: string, workerId: string, error: unknown): FailJobResult {
    const current = this.get(jobId)
    if (current === null || current.state !== 'running' || current.leaseOwner !== workerId) {
      throw new JobOwnershipError()
    }
    this.#log.error(
      {
        event: 'queue.job.execution_failed',
        err: error,
        projectId: this.#projectId,
        jobId,
        jobType: current.type,
        attempt: current.attempts
      },
      'Project job execution failed'
    )
    const nowDate = this.#now()
    const retryable = this.#retryability(error)
    const errorJson = JSON.stringify(toJobError(error, retryable, current.attempts, nowDate))
    const job = this.#database.immediate((database) => {
      const owned = database
        .prepare("SELECT * FROM jobs WHERE job_id = ? AND state = 'running' AND lease_owner = ?")
        .get(jobId, workerId) as JobTable | undefined
      if (owned === undefined) throw new JobOwnershipError()
      const cancelled = owned.cancellation_requested === 1
      const willRetry = !cancelled && retryable && owned.attempts < owned.max_attempts
      const state: JobState = cancelled ? 'cancelled' : willRetry ? 'queued' : 'failed'
      const runAfter = willRetry
        ? new Date(nowDate.getTime() + this.#retryDelay(owned.attempts)).toISOString()
        : owned.run_after
      const completedAt = willRetry ? null : nowDate.toISOString()
      const row = database
        .prepare(
          `UPDATE jobs
           SET state = ?, run_after = ?, lease_owner = NULL, locked_until = NULL,
               heartbeat_at = ?, error_json = ?, completed_at = ?, updated_at = ?
           WHERE job_id = ? AND state = 'running' AND lease_owner = ?
           RETURNING *`
        )
        .get(
          state,
          runAfter,
          nowDate.toISOString(),
          errorJson,
          completedAt,
          nowDate.toISOString(),
          jobId,
          workerId
        ) as JobTable | undefined
      if (row === undefined) throw new JobOwnershipError()
      return parseRow(row)
    })
    const willRetry = job.state === 'queued'
    this.#log.info(
      {
        event:
          job.state === 'cancelled'
            ? 'queue.job.cancelled'
            : willRetry
              ? 'queue.job.retry_scheduled'
              : 'queue.job.failed',
        projectId: this.#projectId,
        jobId,
        jobType: job.type,
        workerId
      },
      job.state === 'cancelled'
        ? 'Project job cancelled after execution failure'
        : willRetry
          ? 'Project job retry scheduled'
          : 'Project job failed permanently'
    )
    return { job, willRetry }
  }

  requestCancellation(jobId: string): JobRecord {
    const now = this.#now().toISOString()
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `UPDATE jobs
           SET cancellation_requested = 1,
               state = CASE WHEN state IN ('queued', 'paused') THEN 'cancelled' ELSE state END,
               completed_at = CASE WHEN state IN ('queued', 'paused') THEN ? ELSE completed_at END,
               updated_at = ?
           WHERE job_id = ? AND state IN ('queued', 'running', 'paused')
           RETURNING *`
          )
          .get(now, now, jobId) as JobTable | undefined
    )
    if (row === undefined) return this.require(jobId)
    const job = parseRow(row)
    this.#log.info(
      {
        event:
          job.state === 'cancelled' ? 'queue.job.cancelled' : 'queue.job.cancellation_requested',
        projectId: this.#projectId,
        jobId: job.jobId,
        jobType: job.type
      },
      job.state === 'cancelled' ? 'Project job cancelled' : 'Project job cancellation requested'
    )
    return job
  }

  acknowledgeCancellation(jobId: string, workerId: string): JobRecord {
    const now = this.#now().toISOString()
    return this.#transitionOwned(
      jobId,
      workerId,
      `UPDATE jobs
       SET state = 'cancelled', lease_owner = NULL, locked_until = NULL, heartbeat_at = ?,
           completed_at = ?, updated_at = ?
       WHERE job_id = ? AND state = 'running' AND lease_owner = ?
         AND cancellation_requested = 1
       RETURNING *`,
      [now, now, now, jobId, workerId],
      'queue.job.cancelled',
      'Project job cancellation acknowledged'
    )
  }

  pause(jobId: string, workerId: string): JobRecord {
    const now = this.#now().toISOString()
    return this.#transitionOwned(
      jobId,
      workerId,
      `UPDATE jobs
       SET state = 'paused', lease_owner = NULL, locked_until = NULL, heartbeat_at = ?, updated_at = ?
       WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND cancellation_requested = 0
       RETURNING *`,
      [now, now, jobId, workerId],
      'queue.job.paused',
      'Project job paused'
    )
  }

  resume(jobId: string, runAfter = this.#now()): JobRecord {
    const now = this.#now().toISOString()
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `UPDATE jobs SET state = 'queued', run_after = ?, updated_at = ?
           WHERE job_id = ? AND state = 'paused' AND cancellation_requested = 0
           RETURNING *`
          )
          .get(runAfter.toISOString(), now, jobId) as JobTable | undefined
    )
    if (row === undefined) throw new Error('Job is not resumable')
    const job = parseRow(row)
    this.#log.info(
      { event: 'queue.job.resumed', projectId: this.#projectId, jobId, jobType: job.type },
      'Project job resumed'
    )
    return job
  }

  recoverExpiredLeases(): { recovered: number; cancelled: number; failed: number } {
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    const result = this.#database.immediate((database) => {
      const expired = database
        .prepare("SELECT * FROM jobs WHERE state = 'running' AND locked_until <= ? ORDER BY job_id")
        .all(now) as JobTable[]
      const counts = { recovered: 0, cancelled: 0, failed: 0 }
      for (const row of expired) {
        const error = JSON.stringify(
          jobErrorSchema.parse({
            code: 'lease_expired',
            message: 'Worker lease expired before completion',
            retryable: true,
            attempt: row.attempts,
            recordedAt: now
          })
        )
        if (row.cancellation_requested === 1) {
          this.#recoverRow(database, row.job_id, 'cancelled', now, now, error)
          counts.cancelled += 1
        } else if (row.attempts >= row.max_attempts) {
          this.#recoverRow(database, row.job_id, 'failed', row.run_after, now, error)
          counts.failed += 1
        } else {
          this.#recoverRow(database, row.job_id, 'queued', now, null, error)
          counts.recovered += 1
        }
      }
      return counts
    })
    if (result.recovered + result.cancelled + result.failed > 0) {
      this.#log.warn(
        {
          event: 'queue.job.expired_leases_recovered',
          projectId: this.#projectId,
          recoveredCount: result.recovered,
          cancelledCount: result.cancelled,
          failedCount: result.failed
        },
        'Recovered expired project job leases'
      )
    }
    return result
  }

  get(jobId: string): JobRecord | null {
    const row = this.#database.immediate(
      (database) =>
        database.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as JobTable | undefined
    )
    return row === undefined ? null : parseRow(row)
  }

  require(jobId: string): JobRecord {
    const job = this.get(jobId)
    if (job === null) throw new Error('Job does not exist')
    return job
  }

  #transitionOwned(
    jobId: string,
    workerId: string,
    statement: string,
    parameters: readonly unknown[],
    event: string,
    message: string
  ): JobRecord {
    const row = this.#database.immediate(
      (database) => database.prepare(statement).get(...parameters) as JobTable | undefined
    )
    if (row === undefined) throw new JobOwnershipError()
    const job = parseRow(row)
    this.#log.info(
      { event, projectId: this.#projectId, jobId, jobType: job.type, workerId },
      message
    )
    return job
  }

  #recoverRow(
    database: Database.Database,
    jobId: string,
    state: 'queued' | 'failed' | 'cancelled',
    runAfter: string,
    completedAt: string | null,
    errorJson: string
  ): void {
    database
      .prepare(
        `UPDATE jobs
         SET state = ?, run_after = ?, lease_owner = NULL, locked_until = NULL,
             heartbeat_at = ?, error_json = ?, completed_at = ?, updated_at = ?
         WHERE job_id = ? AND state = 'running'`
      )
      .run(
        state,
        runAfter,
        this.#now().toISOString(),
        errorJson,
        completedAt,
        this.#now().toISOString(),
        jobId
      )
  }

  #readOrThrow(database: Database.Database, jobId: string): JobRecord {
    const row = database.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as
      | JobTable
      | undefined
    if (row === undefined) throw new Error('Job write did not persist')
    return parseRow(row)
  }

  #retryDelay(attempt: number): number {
    const exponential = Math.min(this.#retryMaxMs, this.#retryBaseMs * 2 ** (attempt - 1))
    return Math.floor(exponential * (0.5 + this.#random() * 0.5))
  }
}

function parseRow(row: JobTable): JobRecord {
  return {
    jobId: row.job_id,
    type: jobTypeSchema.parse(row.type),
    payload: jobPayloadSchema.parse(JSON.parse(row.payload_json)),
    state: jobStateSchema.parse(row.state),
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    leaseOwner: row.lease_owner,
    lockedUntil: row.locked_until,
    heartbeatAt: row.heartbeat_at,
    progress:
      row.progress_json === null ? null : jobProgressSchema.parse(JSON.parse(row.progress_json)),
    deduplicationKey: row.deduplication_key,
    cancellationRequested: row.cancellation_requested === 1,
    error: row.error_json === null ? null : jobErrorSchema.parse(JSON.parse(row.error_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }
}

function serializePayload(payload: JobPayload): string {
  const parsed = jobPayloadSchema.parse(payload)
  inspectPayload(parsed, 0)
  return boundedJson(parsed, MAX_PAYLOAD_BYTES, 'Job payload')
}

function inspectPayload(value: unknown, depth: number, key?: string): void {
  if (depth > MAX_JSON_DEPTH) throw new Error('Job payload exceeds the maximum nesting depth')
  if (
    key !== undefined &&
    forbiddenPayloadKeys.has(key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase())
  ) {
    throw new Error(`Job payload field is forbidden: ${key}`)
  }
  if (typeof value === 'string' && (absolutePath.test(value) || signedUrl.test(value))) {
    throw new Error('Job payload contains a forbidden path or signed URL')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Job payload contains a non-finite number')
  }
  if (value === undefined || typeof value === 'bigint' || typeof value === 'function') {
    throw new Error('Job payload contains a non-JSON value')
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectPayload(item, depth + 1)
    return
  }
  if (value !== null && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error('Job payload contains a non-plain object')
    }
    for (const [childKey, child] of Object.entries(value))
      inspectPayload(child, depth + 1, childKey)
  }
}

function serializeProgress(progress: JobProgress): string {
  return boundedJson(jobProgressSchema.parse(progress), MAX_PROGRESS_BYTES, 'Job progress')
}

function boundedJson(value: unknown, maxBytes: number, label: string): string {
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json) > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`)
  return json
}

function integerInRange(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function parseRequiredString(value: string, maxLength: number, name: string): string {
  if (value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} must contain between 1 and ${maxLength} characters`)
  }
  return value
}

function parseOptionalString(
  value: string | undefined,
  maxLength: number,
  name: string
): string | null {
  return value === undefined ? null : parseRequiredString(value, maxLength, name)
}

function defaultRetryability(error: unknown): boolean {
  return !(
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    error.retryable === false
  )
}

function toJobError(error: unknown, retryable: boolean, attempt: number, now: Date): JobError {
  const candidate =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : undefined
  return jobErrorSchema.parse({
    code:
      typeof candidate?.code === 'string' && candidate.code.length <= 128
        ? candidate.code
        : 'job_execution_failed',
    message:
      typeof candidate?.message === 'string'
        ? candidate.message.slice(0, 2_048)
        : 'Job execution failed',
    retryable,
    attempt,
    recordedAt: now.toISOString()
  })
}
