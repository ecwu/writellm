import { z, type ZodType } from 'zod'

export const JOB_STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'paused'
] as const

export const JOB_TYPES = [
  'embedding.batch',
  'import.validate',
  'index.build',
  'index.item-delete',
  'index.item-upsert',
  'index.publish',
  'index.rebuild',
  'mineru.download',
  'mineru.normalize',
  'mineru.poll',
  'mineru.submit',
  'rerank.request'
] as const

export type JobType = (typeof JOB_TYPES)[number]
export type JobPayloadRegistry = Record<JobType, ZodType<Record<string, unknown>>>
export type JobErrorCode =
  | 'invalid_input'
  | 'job_execution_failed'
  | 'lease_expired'
  | 'migration_lease_recovered'

export const JOB_ERROR_MESSAGES: Readonly<Record<JobErrorCode, string>> = {
  invalid_input: 'Job input is invalid',
  job_execution_failed: 'Job execution failed',
  lease_expired: 'Worker lease expired before completion',
  migration_lease_recovered: 'Interrupted job recovered during database migration'
}

const referenceId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
export const jobPayloadRegistry = {
  'embedding.batch': z.object({ batchId: referenceId }).strict(),
  'import.validate': z.object({ fileId: referenceId }).strict(),
  'index.build': z.object({ generationId: referenceId }).strict(),
  'index.item-delete': z.object({ knowledgeItemId: referenceId }).strict(),
  'index.item-upsert': z.object({ knowledgeItemId: referenceId }).strict(),
  'index.publish': z.object({ generationId: referenceId }).strict(),
  'index.rebuild': z.object({ generationId: referenceId }).strict(),
  'mineru.download': z.object({ parseTaskId: referenceId }).strict(),
  'mineru.normalize': z.object({ parseRevisionId: referenceId }).strict(),
  'mineru.poll': z.object({ parseTaskId: referenceId }).strict(),
  'mineru.submit': z.object({ parseTaskId: referenceId }).strict(),
  'rerank.request': z.object({ requestId: referenceId }).strict()
} satisfies JobPayloadRegistry

export const jobStateSchema = z.enum(JOB_STATES)
export const jobTypeSchema = z.enum(JOB_TYPES)
export const jobProgressSchema = z
  .object({
    completed: z.number().finite().nonnegative().optional(),
    total: z.number().finite().positive().optional(),
    stage: z.string().min(1).max(128).optional(),
    message: z.string().min(1).max(512).optional()
  })
  .strict()
  .refine(
    ({ completed, total }) => completed === undefined || total === undefined || completed <= total,
    'Progress completed value cannot exceed total'
  )

export const jobErrorCodeSchema = z.enum([
  'invalid_input',
  'job_execution_failed',
  'lease_expired',
  'migration_lease_recovered'
])
export const jobErrorSchema = z
  .object({
    code: jobErrorCodeSchema,
    message: z.string().min(1).max(2_048),
    retryable: z.boolean(),
    attempt: z.number().int().positive(),
    recordedAt: z.iso.datetime()
  })
  .strict()

export function parseJobPayload(type: JobType, payload: unknown): JobPayload {
  return jobPayloadRegistry[type].parse(payload)
}

export type JobPayload = Record<string, unknown>
export type JobProgress = z.infer<typeof jobProgressSchema>
export type JobError = z.infer<typeof jobErrorSchema>
