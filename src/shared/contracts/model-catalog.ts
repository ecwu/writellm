import { z } from 'zod'
import { agentModelLimitsSchema } from './agent'

export const modelsDevResolveRequestSchema = z
  .object({
    operation: z.literal('models_dev_resolve'),
    requestId: z.uuid(),
    baseUrl: z.url().max(2_048),
    model: z.string().min(1).max(500)
  })
  .strict()

const diagnosticErrorSchema = z
  .object({
    name: z.string().max(200),
    message: z.string().max(4_096),
    stack: z.string().max(32_768).optional()
  })
  .strict()

export const modelsDevResolveResponseSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('models-dev-result'),
      requestId: z.uuid(),
      limits: agentModelLimitsSchema.nullable()
    })
    .strict(),
  z
    .object({
      type: z.literal('models-dev-error'),
      requestId: z.uuid(),
      error: diagnosticErrorSchema
    })
    .strict()
])

export type ModelsDevResolveRequest = z.infer<typeof modelsDevResolveRequestSchema>
export type ModelsDevResolveResponse = z.infer<typeof modelsDevResolveResponseSchema>
