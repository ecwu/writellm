import { z } from 'zod'
import {
  agentApprovalModeSchema,
  agentEditorContextSchema,
  agentEventIdSchema,
  agentEventTypeSchema,
  agentRunIdSchema,
  agentRunStatusSchema,
  agentSessionIdSchema,
  agentSessionStatusSchema
} from './agent'
import { agentModelLimitsSchema } from './agent'
import { mutationProposalRecordSchema } from './agent-mutations'
import { projectSessionIdSchema } from './projects'
import { providerIdSchema } from './providers'

export const AGENT_EVENT_PAGE_LIMIT = 200
export const AGENT_SESSION_LIMIT = 200
export const AGENT_RUN_LIMIT = 200

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const agentSessionRecordSchema = strictObject({
  agentSessionId: agentSessionIdSchema,
  title: z.string().min(1).max(500),
  status: agentSessionStatusSchema,
  compatible: z.boolean(),
  approvalMode: agentApprovalModeSchema.default('manual'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const agentRunRecordSchema = strictObject({
  agentRunId: agentRunIdSchema,
  agentSessionId: agentSessionIdSchema,
  status: agentRunStatusSchema,
  providerId: providerIdSchema,
  modelId: z.string().min(1).max(500),
  approvalMode: agentApprovalModeSchema.default('manual'),
  modelLimits: agentModelLimitsSchema.default({
    contextWindowTokens: 131_072,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source: 'legacy_fallback',
    catalogModelKey: null,
    resolvedAt: null
  }),
  editorContext: agentEditorContextSchema,
  errorCode: z.string().min(1).max(200).nullable(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime()
})

export const agentEventRecordSchema = strictObject({
  agentEventId: agentEventIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema.nullable(),
  sequence: z.number().int().positive(),
  type: agentEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  modelRequestId: z.uuid().nullable(),
  createdAt: z.iso.datetime()
}).superRefine((event, context) => {
  if (new TextEncoder().encode(JSON.stringify(event.payload)).byteLength > 2_097_152) {
    context.addIssue({ code: 'custom', path: ['payload'], message: 'Event payload is too large' })
  }
})

export const agentProjectInputSchema = strictObject({ projectSessionId: projectSessionIdSchema })
export const agentSessionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema
})
export const agentCreateSessionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  title: z.string().trim().min(1).max(500).default('New conversation')
})
export const agentCreateSessionResultSchema = agentSessionRecordSchema
export const agentSetApprovalModeInputSchema = agentSessionInputSchema.extend({
  mode: agentApprovalModeSchema
})
export const agentSetApprovalModeResultSchema = agentSessionRecordSchema
export const agentListSessionsResultSchema = z
  .array(agentSessionRecordSchema)
  .max(AGENT_SESSION_LIMIT)

export const agentEventPageInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  afterSequence: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(AGENT_EVENT_PAGE_LIMIT).default(AGENT_EVENT_PAGE_LIMIT)
})
export const agentEventPageSchema = strictObject({
  events: z.array(agentEventRecordSchema).max(AGENT_EVENT_PAGE_LIMIT),
  nextAfterSequence: z.number().int().nonnegative(),
  hasMore: z.boolean()
})

export const agentListRunsInputSchema = agentSessionInputSchema.extend({
  limit: z.number().int().min(1).max(AGENT_RUN_LIMIT).default(AGENT_RUN_LIMIT)
})
export const agentListRunsResultSchema = z.array(agentRunRecordSchema).max(AGENT_RUN_LIMIT)
export const agentListProposalsResultSchema = z.array(mutationProposalRecordSchema).max(1_000)

export const agentStartScopeSchema = z.enum(['selection', 'section', 'project'])
export const agentStartRunInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  prompt: z.string().trim().min(1).max(262_144),
  approvedProposalId: z.uuid().optional(),
  scope: agentStartScopeSchema,
  editorContext: agentEditorContextSchema
}).superRefine((input, context) => {
  if (input.scope === 'project') {
    if (
      input.editorContext.activeSectionId !== null ||
      input.editorContext.activeBlockId !== null ||
      input.editorContext.selectedBlockIds.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editorContext'],
        message: 'Project scope must not include editor selection'
      })
    }
    return
  }
  if (input.editorContext.activeSectionId === null) {
    context.addIssue({
      code: 'custom',
      path: ['editorContext', 'activeSectionId'],
      message: 'Section context is required'
    })
  }
  if (
    input.scope === 'section' &&
    (input.editorContext.activeBlockId !== null || input.editorContext.selectedBlockIds.length > 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['editorContext'],
      message: 'Section scope must not include block selection'
    })
  }
  if (input.scope === 'selection' && input.editorContext.selectedBlockIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['editorContext', 'selectedBlockIds'],
      message: 'Selection scope requires selected blocks'
    })
  }
})
export const agentStartRunResultSchema = strictObject({ run: agentRunRecordSchema })

export const agentRunInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentRunId: agentRunIdSchema
})
export const agentQueueInputSchema = agentRunInputSchema.extend({
  content: z.string().trim().min(1).max(262_144)
})

export const agentSubscriptionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  subscriptionId: z.uuid(),
  afterSequence: z.number().int().nonnegative().default(0)
})

export const agentDurableRendererEventSchema = strictObject({
  kind: z.literal('durable'),
  projectSessionId: projectSessionIdSchema,
  event: agentEventRecordSchema
})
export const agentDeltaRendererEventSchema = strictObject({
  kind: z.literal('delta'),
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  delta: z.string().min(1).max(65_536)
})
export const agentRendererEventSchema = z.discriminatedUnion('kind', [
  agentDurableRendererEventSchema,
  agentDeltaRendererEventSchema
])

export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>
export type AgentRunRecord = z.infer<typeof agentRunRecordSchema>
export type AgentEventRecord = z.infer<typeof agentEventRecordSchema>
export type AgentEventPage = z.infer<typeof agentEventPageSchema>
export type AgentStartScope = z.infer<typeof agentStartScopeSchema>
export type AgentRendererEvent = z.infer<typeof agentRendererEventSchema>
