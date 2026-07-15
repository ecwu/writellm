import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import type { JobState, JobTable, JobTransitionTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import {
  JOB_ERROR_MESSAGES,
  jobErrorCodeSchema,
  jobErrorSchema,
  parseJobPayload,
  jobProgressSchema,
  jobStateSchema,
  jobTypeSchema,
  type JobError,
  type JobErrorCode,
  type JobPayload,
  type JobProgress,
  type JobType
} from './job-schemas'

const MAX_PAYLOAD_BYTES = 16_384
const MAX_PROGRESS_BYTES = 4_096
const MAX_ERROR_BYTES = 8_000
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
  'data',
  'documentbody',
  'embedding',
  'embeddings',
  'password',
  'prompt',
  'rawtext',
  'refreshtoken',
  'response',
  'secret',
  'signedurl',
  'source',
  'text',
  'token',
  'vector',
  'vectors'
])
const forbiddenPathOrUrl = /^(?:[/\\]|[a-z]:[/\\]|\\\\|file:\/\/|https?:\/\/)/i

export interface JobRecord {
  jobId: string
  type: JobType
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
  resumeSameAttempt: boolean
}

export interface JobLease {
  jobId: string
  workerId: string
  leaseToken: string
  attempt: number
}

export interface ClaimedJob {
  job: JobRecord
  lease: JobLease
}

export interface JobFailureClassification {
  code: JobErrorCode
  retryable: boolean
}

export interface JobTransitionRecord {
  sequence: number
  jobId: string
  fromState: JobState | null
  toState: JobState
  event: string
  attempt: number
  workerId: string | null
  errorCode: string | null
  occurredAt: string
}

export interface JobStoreOptions {
  database: ProjectDatabase
  projectId: string
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => Date
  random?: () => number
  createId?: () => string
  createWorkerId?: () => string
  createLeaseToken?: () => string
  classifyFailure?: (error: unknown) => JobFailureClassification
  retryBaseMs?: number
  retryMaxMs?: number
}

export interface EnqueueJobInput {
  type: JobType
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
  types?: readonly JobType[]
}

export interface FailJobResult {
  job: JobRecord
  willRetry: boolean
}

export interface ListJobsOptions {
  limit: number
  states?: readonly JobState[]
  cursor?: { updatedAt: string; jobId: string }
}

