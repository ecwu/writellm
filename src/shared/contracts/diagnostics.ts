import { z } from 'zod'
import { diagnosticLogSchema, LOG_LEVELS, SUBSYSTEMS } from '../observability/log-schema'

export const rendererErrorReportSchema = z
  .object({
    event: z.enum(['renderer.error', 'renderer.unhandled_rejection']),
    message: z.string().min(1).max(4_096),
    stack: z.string().max(32_768).optional(),
    source: z.string().max(512).optional(),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional()
  })
  .strict()

export type RendererErrorReport = z.infer<typeof rendererErrorReportSchema>

export const diagnosticsSnapshotSchema = z.array(diagnosticLogSchema).max(5_000)
export type DiagnosticsSnapshot = z.infer<typeof diagnosticsSnapshotSchema>

export const diagnosticsLevelInputSchema = z
  .object({
    subsystem: z.enum(SUBSYSTEMS),
    level: z.enum(LOG_LEVELS),
    durationMs: z
      .number()
      .int()
      .min(1_000)
      .max(30 * 60 * 1_000)
      .default(30 * 60 * 1_000)
  })
  .strict()

export const diagnosticExportResultSchema = z.object({
  exported: z.boolean()
})

export type DiagnosticsLevelInput = z.infer<typeof diagnosticsLevelInputSchema>
export type DiagnosticExportResult = z.infer<typeof diagnosticExportResultSchema>
