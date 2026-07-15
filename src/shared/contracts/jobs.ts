import { z } from 'zod'
import { projectSessionIdSchema } from './projects'

export const jobStateDtoSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'paused'
])

export const jobTypeDtoSchema = z.enum([
  'embedding.batch',
  'import.validate',
  'index.build',
  'index.publish',
  'index.rebuild',
  'mineru.download',
  'mineru.poll',
  'mineru.submit',
  'rerank.request'
])

export const jobStatusSchema = z
  .object({
    jobId: z.string().min(1).max(256),
    type: jobTypeDtoSchema,
    state: jobStateDtoSchema,
    priority: z.number().int().min(-1_000).max(1_000),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive().max(100),
    runAfter: z.iso.datetime(),
    progress: z
      .object({
        completed: z.number().finite().nonnegative().optional(),
        total: z.number().finite().positive().optional(),
        stage: z.string().min(1).max(128).optional(),
        message: z.string().min(1).max(512).optional()
      })
      .strict()
      .nullable(),
    cancellationRequested: z.boolean(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(2_048),
        retryable: z.boolean(),
        attempt: z.number().int().positive(),
        recordedAt: z.iso.datetime()
      })
      .strict()
      .nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable()
  })
  .strict()

export const jobCursorSchema = z
  .object({ updatedAt: z.iso.datetime(), jobId: z.string().min(1).max(256) })
  .strict()

export const listJobsInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    limit: z.number().int().min(1).max(100).default(50),
    states: z.array(jobStateDtoSchema).max(6).optional(),
    cursor: jobCursorSchema.optional()
  })
  .strict()

export const listJobsResultSchema = z
  .object({ jobs: z.array(jobStatusSchema).max(100), nextCursor: jobCursorSchema.nullable() })
  .strict()

export const jobStatusInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    jobId: z.string().min(1).max(256)
  })
  .strict()

export const jobStatusEventSchema = z
  .object({ projectSessionId: projectSessionIdSchema, job: jobStatusSchema })
  .strict()

export type JobStatus = z.infer<typeof jobStatusSchema>
export type ListJobsInput = z.infer<typeof listJobsInputSchema>
export type ListJobsResult = z.infer<typeof listJobsResultSchema>
export type JobStatusInput = z.infer<typeof jobStatusInputSchema>
export type JobStatusEvent = z.infer<typeof jobStatusEventSchema>
