import { z } from 'zod'
import { providerConfigSchema } from './providers'

export const providerProbeRequestSchema = z.object({
  requestId: z.uuid(),
  config: providerConfigSchema,
  credential: z.string().min(1).max(16_384)
})
export type ProviderProbeRequest = z.infer<typeof providerProbeRequestSchema>

export const providerProbeResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('result'),
    requestId: z.uuid(),
    status: z.number().int().min(100).max(599),
    providerCode: z.string().max(100).optional()
  }),
  z.object({
    type: z.literal('error'),
    requestId: z.uuid(),
    error: z.object({
      name: z.string().max(200),
      message: z.string().max(4_096),
      stack: z.string().max(32_768).optional()
    })
  })
])
export type ProviderProbeResponse = z.infer<typeof providerProbeResponseSchema>
