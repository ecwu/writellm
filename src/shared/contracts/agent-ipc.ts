import { z } from 'zod'
import { agentDiagnosticErrorSchema } from '../agent-diagnostic-error'
import {
  AGENT_PENDING_MESSAGE_LIMIT,
  AGENT_PENDING_MESSAGE_MAX_BYTES,
  agentApprovalModeSchema,
  agentInteractionModeSchema,
  agentEditorContextSchema,
  agentEventIdSchema,
  agentEventTypeSchema,
  agentRunIdSchema,
  agentRunStatusSchema,
  agentPendingMessageIdSchema,
  agentSessionIdSchema,
  agentSessionStatusSchema
} from './agent'
import { agentModelLimitsSchema } from './agent'
import { mutationProposalRecordSchema } from './agent-mutations'
import { modelUsageSchema } from './model-runtime'
import { projectSessionIdSchema } from './projects'
import { agentModelSelectionSchema, agentThinkingLevelSchema, piApiSchema } from './providers'
import { skillRunSnapshotSchema } from './skills'
import { agentQuickActionRequestSchema } from './agent-quick-actions'
import { writingTaskIdSchema, writingTaskStepIdSchema, writingTaskViewSchema } from './writing-task'
import { askUserAnswersSchema, askUserQuestionSchema } from './agent-tools'

export const AGENT_EVENT_PAGE_LIMIT = 50
export const AGENT_EVENT_PAGE_MAX_BYTES = 4 * 1024 * 1024
export const AGENT_SESSION_LIMIT = 200
export const AGENT_RUN_LIMIT = 200
export const AGENT_LIVE_PARTIAL_MAX_BYTES = 2 * 1024 * 1024

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const agentSessionWorkflowStateSchema = z.enum([
  'idle',
  'running',
  'awaiting_input',
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
  interactionMode: agentInteractionModeSchema.default('write'),
  workflowState: agentSessionWorkflowStateSchema.default('idle'),
  modelSelection: agentModelSelectionSchema.nullable().default(null),
  thinkingLevel: agentThinkingLevelSchema.default('off'),
  writingTask: writingTaskViewSchema.nullable().optional(),
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
  interactionMode: agentInteractionModeSchema.default('write'),
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
    schemaVersion: 4,
    mode: 'none',
    routingStatus: 'legacy',
    requestedSkills: [],
    skills: [],
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
  errorDetails: agentDiagnosticErrorSchema.nullable().default(null),
  writingTaskId: writingTaskIdSchema.nullable().default(null),
  writingTaskStepId: writingTaskStepIdSchema.nullable().default(null),
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
export const agentSetInteractionModeInputSchema = agentSessionInputSchema.extend({
  mode: agentInteractionModeSchema
})
export const agentSetInteractionModeResultSchema = agentSessionRecordSchema
export const agentSetModelSelectionInputSchema = agentSessionInputSchema.extend({
  selection: agentModelSelectionSchema
})
export const agentSetModelSelectionResultSchema = agentSessionRecordSchema
export const agentSetThinkingLevelInputSchema = agentSessionInputSchema.extend({
  level: agentThinkingLevelSchema
})
export const agentSetThinkingLevelResultSchema = agentSessionRecordSchema
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
  prompt: z.string().trim().min(1).max(262_144).optional(),
  quickAction: agentQuickActionRequestSchema.optional(),
  resumeWritingTask: z.literal(true).optional(),
  approvedProposalId: z.uuid().optional(),
  rejectedProposalId: z.uuid().optional(),
  reuseSkillFromRunId: agentRunIdSchema.optional(),
  scope: agentStartScopeSchema,
  editorContext: agentEditorContextSchema
}).superRefine((input, context) => {
  const requestKinds = [input.prompt, input.quickAction, input.resumeWritingTask].filter(
    (value) => value !== undefined
  ).length
  const expectedRequestKinds = input.approvedProposalId === undefined ? 1 : 0
  if (requestKinds !== expectedRequestKinds) {
    context.addIssue({
      code: 'custom',
      path: ['prompt'],
      message:
        input.approvedProposalId === undefined
          ? 'Exactly one prompt, quick action, or writing-task resume is required'
          : 'Approved proposal continuation is authored by Main and accepts no Renderer prompt'
    })
  }
  if (input.quickAction !== undefined) {
    if (input.scope !== 'selection') {
      context.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'Quick actions require selection scope'
      })
    }
    if (
      input.editorContext.selectedText === undefined ||
      input.editorContext.selectedText === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['editorContext', 'selectedText'],
        message: 'Quick actions require exact selected text'
      })
    }
    if (
      input.approvedProposalId !== undefined ||
      input.rejectedProposalId !== undefined ||
      input.reuseSkillFromRunId !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['quickAction'],
        message: 'Quick actions cannot be proposal continuations'
      })
    }
  }
  if (
    input.resumeWritingTask === true &&
    (input.approvedProposalId !== undefined ||
      input.rejectedProposalId !== undefined ||
      input.reuseSkillFromRunId !== undefined)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['resumeWritingTask'],
      message: 'Writing-task resume cannot be a proposal continuation'
    })
  }
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
      input.editorContext.selectedBlockIds.length > 0 ||
      (input.editorContext.selectedText !== undefined && input.editorContext.selectedText !== null)
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
  if (
    input.scope !== 'selection' &&
    input.editorContext.selectedText !== undefined &&
    input.editorContext.selectedText !== null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['editorContext', 'selectedText'],
      message: 'Only selection scope may include selected text'
    })
  }
})
export const agentStartRunResultSchema = strictObject({ run: agentRunRecordSchema })

