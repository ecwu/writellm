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
import { modelUsageSchema } from './model-runtime'
import { projectSessionIdSchema } from './projects'
import { agentModelSelectionSchema, agentThinkingLevelSchema, piApiSchema } from './providers'
import { skillRunSnapshotSchema, skillSelectionSchema } from './skills'

export const AGENT_EVENT_PAGE_LIMIT = 50
export const AGENT_EVENT_PAGE_MAX_BYTES = 4 * 1024 * 1024
export const AGENT_SESSION_LIMIT = 200
export const AGENT_RUN_LIMIT = 200
export const MAX_CONCURRENT_AGENT_RUNS = 3
export const AGENT_LIVE_PARTIAL_MAX_BYTES = 2 * 1024 * 1024

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const agentSessionWorkflowStateSchema = z.enum([
  'idle',
  'running',
  'compacting',
  'awaiting_review',
  'generating'
])

export const agentSessionRecordSchema = strictObject({
  agentSessionId: agentSessionIdSchema,
  title: z.string().min(1).max(500),
  status: agentSessionStatusSchema,
  compatible: z.boolean(),
  approvalMode: agentApprovalModeSchema.default('manual'),
  workflowState: agentSessionWorkflowStateSchema.default('idle'),
  modelSelection: agentModelSelectionSchema.nullable().default(null),
  thinkingLevel: agentThinkingLevelSchema.default('off'),
  skillSelection: skillSelectionSchema.default({ mode: 'auto' }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable().default(null)
})

export const agentRunRecordSchema = strictObject({
  agentRunId: agentRunIdSchema,
  agentSessionId: agentSessionIdSchema,
  status: agentRunStatusSchema,
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(500),
  providerPresetId: z.string().min(1).max(200).nullable().default(null),
  providerLabel: z.string().max(200).default(''),
  modelLabel: z.string().max(500).default(''),
  api: piApiSchema.default('openai-completions'),
  thinkingLevel: agentThinkingLevelSchema.default('off'),
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
  skillSnapshot: skillRunSnapshotSchema.default({
    mode: 'none',
    routingStatus: 'legacy',
    primary: null,
    dependencies: [],
    resources: [],
    safeError: null
  }),
  skillRouteUsage: strictObject({
    ...modelUsageSchema.shape,
    retryCount: z.number().int().nonnegative().max(20)
  })
    .nullable()
    .default(null),
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
export const agentListSessionsInputSchema = agentProjectInputSchema.extend({
  status: agentSessionStatusSchema.default('active')
})
export const agentCreateSessionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  title: z.string().trim().min(1).max(500).default('New conversation'),
  modelSelection: agentModelSelectionSchema.nullable().optional()
})
export const agentCreateSessionResultSchema = agentSessionRecordSchema
export const agentSetApprovalModeInputSchema = agentSessionInputSchema.extend({
  mode: agentApprovalModeSchema
})
export const agentSetApprovalModeResultSchema = agentSessionRecordSchema
export const agentSetModelSelectionInputSchema = agentSessionInputSchema.extend({
  selection: agentModelSelectionSchema
})
export const agentSetModelSelectionResultSchema = agentSessionRecordSchema
export const agentSetThinkingLevelInputSchema = agentSessionInputSchema.extend({
  level: agentThinkingLevelSchema
})
export const agentSetThinkingLevelResultSchema = agentSessionRecordSchema
export const agentSetSkillSelectionInputSchema = agentSessionInputSchema.extend({
  selection: skillSelectionSchema
})
export const agentSetSkillSelectionResultSchema = agentSessionRecordSchema
export const agentGenerateSessionTitleInputSchema = agentSessionInputSchema
export const agentGenerateSessionTitleResultSchema = agentSessionRecordSchema
export const agentArchiveSessionInputSchema = agentSessionInputSchema
export const agentArchiveSessionResultSchema = agentSessionRecordSchema
export const agentRestoreSessionInputSchema = agentSessionInputSchema
export const agentRestoreSessionResultSchema = agentSessionRecordSchema
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
  hasMore: z.boolean(),
  returnedBytes: z.number().int().nonnegative().max(AGENT_EVENT_PAGE_MAX_BYTES)
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
  rejectedProposalId: z.uuid().optional(),
  reuseSkillFromRunId: agentRunIdSchema.optional(),
  scope: agentStartScopeSchema,
  editorContext: agentEditorContextSchema
}).superRefine((input, context) => {
  if (input.approvedProposalId !== undefined && input.rejectedProposalId !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['rejectedProposalId'],
      message: 'Approved and rejected proposal continuations are mutually exclusive'
    })
  }
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

