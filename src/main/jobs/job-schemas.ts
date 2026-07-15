import { z } from 'zod'

export const JOB_STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'paused'
] as const

export const jobStateSchema = z.enum(JOB_STATES)
export const jobTypeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9._-]+$/)
export const jobPayloadSchema = z.record(z.string().min(1).max(128), z.unknown())
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

export const jobErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2_048),
    retryable: z.boolean(),
    attempt: z.number().int().positive(),
    recordedAt: z.iso.datetime()
  })
  .strict()

export type JobPayload = z.infer<typeof jobPayloadSchema>
export type JobProgress = z.infer<typeof jobProgressSchema>
export type JobError = z.infer<typeof jobErrorSchema>
