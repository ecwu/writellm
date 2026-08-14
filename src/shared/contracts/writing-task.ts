import { z } from 'zod'
import { agentRunIdSchema, agentSessionIdSchema } from './agent'
import { projectSessionIdSchema } from './projects'

export const WRITING_TASK_SCHEMA_VERSION = 1
export const MAX_WRITING_TASK_STEPS = 32
export const MAX_WRITING_TASK_PLAN_BYTES = 65_536

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const writingTaskIdSchema = z.uuid()
export const writingTaskStepIdSchema = z.uuid()
export const writingTaskStepStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'skipped',
  'blocked'
])

export const writingTaskStepSchema = strictObject({
  stepId: writingTaskStepIdSchema,
  title: z.string().trim().min(1).max(500),
  status: writingTaskStepStatusSchema,
  statusReason: z.string().trim().min(1).max(2_000).nullable()
}).superRefine((step, context) => {
  const needsReason = step.status === 'skipped' || step.status === 'blocked'
  if (needsReason !== (step.statusReason !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['statusReason'],
      message: 'Skipped and blocked steps require a reason; other states forbid one'
    })
  }
})

export const writingTaskPlanSchema = strictObject({
  schemaVersion: z.literal(WRITING_TASK_SCHEMA_VERSION),
  steps: z.array(writingTaskStepSchema).min(1).max(MAX_WRITING_TASK_STEPS)
}).superRefine((plan, context) => {
  const ids = new Set<string>()
  let active = 0
  let pending = 0
  for (const [index, step] of plan.steps.entries()) {
    if (ids.has(step.stepId)) {
      context.addIssue({
        code: 'custom',
        path: ['steps', index, 'stepId'],
        message: 'Duplicate step ID'
      })
    }
    ids.add(step.stepId)
    if (step.status === 'active') active += 1
    if (step.status === 'pending') pending += 1
  }
  if (active > 1 || (pending > 0 && active !== 1)) {
    context.addIssue({
      code: 'custom',
      path: ['steps'],
      message: 'A plan may have one active step and pending work requires exactly one active step'
    })
  }
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > MAX_WRITING_TASK_PLAN_BYTES) {
    context.addIssue({ code: 'custom', message: 'Writing task plan exceeds its byte limit' })
  }
})

export const writingTaskRecordSchema = strictObject({
  taskId: writingTaskIdSchema,
  agentSessionId: agentSessionIdSchema,
  objective: z.string().trim().min(1).max(4_096),
  planVersion: z.number().int().positive(),
  plan: writingTaskPlanSchema,
  createdByAgentRunId: agentRunIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const writingTaskProgressStateSchema = z.enum([
  'pending',
  'ready',
  'in_progress',
  'awaiting_review',
  'verified_complete',
  'reported_complete',
  'stopped',
  'failed',
  'blocked',
  'skipped',
  'disagreement'
])

export const writingTaskStepProgressSchema = strictObject({
  stepId: writingTaskStepIdSchema,
  state: writingTaskProgressStateSchema,
  runCount: z.number().int().nonnegative(),
  proposalCount: z.number().int().nonnegative(),
  successfulEffectCount: z.number().int().nonnegative(),
  pendingEffectCount: z.number().int().nonnegative(),
  adverseEffectCount: z.number().int().nonnegative(),
  latestRunId: agentRunIdSchema.nullable(),
  note: z.string().min(1).max(500)
})

export const writingTaskViewSchema = writingTaskRecordSchema.extend({
  progress: strictObject({
    currentStepId: writingTaskStepIdSchema.nullable(),
    completedCount: z.number().int().nonnegative(),
    remainingCount: z.number().int().nonnegative(),
    hasDisagreement: z.boolean(),
    steps: z.array(writingTaskStepProgressSchema).min(1).max(MAX_WRITING_TASK_STEPS)
  })
})

export const getWritingTaskArgsSchema = strictObject({})
export const getWritingTaskResultSchema = strictObject({
  task: writingTaskRecordSchema.nullable()
})

export const createWritingTaskArgsSchema = strictObject({
  objective: z.string().trim().min(1).max(4_096),
  steps: z
    .array(
      strictObject({
        clientRef: z.uuid().describe('Supply a unique temporary step reference in this call.'),
        title: z.string().trim().min(1).max(500)
      })
    )
    .min(1)
    .max(MAX_WRITING_TASK_STEPS)
})

export const createWritingTaskResultSchema = strictObject({
  task: writingTaskRecordSchema,
  createdStepRefs: z.record(z.uuid(), writingTaskStepIdSchema)
})

const retainedWritingTaskStepSchema = strictObject({
  stepId: writingTaskStepIdSchema.describe('Copy get_writing_task.task.plan.steps[].stepId.'),
  title: z.string().trim().min(1).max(500),
  status: writingTaskStepStatusSchema,
  statusReason: z.string().trim().min(1).max(2_000).nullable()
})

const addedWritingTaskStepSchema = strictObject({
  clientRef: z.uuid().describe('Supply a unique temporary reference for this new step.'),
  title: z.string().trim().min(1).max(500),
  status: z.enum(['pending', 'active'])
})

export const updateWritingTaskArgsSchema = strictObject({
  taskId: writingTaskIdSchema.describe('Copy get_writing_task.task.taskId.'),
  expectedPlanVersion: z
    .number()
    .int()
    .positive()
    .describe('Copy get_writing_task.task.planVersion.'),
  objective: z.string().trim().min(1).max(4_096),
  steps: z
    .array(z.union([retainedWritingTaskStepSchema, addedWritingTaskStepSchema]))
    .min(1)
    .max(MAX_WRITING_TASK_STEPS)
})

export const updateWritingTaskResultSchema = createWritingTaskResultSchema

const userRetainedWritingTaskStepSchema = retainedWritingTaskStepSchema
const userAddedWritingTaskStepSchema = strictObject({
  title: z.string().trim().min(1).max(500),
  status: z.enum(['pending', 'active'])
})

export const userUpdateWritingTaskInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  taskId: writingTaskIdSchema,
  expectedPlanVersion: z.number().int().positive(),
  objective: z.string().trim().min(1).max(4_096),
  steps: z
    .array(z.union([userRetainedWritingTaskStepSchema, userAddedWritingTaskStepSchema]))
    .min(1)
    .max(MAX_WRITING_TASK_STEPS)
})

export const userUpdateWritingTaskResultSchema = writingTaskViewSchema

export type WritingTaskStepStatus = z.infer<typeof writingTaskStepStatusSchema>
export type WritingTaskStep = z.infer<typeof writingTaskStepSchema>
export type WritingTaskPlan = z.infer<typeof writingTaskPlanSchema>
export type WritingTaskRecord = z.infer<typeof writingTaskRecordSchema>
export type WritingTaskView = z.infer<typeof writingTaskViewSchema>
export type WritingTaskProgressState = z.infer<typeof writingTaskProgressStateSchema>