export const agentCompactSessionInputSchema = agentSessionInputSchema
export const agentCompactSessionResultSchema = strictObject({ compactionId: z.uuid() })
export const agentStopCompactionInputSchema = agentSessionInputSchema.extend({
  compactionId: z.uuid()
})
export const agentStopCompactionResultSchema = strictObject({})

export const agentSubscriptionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  subscriptionId: z.uuid(),
  afterSequence: z.number().int().nonnegative().default(0)
})

export const agentProjectActivitySubscriptionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  subscriptionId: z.uuid()
})

export const agentLiveRunSnapshotSchema = strictObject({
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  phase: z.enum(['routing', 'compacting', 'running']),
  partialText: z.string(),
  startedAt: z.iso.datetime()
}).superRefine((snapshot, context) => {
  if (new TextEncoder().encode(snapshot.partialText).byteLength > AGENT_LIVE_PARTIAL_MAX_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['partialText'],
      message: 'Live Agent output is too large'
    })
  }
})

export const agentLiveCompactionSnapshotSchema = strictObject({
  compactionId: z.uuid(),
  agentSessionId: agentSessionIdSchema,
  trigger: z.enum(['auto_threshold', 'manual', 'provider_overflow']),
  phase: z.enum(['planning', 'summarizing']),
  startedAt: z.iso.datetime()
})

export const agentProjectActivitySnapshotSchema = strictObject({
  limit: z.literal(MAX_CONCURRENT_AGENT_RUNS),
  activeCount: z.number().int().min(0).max(MAX_CONCURRENT_AGENT_RUNS),
  runs: z.array(agentLiveRunSnapshotSchema).max(MAX_CONCURRENT_AGENT_RUNS),
  compactions: z.array(agentLiveCompactionSnapshotSchema).max(MAX_CONCURRENT_AGENT_RUNS).default([])
}).superRefine((snapshot, context) => {
  if (snapshot.activeCount !== snapshot.runs.length + snapshot.compactions.length) {
    context.addIssue({
      code: 'custom',
      path: ['activeCount'],
      message: 'Active Agent count must match the live work snapshots'
    })
  }
  if (new Set(snapshot.runs.map((run) => run.agentRunId)).size !== snapshot.runs.length) {
    context.addIssue({
      code: 'custom',
      path: ['runs'],
      message: 'Agent run snapshots must be unique'
    })
  }
  if (new Set(snapshot.runs.map((run) => run.agentSessionId)).size !== snapshot.runs.length) {
    context.addIssue({
      code: 'custom',
      path: ['runs'],
      message: 'Agent conversation snapshots must be unique'
    })
  }
  const sessionIds = [
    ...snapshot.runs.map((run) => run.agentSessionId),
    ...snapshot.compactions.map((compaction) => compaction.agentSessionId)
  ]
  if (new Set(sessionIds).size !== sessionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['compactions'],
      message: 'Agent work snapshots must be unique per conversation'
    })
  }
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
export const agentSessionRendererEventSchema = strictObject({
  kind: z.literal('session'),
  projectSessionId: projectSessionIdSchema,
  session: agentSessionRecordSchema,
  titleGenerating: z.boolean()
})
export const agentActivityRendererEventSchema = strictObject({
  kind: z.literal('activity'),
  projectSessionId: projectSessionIdSchema,
  snapshot: agentProjectActivitySnapshotSchema
})
export const agentRendererEventSchema = z.discriminatedUnion('kind', [
  agentDurableRendererEventSchema,
  agentDeltaRendererEventSchema,
  agentSessionRendererEventSchema,
  agentActivityRendererEventSchema
])

export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>
export type AgentSessionWorkflowState = z.infer<typeof agentSessionWorkflowStateSchema>
export type AgentRunRecord = z.infer<typeof agentRunRecordSchema>
export type AgentEventRecord = z.infer<typeof agentEventRecordSchema>
export type AgentEventPage = z.infer<typeof agentEventPageSchema>
export type AgentStartScope = z.infer<typeof agentStartScopeSchema>
export type AgentRendererEvent = z.infer<typeof agentRendererEventSchema>
export type AgentLiveRunSnapshot = z.infer<typeof agentLiveRunSnapshotSchema>
export type AgentLiveCompactionSnapshot = z.infer<typeof agentLiveCompactionSnapshotSchema>
export type AgentProjectActivitySnapshot = z.infer<typeof agentProjectActivitySnapshotSchema>
