import { z } from 'zod'

/**
 * Compaction is a memory aid, not an authority record.  Keep this contract
 * independent from the Agent IPC contract so the runtime can evolve its
 * memory representation without widening the renderer boundary.
 */
export const agentCompactionTriggerV4Schema = z.enum([
  'auto_threshold',
  'manual',
  'provider_overflow'
])

export const agentCompactionCheckpointV4PayloadSchema = z
  .object({
    schemaVersion: z.literal(4),
    compactionId: z.uuid(),
    trigger: agentCompactionTriggerV4Schema,
    previousCheckpointEventId: z.uuid().nullable(),
    coveredFromSequence: z.number().int().positive(),
    coveredThroughSequence: z.number().int().positive(),
    summary: z.string().min(1).max(262_144),
    omittedEventCount: z.number().int().nonnegative(),
    estimatedTokensBefore: z.number().int().nonnegative(),
    estimatedTokensAfter: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
  .refine((value) => value.coveredFromSequence <= value.coveredThroughSequence, {
    message: 'Compaction checkpoint coverage is invalid'
  })

export type AgentCompactionCheckpointV4Payload = z.infer<
  typeof agentCompactionCheckpointV4PayloadSchema
>
