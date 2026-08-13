import { z } from 'zod'
import { agentSessionIdSchema } from './agent'
import { mutationProposalKindSchema, mutationProposalStatusSchema } from './agent-mutations'
import { projectSessionIdSchema } from './projects'
import { writingTaskIdSchema } from './writing-task'

export const MAX_CHANGE_SET_BATCH_ITEMS = 100
const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const changeSetBatchActionSchema = z.enum(['apply', 'reject'])
export const changeSetCheckpointStatusSchema = z.enum([
  'not_requested',
  'pending',
  'created',
  'unavailable',
  'failed'
])
export const changeSetBatchItemStatusSchema = z.enum([
  'pending',
  'applied',
  'satisfied',
  'rejected',
  'refresh_required',
  'conflicted',
  'failed',
  'skipped'
])

export const changeSetBatchInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  taskId: writingTaskIdSchema,
  commandId: z.uuid(),
  action: changeSetBatchActionSchema,
  proposalIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_CHANGE_SET_BATCH_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length, 'Proposal IDs must be unique'),
  rejectReason: z.string().trim().min(1).max(4_096).nullable().default(null),
  createCheckpoint: z.boolean().default(false)
}).superRefine((input, context) => {
  if ((input.action === 'reject') !== (input.rejectReason !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['rejectReason'],
      message: 'Reject batches require a reason; apply batches forbid one'
    })
  }
})

export const changeSetBatchItemResultSchema = strictObject({
  proposalId: z.uuid(),
  effectiveProposalId: z.uuid(),
  kind: mutationProposalKindSchema,
  status: changeSetBatchItemStatusSchema,
  authoritativeStatus: mutationProposalStatusSchema,
  message: z.string().min(1).max(4_096).nullable()
})

export const changeSetBatchResultSchema = strictObject({
  commandId: z.uuid(),
  taskId: writingTaskIdSchema,
  action: changeSetBatchActionSchema,
  status: z.enum(['completed', 'partial', 'stopped']),
  checkpointStatus: changeSetCheckpointStatusSchema,
  items: z.array(changeSetBatchItemResultSchema).max(MAX_CHANGE_SET_BATCH_ITEMS),
  completedCount: z.number().int().nonnegative(),
  remainingCount: z.number().int().nonnegative(),
  review: strictObject({
    reconciled: z.boolean(),
    appliedCount: z.number().int().nonnegative(),
    satisfiedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    adverseCount: z.number().int().nonnegative()
  })
})

export type ChangeSetBatchInput = z.infer<typeof changeSetBatchInputSchema>
export type ChangeSetCheckpointStatus = z.infer<typeof changeSetCheckpointStatusSchema>
export type ChangeSetBatchItemResult = z.infer<typeof changeSetBatchItemResultSchema>
export type ChangeSetBatchResult = z.infer<typeof changeSetBatchResultSchema>
