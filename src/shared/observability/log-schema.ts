import { z } from 'zod'

export const SUBSYSTEMS = [
  'app',
  'project',
  'ipc',
  'db',
  'queue',
  'storage',
  'manuscript',
  'knowledge',
  'import',
  'index',
  'search',
  'agent',
  'tool',
  'llm',
  'embedding',
  'rerank',
  'mineru',
  'worker',
  'security',
  'updater'
] as const

export const PROCESS_ROLES = [
  'main',
  'renderer',
  'agent-worker',
  'background-worker',
  'index-worker'
] as const
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

export type Subsystem = (typeof SUBSYSTEMS)[number]
export type ProcessRole = (typeof PROCESS_ROLES)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]

export const logContextSchema = z
  .object({
    operationId: z.string().max(128).optional(),
    jobId: z.string().max(128).optional(),
    requestId: z.string().max(128).optional(),
    traceId: z.string().max(128).optional(),
    projectId: z.string().max(128).optional(),
    projectSessionId: z.string().max(128).optional(),
    manuscriptId: z.string().max(128).optional(),
    sectionId: z.string().max(128).optional(),
    sectionRevisionId: z.string().max(512).optional(),
    documentId: z.string().max(128).optional()
  })
  .strict()

export type LogContext = Readonly<z.infer<typeof logContextSchema>>

export const serializedErrorSchema = z
  .object({
    type: z.string().max(128),
    message: z.string().max(4_096),
    stack: z.string().max(32_768).optional(),
    cause: z.string().max(4_096).optional()
  })
  .strict()

const safeFieldValueSchema = z.union([
  z.string().max(4_096),
  z.number().finite(),
  z.boolean(),
  z.null()
])

export const logEnvelopeSchema = z
  .object({
    level: z.enum(LOG_LEVELS),
    sourceTime: z.iso.datetime(),
    processRole: z.enum(PROCESS_ROLES),
    subsystem: z.enum(SUBSYSTEMS),
    component: z.string().min(1).max(128),
    event: z
      .string()
      .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/)
      .max(128),
    message: z.string().min(1).max(4_096),
    context: logContextSchema.default({}),
    fields: z.record(z.string().max(128), safeFieldValueSchema).optional(),
    error: serializedErrorSchema.optional(),
    processSequence: z.number().int().nonnegative()
  })
  .strict()

export type LogEnvelope = z.infer<typeof logEnvelopeSchema>

export const diagnosticLogSchema = z.record(z.string(), z.unknown())
export type DiagnosticLog = z.infer<typeof diagnosticLogSchema>