export class JobOwnershipError extends Error {
  constructor() {
    super('Job is not running under this active lease')
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
  readonly #createLeaseToken: () => string
  readonly #classifyFailure: (error: unknown) => JobFailureClassification
  readonly #retryBaseMs: number
  readonly #retryMaxMs: number
  readonly #listeners = new Set<(job: JobRecord) => void>()

  constructor(options: JobStoreOptions) {
    this.#database = options.database
    this.#projectId = options.projectId
    this.#log = options.log
    this.#now = options.now ?? (() => new Date())
    this.#random = options.random ?? Math.random
    this.#createId = options.createId ?? randomUUID
    this.#createWorkerId = options.createWorkerId ?? (() => `main-${process.pid}-${randomUUID()}`)
    this.#createLeaseToken = options.createLeaseToken ?? randomUUID
    this.#classifyFailure = options.classifyFailure ?? defaultFailureClassification
    this.#retryBaseMs = options.retryBaseMs ?? 1_000
    this.#retryMaxMs = options.retryMaxMs ?? 15 * 60 * 1_000
  }

  createWorkerId(): string {
    return this.#createWorkerId()
  }

  enqueue(input: EnqueueJobInput): EnqueueJobResult {
    const type = jobTypeSchema.parse(input.type)
    const payloadJson = serializePayload(type, input.payload)
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
      this.#insertTransition(database, jobId, null, 'queued', 'enqueued', 0, null, null, now)
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
    this.#emit(result.job)
    return result
  }

  claimNext(options: ClaimJobOptions): ClaimedJob | null {
    const workerId = parseRequiredString(options.workerId ?? this.createWorkerId(), 256, 'workerId')
    const leaseToken = parseRequiredString(this.#createLeaseToken(), 256, 'leaseToken')
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
           WHERE state = 'queued' AND cancellation_requested = 0 AND run_after <= ?
             AND (attempts < max_attempts OR resume_same_attempt = 1) ${typeClause}
           ORDER BY priority DESC, run_after, created_at, job_id
           LIMIT 1`
        )
        .pluck()
        .get(now, ...types) as string | undefined
      if (candidate === undefined) return null
      const row = database
        .prepare(
          `UPDATE jobs
           SET state = 'running',
               attempts = attempts + CASE WHEN resume_same_attempt = 1 THEN 0 ELSE 1 END,
               resume_same_attempt = 0, lease_owner = ?, lease_token = ?,
               locked_until = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?),
               updated_at = ?, error_json = NULL
           WHERE job_id = ? AND state = 'queued' AND cancellation_requested = 0
             AND (attempts < max_attempts OR resume_same_attempt = 1)
           RETURNING *`
        )
        .get(workerId, leaseToken, lockedUntil, now, now, now, candidate) as JobTable | undefined
      if (row === undefined) return null
      this.#insertTransition(
        database,
        row.job_id,
        'queued',
        'running',
        'claimed',
        row.attempts,
        workerId,
        null,
        now
      )
      return {
        job: parseRow(row),
        lease: { jobId: row.job_id, workerId, leaseToken, attempt: row.attempts }
      }
    })
    if (claimed !== null) {
      this.#log.info(
        {
          event: 'queue.job.claimed',
          projectId: this.#projectId,
          jobId: claimed.job.jobId,
          jobType: claimed.job.type,
          attempt: claimed.lease.attempt,
          workerId
        },
        'Project job claimed'
      )
      this.#emit(claimed.job)
    }
    return claimed
  }

  heartbeat(lease: JobLease, leaseMs: number, progress?: JobProgress): JobRecord {
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    const lockedUntil = new Date(
      nowDate.getTime() + integerInRange(leaseMs, 1, MAX_LEASE_MS, 'leaseMs')
    ).toISOString()
    const progressJson = progress === undefined ? null : serializeProgress(progress)
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `UPDATE jobs
             SET locked_until = ?, heartbeat_at = ?, updated_at = ?,
                 progress_json = COALESCE(?, progress_json)
             WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND lease_token = ?
               AND attempts = ? AND locked_until > ?
             RETURNING *`
          )
          .get(
            lockedUntil,
            now,
            now,
            progressJson,
            lease.jobId,
            lease.workerId,
            lease.leaseToken,
            lease.attempt,
            now
          ) as JobTable | undefined
    )
    if (row === undefined) throw new JobOwnershipError()
    const job = parseRow(row)
    this.#log.info(
      {
        event: 'queue.job.heartbeat',
        projectId: this.#projectId,
        jobId: lease.jobId,
        jobType: job.type,
        workerId: lease.workerId
      },
      'Project job lease renewed'
    )
    this.#emit(job)
    return job
  }

  complete(lease: JobLease, progress?: JobProgress): JobRecord {
    const now = this.#now().toISOString()
    const progressJson = progress === undefined ? null : serializeProgress(progress)
    return this.#ownedStateTransition(
      lease,
      now,
      'succeeded',
      'completed',
      `UPDATE jobs
       SET state = 'succeeded', lease_owner = NULL, lease_token = NULL, locked_until = NULL,
           heartbeat_at = ?, progress_json = COALESCE(?, progress_json),
           cancellation_requested = 0, error_json = NULL, completed_at = ?, updated_at = ?
       WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND lease_token = ?
         AND attempts = ? AND locked_until > ? AND cancellation_requested = 0
       RETURNING *`,
      [
        now,
        progressJson,
        now,
        now,
        lease.jobId,
        lease.workerId,
        lease.leaseToken,
        lease.attempt,
        now
      ],
      null,
      'queue.job.succeeded',
      'Project job completed'
    )
  }

  fail(lease: JobLease, error: unknown): FailJobResult {
    try {
      this.#log.error(
        {
          event: 'queue.job.execution_failed',
          err: error,
          projectId: this.#projectId,
          jobId: lease.jobId,
          attempt: lease.attempt
        },
        'Project job execution failed'
      )
    } catch {
      // Logging was attempted with the original error; archival must still complete.
    }
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    let classification: JobFailureClassification
    try {
      const candidate = this.#classifyFailure(error)
      classification = {
        code: jobErrorCodeSchema.parse(candidate.code),
        retryable: candidate.retryable === true
      }
    } catch (err) {
      this.#log.error(
        {
          event: 'queue.job.failure_classification_failed',
          err,
          projectId: this.#projectId,
          jobId: lease.jobId,
          attempt: lease.attempt
        },
        'Project job failure classification failed'
      )
      classification = { code: 'job_execution_failed', retryable: false }
    }
    const errorJson = serializeJobError(classification, lease.attempt, nowDate)
    const job = this.#database.immediate((database) => {
      const owned = this.#readOwned(database, lease, now)
      const cancelled = owned.cancellation_requested === 1
      const willRetry =
        !cancelled && classification.retryable && owned.attempts < owned.max_attempts
      const state: JobState = cancelled ? 'cancelled' : willRetry ? 'queued' : 'failed'
      const runAfter = willRetry
        ? new Date(nowDate.getTime() + this.#retryDelay(owned.attempts)).toISOString()
        : owned.run_after
      const completedAt = willRetry ? null : now
      const row = database
        .prepare(
          `UPDATE jobs
           SET state = ?, run_after = ?, lease_owner = NULL, lease_token = NULL,
               locked_until = NULL, heartbeat_at = ?, error_json = ?, completed_at = ?, updated_at = ?
           WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND lease_token = ?
             AND attempts = ? AND locked_until > ?
           RETURNING *`
        )
        .get(
          state,
          runAfter,
          now,
          errorJson,
          completedAt,
          now,
          lease.jobId,
          lease.workerId,
          lease.leaseToken,
          lease.attempt,
          now
        ) as JobTable | undefined
      if (row === undefined) throw new JobOwnershipError()
      this.#insertTransition(
        database,
        lease.jobId,
        'running',
        state,
        cancelled ? 'cancellation_acknowledged' : willRetry ? 'retry_scheduled' : 'failed',
        owned.attempts,
        lease.workerId,
        classification.code,
        now
      )
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
        jobId: lease.jobId,
        jobType: job.type,
        workerId: lease.workerId
      },
      job.state === 'cancelled'
        ? 'Project job cancelled after execution failure'
        : willRetry
          ? 'Project job retry scheduled'
          : 'Project job failed permanently'
    )
    this.#emit(job)
    return { job, willRetry }
  }

  requestCancellation(jobId: string): JobRecord {
    const now = this.#now().toISOString()
    const changed = this.#database.immediate((database) => {
      const current = database.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as
        | JobTable
        | undefined
      if (current === undefined || !['queued', 'running', 'paused'].includes(current.state)) {
        return null
      }
      const terminal = current.state === 'queued' || current.state === 'paused'
      const toState = terminal ? 'cancelled' : 'running'
      const row = database
        .prepare(
          `UPDATE jobs
           SET cancellation_requested = 1, state = ?,
               lease_owner = CASE WHEN ? THEN NULL ELSE lease_owner END,
               lease_token = CASE WHEN ? THEN NULL ELSE lease_token END,
               locked_until = CASE WHEN ? THEN NULL ELSE locked_until END,
               completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
               updated_at = ?
           WHERE job_id = ? AND state = ?
           RETURNING *`
        )
        .get(
          toState,
          terminal ? 1 : 0,
          terminal ? 1 : 0,
          terminal ? 1 : 0,
          terminal ? 1 : 0,
          now,
          now,
          jobId,
          current.state
        ) as JobTable | undefined
      if (row === undefined) return null
      this.#insertTransition(
        database,
        jobId,
        current.state,
        toState,
        terminal ? 'cancelled' : 'cancellation_requested',
        current.attempts,
        current.lease_owner,
        null,
        now
      )
      return parseRow(row)
    })
    if (changed === null) return this.require(jobId)
    this.#log.info(
      {
        event:
          changed.state === 'cancelled'
            ? 'queue.job.cancelled'
            : 'queue.job.cancellation_requested',
        projectId: this.#projectId,
        jobId: changed.jobId,
        jobType: changed.type
      },
      changed.state === 'cancelled' ? 'Project job cancelled' : 'Project job cancellation requested'
    )
    this.#emit(changed)
    return changed
  }

  acknowledgeCancellation(lease: JobLease): JobRecord {
    const now = this.#now().toISOString()
    return this.#ownedStateTransition(
      lease,
      now,
      'cancelled',
      'cancellation_acknowledged',
      `UPDATE jobs
       SET state = 'cancelled', lease_owner = NULL, lease_token = NULL, locked_until = NULL,
           heartbeat_at = ?, completed_at = ?, updated_at = ?
       WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND lease_token = ?
         AND attempts = ? AND locked_until > ? AND cancellation_requested = 1
       RETURNING *`,
      [now, now, now, lease.jobId, lease.workerId, lease.leaseToken, lease.attempt, now],
      null,
      'queue.job.cancelled',
      'Project job cancellation acknowledged'
    )
  }

  pause(lease: JobLease): JobRecord {
    const now = this.#now().toISOString()
    return this.#ownedStateTransition(
      lease,
      now,
      'paused',
      'paused',
      `UPDATE jobs
       SET state = 'paused', lease_owner = NULL, lease_token = NULL, locked_until = NULL,
           heartbeat_at = ?, updated_at = ?
       WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND lease_token = ?
         AND attempts = ? AND locked_until > ? AND cancellation_requested = 0
       RETURNING *`,
      [now, now, lease.jobId, lease.workerId, lease.leaseToken, lease.attempt, now],
      null,
      'queue.job.paused',
      'Project job paused'
    )
  }

  resume(jobId: string, runAfter?: Date): JobRecord {
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    const row = this.#database.immediate((database) => {
      const updated = database
        .prepare(
          `UPDATE jobs SET state = 'queued', run_after = ?, updated_at = ?
           WHERE job_id = ? AND state = 'paused' AND cancellation_requested = 0
           RETURNING *`
        )
        .get((runAfter ?? nowDate).toISOString(), now, jobId) as JobTable | undefined
      if (updated === undefined) throw new Error('Job is not resumable')
      this.#insertTransition(
        database,
        jobId,
        'paused',
        'queued',
        'resumed',
        updated.attempts,
        null,
        null,
        now
      )
      return updated
    })
    const job = parseRow(row)
    this.#log.info(
      { event: 'queue.job.resumed', projectId: this.#projectId, jobId, jobType: job.type },
      'Project job resumed'
    )
    this.#emit(job)
    return job
  }

  recoverExpiredLeases(): { recovered: number; cancelled: number; failed: number } {
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    const errorJson = serializeJobError({ code: 'lease_expired', retryable: true }, 1, nowDate)
    const result = this.#database.immediate((database) => {
      const expired = database
        .prepare("SELECT * FROM jobs WHERE state = 'running' AND locked_until <= ? ORDER BY job_id")
        .all(now) as JobTable[]
      const counts = { recovered: 0, cancelled: 0, failed: 0 }
      for (const row of expired) {
        const state: 'queued' | 'failed' | 'cancelled' =
          row.cancellation_requested === 1
            ? 'cancelled'
            : row.attempts >= row.max_attempts
              ? 'failed'
              : 'queued'
        const completedAt = state === 'queued' ? null : now
        const perAttemptError = replaceErrorAttempt(errorJson, row.attempts)
        const updated = database
          .prepare(
            `UPDATE jobs
             SET state = ?, run_after = ?, lease_owner = NULL, lease_token = NULL,
                 locked_until = NULL, heartbeat_at = ?, error_json = ?, completed_at = ?, updated_at = ?
             WHERE job_id = ? AND state = 'running' AND locked_until <= ?`
          )
          .run(
            state,
            state === 'queued' ? now : row.run_after,
            now,
            perAttemptError,
            completedAt,
            now,
            row.job_id,
            now
          )
        if (updated.changes !== 1) continue
        this.#insertTransition(
          database,
          row.job_id,
          'running',
          state,
          'lease_expired',
          row.attempts,
          row.lease_owner,
          'lease_expired',
          now
        )
        if (state === 'cancelled') counts.cancelled += 1
        else if (state === 'failed') counts.failed += 1
        else counts.recovered += 1
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

  requeueForProjectClose(lease: JobLease, runAfter?: Date): JobRecord {
    const nowDate = this.#now()
    const now = nowDate.toISOString()
    const job = this.#database.immediate((database) => {
      const owned = this.#readOwned(database, lease, now)
      const cancelled = owned.cancellation_requested === 1
      const state: JobState = cancelled ? 'cancelled' : 'queued'
      const row = database
        .prepare(
          `UPDATE jobs
           SET state = ?, run_after = ?, resume_same_attempt = ?,
               lease_owner = NULL, lease_token = NULL, locked_until = NULL,
               heartbeat_at = ?, completed_at = ?, updated_at = ?
           WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND lease_token = ?
             AND attempts = ? AND locked_until > ?
           RETURNING *`
        )
        .get(
          state,
          cancelled ? owned.run_after : (runAfter ?? nowDate).toISOString(),
          cancelled ? 0 : 1,
          now,
          cancelled ? now : null,
          now,
          lease.jobId,
          lease.workerId,
          lease.leaseToken,
          lease.attempt,
          now
        ) as JobTable | undefined
      if (row === undefined) throw new JobOwnershipError()
      this.#insertTransition(
        database,
        lease.jobId,
        'running',
        state,
        cancelled ? 'cancellation_acknowledged' : 'project_close_requeued',
        lease.attempt,
        lease.workerId,
        null,
        now
      )
      return parseRow(row)
    })
    this.#log.info(
      {
        event:
          job.state === 'cancelled' ? 'queue.job.cancelled' : 'queue.job.project_close_requeued',
        projectId: this.#projectId,
        jobId: lease.jobId,
        jobType: job.type,
        workerId: lease.workerId
      },
      job.state === 'cancelled'
        ? 'Project job cancellation acknowledged during close'
        : 'Project job requeued without consuming another attempt'
    )
    this.#emit(job)
    return job
  }

  get(jobId: string): JobRecord | null {
    const row = this.#database.immediate(
      (database) =>
        database.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as JobTable | undefined
    )
    return row === undefined ? null : parseRow(row)
  }

  list(options: ListJobsOptions): JobRecord[] {
    const limit = integerInRange(options.limit, 1, 100, 'limit')
    const states = options.states?.map((state) => jobStateSchema.parse(state)) ?? []
    const stateClause =
      states.length === 0 ? '' : `AND state IN (${states.map(() => '?').join(', ')})`
    const cursorClause = options.cursor === undefined ? '' : 'AND (updated_at, job_id) < (?, ?)'
    const parameters: unknown[] = [...states]
    if (options.cursor !== undefined) {
      parameters.push(options.cursor.updatedAt, options.cursor.jobId)
    }
    parameters.push(limit)
    return this.#database.immediate((database) =>
      (
        database
          .prepare(
            `SELECT * FROM jobs WHERE 1 = 1 ${stateClause} ${cursorClause}
             ORDER BY updated_at DESC, job_id DESC LIMIT ?`
          )
          .all(...parameters) as JobTable[]
      ).map(parseRow)
    )
  }

  subscribe(listener: (job: JobRecord) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  require(jobId: string): JobRecord {
    const job = this.get(jobId)
    if (job === null) throw new Error('Job does not exist')
    return job
  }

  listTransitions(jobId: string): JobTransitionRecord[] {
    return this.#database.immediate((database) =>
      (
        database
          .prepare('SELECT * FROM job_transitions WHERE job_id = ? ORDER BY sequence')
          .all(jobId) as JobTransitionTable[]
      ).map(parseTransitionRow)
    )
  }

  #ownedStateTransition(
    lease: JobLease,
    now: string,
    toState: JobState,
    transitionEvent: string,
    statement: string,
    parameters: readonly unknown[],
    errorCode: JobErrorCode | null,
    logEvent: string,
    message: string
  ): JobRecord {
    const row = this.#database.immediate((database) => {
      const updated = database.prepare(statement).get(...parameters) as JobTable | undefined
      if (updated === undefined) throw new JobOwnershipError()
      this.#insertTransition(
        database,
        lease.jobId,
        'running',
        toState,
        transitionEvent,
        lease.attempt,
        lease.workerId,
        errorCode,
        now
      )
      return updated
    })
    const job = parseRow(row)
    this.#log.info(
      {
        event: logEvent,
        projectId: this.#projectId,
        jobId: lease.jobId,
        jobType: job.type,
        workerId: lease.workerId
      },
      message
    )
    this.#emit(job)
    return job
  }

  #emit(job: JobRecord): void {
    for (const listener of this.#listeners) listener(job)
  }

  #readOwned(database: Database.Database, lease: JobLease, now: string): JobTable {
    const row = database
      .prepare(
        `SELECT * FROM jobs
         WHERE job_id = ? AND state = 'running' AND lease_owner = ? AND lease_token = ?
           AND attempts = ? AND locked_until > ?`
      )
      .get(lease.jobId, lease.workerId, lease.leaseToken, lease.attempt, now) as
      | JobTable
      | undefined
    if (row === undefined) throw new JobOwnershipError()
    return row
  }

  #insertTransition(
    database: Database.Database,
    jobId: string,
    fromState: JobState | null,
    toState: JobState,
    event: string,
    attempt: number,
    workerId: string | null,
    errorCode: JobErrorCode | null,
    occurredAt: string
  ): void {
    database
      .prepare(
        `INSERT INTO job_transitions (
           job_id, from_state, to_state, event, attempt, worker_id, error_code, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(jobId, fromState, toState, event, attempt, workerId, errorCode, occurredAt)
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
  const type = jobTypeSchema.parse(row.type)
  return {
    jobId: row.job_id,
    type,
    payload: parseJobPayload(type, JSON.parse(row.payload_json)),
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
    completedAt: row.completed_at,
    resumeSameAttempt: row.resume_same_attempt === 1
  }
}

function parseTransitionRow(row: JobTransitionTable): JobTransitionRecord {
  return {
    sequence: row.sequence,
    jobId: row.job_id,
    fromState: row.from_state === null ? null : jobStateSchema.parse(row.from_state),
    toState: jobStateSchema.parse(row.to_state),
    event: row.event,
    attempt: row.attempt,
    workerId: row.worker_id,
    errorCode: row.error_code,
    occurredAt: row.occurred_at
  }
}

function serializePayload(type: JobType, payload: JobPayload): string {
  const parsed = parseJobPayload(type, payload)
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
  if (typeof value === 'string' && forbiddenPathOrUrl.test(value)) {
    throw new Error('Job payload contains a forbidden path or URL')
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
    for (const [childKey, child] of Object.entries(value)) {
      inspectPayload(child, depth + 1, childKey)
    }
  }
}

function serializeProgress(progress: JobProgress): string {
  return boundedJson(jobProgressSchema.parse(progress), MAX_PROGRESS_BYTES, 'Job progress')
}

function boundedJson(value: unknown, maxBytes: number, label: string): string {
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json, 'utf8') > maxBytes)
    throw new Error(`${label} exceeds ${maxBytes} bytes`)
  return json
}

function serializeJobError(
  classification: JobFailureClassification,
  attempt: number,
  now: Date
): string {
  try {
    const code = jobErrorCodeSchema.safeParse(classification.code).data ?? 'job_execution_failed'
    const value = jobErrorSchema.parse({
      code,
      message: truncateUtf8(JOB_ERROR_MESSAGES[code], 2_048),
      retryable: classification.retryable === true,
      attempt: Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1)),
      recordedAt: now.toISOString()
    })
    const serialized = JSON.stringify(value)
    return Buffer.byteLength(serialized, 'utf8') < MAX_ERROR_BYTES
      ? serialized
      : '{"code":"job_execution_failed","message":"Job execution failed","retryable":false,"attempt":1,"recordedAt":"1970-01-01T00:00:00.000Z"}'
  } catch {
    return '{"code":"job_execution_failed","message":"Job execution failed","retryable":false,"attempt":1,"recordedAt":"1970-01-01T00:00:00.000Z"}'
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = ''
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maxBytes) break
    result += character
  }
  return result
}

function replaceErrorAttempt(serialized: string, attempt: number): string {
  try {
    const parsed = jobErrorSchema.parse(JSON.parse(serialized))
    return serializeJobError(parsed, attempt, new Date(parsed.recordedAt))
  } catch {
    return serialized
  }
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

function defaultFailureClassification(error: unknown): JobFailureClassification {
  if (typeof error !== 'object' || error === null) {
    return { code: 'job_execution_failed', retryable: true }
  }
  const candidate = error as { code?: unknown; retryable?: unknown }
  return {
    code: candidate.code === 'invalid_input' ? 'invalid_input' : 'job_execution_failed',
    retryable: candidate.retryable !== false
  }
}
