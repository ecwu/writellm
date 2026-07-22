import { z } from 'zod'

export const agentModelLimitsSchema = z
  .object({
    contextWindowTokens: z.number().int().min(8_192).max(10_000_000),
    inputLimitTokens: z.number().int().min(1).max(10_000_000).nullable(),
    outputLimitTokens: z.number().int().min(1).max(1_000_000).nullable(),
    source: z.enum(['models_dev', 'manual_override', 'cache', 'legacy_fallback']),
    catalogModelKey: z.string().min(1).max(500).nullable(),
    resolvedAt: z.iso.datetime().nullable()
  })
  .strict()

export const legacyAgentModelLimits = {
  contextWindowTokens: 131_072,
  inputLimitTokens: null,
  outputLimitTokens: null,
  source: 'legacy_fallback',
  catalogModelKey: null,
  resolvedAt: null
} as const

export type AgentModelLimits = z.infer<typeof agentModelLimitsSchema>
