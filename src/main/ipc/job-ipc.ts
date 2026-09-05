import { ipcMain, type IpcMain, type WebContents } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  jobStatusEventSchema,
  jobStatusInputSchema,
  jobStatusSchema,
  listJobsInputSchema,
  listJobsResultSchema,
  type JobStatus
} from '../../shared/contracts/jobs'
import type { ProjectDatabase } from '../project/project-database'
import type { JobRecord } from '../jobs/job-store'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export interface JobIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export interface RegisterJobIpcOptions {
  manager: ProjectManager
  logger: Pick<Logger, 'error'>
  developmentUrl?: string
  ipc?: JobIpcMain
}

export interface JobIpcRegistration {
  revokeSession(projectSessionId: string): void
  unregister(): void
}

export function registerJobIpc(options: RegisterJobIpcOptions): JobIpcRegistration {
  const ipc = options.ipc ?? ipcMain
  const subscriptions = new Map<
    number,
    { sender: WebContents; projectSessionId: string; unsubscribe: () => void }
  >()

  ipc.handle(IPC_CHANNELS.jobsList, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = listJobsInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const jobs = context.jobs.list({
      limit: parsed.limit,
      states: parsed.states,
      cursor: parsed.cursor
    })
    options.manager.assertActiveSession(parsed.projectSessionId)
    const last = jobs.at(-1)
    return listJobsResultSchema.parse({
      jobs: jobs.map((job) => toJobStatus(job, context.database)),
      nextCursor:
        jobs.length === parsed.limit && last !== undefined
          ? { updatedAt: last.updatedAt, jobId: last.jobId }
          : null
    })
  })

  ipc.handle(IPC_CHANNELS.jobsGetStatus, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = jobStatusInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const job = context.jobs.require(parsed.jobId)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return jobStatusSchema.parse(toJobStatus(job, context.database))
  })

  ipc.handle(IPC_CHANNELS.jobsRequestCancellation, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = jobStatusInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const job = context.jobs.requestCancellation(parsed.jobId)
    context.runtime.scheduler.cancel(parsed.jobId)
    options.manager.assertActiveSession(parsed.projectSessionId)
    return jobStatusSchema.parse(toJobStatus(job, context.database))
  })

  ipc.handle(IPC_CHANNELS.jobsSubscribeStatus, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = jobStatusInputSchema.omit({ jobId: true }).parse(input)
    const context = options.manager.assertActiveSession(projectSessionId)
    subscriptions.get(event.sender.id)?.unsubscribe()
    const unsubscribe = context.jobs.subscribe((job) => {
      try {
        options.manager.assertActiveSession(projectSessionId)
        event.sender.send(
          IPC_CHANNELS.jobsStatusEvent,
          jobStatusEventSchema.parse({ projectSessionId, job: toJobStatus(job, context.database) })
        )
      } catch (err) {
        options.logger.error(
          { event: 'ipc.jobs_status_event.failed', err, jobId: job.jobId },
          'Failed to publish bounded job status event'
        )
      }
    })
    subscriptions.set(event.sender.id, { sender: event.sender, projectSessionId, unsubscribe })
  })

  ipc.handle(IPC_CHANNELS.jobsUnsubscribeStatus, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = jobStatusInputSchema.omit({ jobId: true }).parse(input)
    const subscription = subscriptions.get(event.sender.id)
    if (subscription?.projectSessionId === projectSessionId) {
      subscription.unsubscribe()
      subscriptions.delete(event.sender.id)
    }
  })

  return {
    revokeSession(projectSessionId) {
      for (const [senderId, subscription] of subscriptions) {
        if (subscription.projectSessionId === projectSessionId) {
          subscription.unsubscribe()
          subscriptions.delete(senderId)
        }
      }
    },
    unregister() {
      for (const subscription of subscriptions.values()) subscription.unsubscribe()
      subscriptions.clear()
      for (const channel of [
        IPC_CHANNELS.jobsList,
        IPC_CHANNELS.jobsGetStatus,
        IPC_CHANNELS.jobsRequestCancellation,
        IPC_CHANNELS.jobsSubscribeStatus,
        IPC_CHANNELS.jobsUnsubscribeStatus
      ]) {
        ipc.removeHandler(channel)
      }
    }
  }
}

export function toJobStatus(job: JobRecord, database: ProjectDatabase): JobStatus {
  return {
    jobId: job.jobId,
    type: job.type,
    subject: jobSubject(job, database),
    state: job.state,
    priority: job.priority,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    progress: job.progress,
    cancellationRequested: job.cancellationRequested,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt
  }
}

function jobSubject(job: JobRecord, database: ProjectDatabase): JobStatus['subject'] {
  if (job.type === 'artifact_cleanup') return { kind: 'maintenance' }
  if (typeof job.payload.knowledgeItemId === 'string') {
    return { kind: 'file', knowledgeItemId: job.payload.knowledgeItemId }
  }
  if (job.type === 'mineru_parse' || job.type === 'normalize_parse_revision') {
    const knowledgeItemId = database.immediate(
      (connection) =>
        connection
          .prepare(
            job.type === 'mineru_parse'
              ? 'SELECT knowledge_item_id FROM parse_tasks WHERE parse_task_id = ?'
              : 'SELECT knowledge_item_id FROM parse_revisions WHERE parse_revision_id = ?'
          )
          .pluck()
          .get(job.payload.parseTaskId ?? job.payload.parseRevisionId) as string | undefined
    )
    return knowledgeItemId === undefined ? { kind: 'unknown' } : { kind: 'file', knowledgeItemId }
  }
  return { kind: 'project' }
}
