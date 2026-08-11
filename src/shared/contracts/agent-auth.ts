import { z } from 'zod'

export const agentRuntimeAuthSchema = z
  .object({
    apiKey: z.string().min(1).max(16_384).optional(),
    headers: z.record(z.string().min(1).max(200), z.string().max(16_384).nullable()).optional(),
    env: z.record(z.string().min(1).max(200), z.string().max(16_384)).optional()
  })
  .strict()

export type AgentRuntimeAuth = z.infer<typeof agentRuntimeAuthSchema>