export const agentRunInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentRunId: agentRunIdSchema
})
export const agentAnswerUserQuestionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  toolCallId: z.string().min(1).max(256),
  answers: askUserAnswersSchema
})
export const agentAnswerUserQuestionResultSchema = strictObject({})
export const agentQueueInputSchema = agentRunInputSchema.extend({
  content: z.string().trim().min(1).max(262_144)
})
export const agentPendingMessageActionInputSchema = agentRunInputSchema.extend({
  pendingMessageId: agentPendingMessageIdSchema
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

export const agentPendingMessageSchema = strictObject({
  pendingMessageId: agentPendingMessageIdSchema,
  content: z.string().min(1).max(262_144),
  queuedAt: z.iso.datetime()
})

export const agentPendingMessagesSchema = z
  .array(agentPendingMessageSchema)
  .max(AGENT_PENDING_MESSAGE_LIMIT)
  .superRefine((messages, context) => {
    if (new Set(messages.map((message) => message.pendingMessageId)).size !== messages.length) {
      context.addIssue({ code: 'custom', message: 'Pending Agent message IDs must be unique' })
    }
    const bytes = messages.reduce(
      (total, message) => total + new TextEncoder().encode(message.content).byteLength,
      0
    )
    if (bytes > AGENT_PENDING_MESSAGE_MAX_BYTES) {
      context.addIssue({ code: 'custom', message: 'Pending Agent messages exceed 1 MiB' })
    }
  })

export const agentPendingQuestionSchema = strictObject({
  toolCallId: z.string().min(1).max(256),
  questions: z.array(askUserQuestionSchema).min(1).max(3),
  submitting: z.boolean(),
  startedAt: z.iso.datetime()
})

export const agentLiveRunSnapshotSchema = strictObject({
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  phase: z.enum(['routing', 'compacting', 'running', 'awaiting_input']),
  partialText: z.string(),
  pendingMessages: agentPendingMessagesSchema.default([]),
  pendingQuestion: agentPendingQuestionSchema.nullable().default(null),
  startedAt: z.iso.datetime()
}).superRefine((snapshot, context) => {
  if (new TextEncoder().encode(snapshot.partialText).byteLength > AGENT_LIVE_PARTIAL_MAX_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['partialText'],
      message: 'Live Agent output is too large'
    })
  }
  if ((snapshot.phase === 'awaiting_input') !== (snapshot.pendingQuestion !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['pendingQuestion'],
      message: 'Awaiting-input activity must carry exactly one pending question'
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
  activeCount: z.number().int().nonnegative(),
  runs: z.array(agentLiveRunSnapshotSchema),
  compactions: z.array(agentLiveCompactionSnapshotSchema).default([])
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
export type AgentPendingMessage = z.infer<typeof agentPendingMessageSchema>
export type AgentPendingQuestion = z.infer<typeof agentPendingQuestionSchema>
export type AgentLiveCompactionSnapshot = z.infer<typeof agentLiveCompactionSnapshotSchema>
export type AgentProjectActivitySnapshot = z.infer<typeof agentProjectActivitySnapshotSchema>
