import { z } from 'zod'
import { modelExecutionMetadataSchema } from './model-runtime'
import { projectSessionIdSchema } from './projects'
import {
  agentThinkingLevelMapSchema,
  agentThinkingLevelSchema,
  piApiSchema,
  providerConfigSchema
} from './providers'
import { agentModelLimitsSchema, legacyAgentModelLimits } from './agent-model-limits'
import { agentRuntimeAuthSchema } from './agent-auth'
import { agentQuickActionIdSchema, agentQuickActionSelectedTextSchema } from './agent-quick-actions'
export { agentRuntimeAuthSchema, type AgentRuntimeAuth } from './agent-auth'

export const AGENT_EVENT_SCHEMA_VERSION = 3
export const AGENT_RUNTIME_VERSION = '0.80.10'

export const agentSessionIdSchema = z.uuid()
export const agentRunIdSchema = z.uuid()
export const agentEventIdSchema = z.uuid()
export const agentModelRequestIdSchema = z.uuid()
export const agentPendingMessageIdSchema = z.uuid()
export const agentQueueActionIdSchema = z.uuid()
export const agentTraceCaptureIdSchema = z.uuid()

export const agentTracePurposeSchema = z.enum([
  'agent_prompt',
  'agent_steer',
  'agent_follow_up',
  'tool_continuation',
  'session_title',
  'compaction',
  'agent_image'
])
export const agentTraceDocumentKindSchema = z.enum([
  'harness_request',
  'provider_request',
  'provider_response',
  'tool_attempt',
  'skill_content',
  'compaction_source'
])

export const AGENT_PENDING_MESSAGE_LIMIT = 20
export const AGENT_PENDING_MESSAGE_MAX_BYTES = 1024 * 1024
export const AGENT_RUN_PROMPT_MAX_CHARACTERS = 262_144

export const agentApprovalModeSchema = z.enum(['manual', 'section_auto', 'yolo'])
export const agentInteractionModeSchema = z.enum(['ask', 'plan', 'write'])
export type AgentInteractionMode = z.infer<typeof agentInteractionModeSchema>
export const agentToolProfileSchema = z.enum(['writing', 'notebook_knowledge'])
export type AgentToolProfile = z.infer<typeof agentToolProfileSchema>
export const writingToolGroupSchema = z.enum([
  'review',
  'writing_task',
  'brief',
  'writing_rules',
  'outline',
  'section',
  'image'
])
export type WritingToolGroup = z.infer<typeof writingToolGroupSchema>
export const activeWritingToolGroupsSchema = z
  .array(writingToolGroupSchema)
  .max(writingToolGroupSchema.options.length)
  .superRefine((groups, context) => {
    if (new Set(groups).size !== groups.length) {
      context.addIssue({ code: 'custom', message: 'Active writing tool groups must be unique' })
    }
  })

export const agentToolPreflightDiagnosticSchema = z
  .object({
    code: z.enum(['invalid_arguments', 'unknown_tool', 'preparation_failed']),
    message: z.string().min(1).max(1_000),
    paths: z.array(z.string().min(1).max(512)).max(16)
  })
  .strict()
export { agentModelLimitsSchema, type AgentModelLimits } from './agent-model-limits'

export const agentEditorContextSchema = z
  .object({
    activeSectionId: z.uuid().nullable(),
    activeBlockId: z.string().min(1).max(256).nullable(),
    selectedBlockIds: z.array(z.string().min(1).max(256)).max(256),
    selectedText: agentQuickActionSelectedTextSchema.nullable().optional(),
    capturedAt: z.number().int().nonnegative().optional(),
    capturedRevisionId: z.uuid().nullable().optional()
  })
  .strict()

export const agentUserMessagePayloadSchema = z
  .object({
    content: z.string().min(1).max(262_144),
    delivery: z.enum(['prompt', 'steer', 'follow_up', 'clarification']),
    timestamp: z.number().int().nonnegative(),
    presentation: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('approval_continuation') }).strict(),
        z
          .object({
            kind: z.literal('clarification_answer'),
            toolCallId: z.string().min(1).max(256)
          })
          .strict(),
        z
          .object({
            kind: z.literal('review_feedback'),
            displayContent: z.string().trim().min(1).max(4_096)
          })
          .strict(),
        z
          .object({
            kind: z.literal('quick_action'),
            action: agentQuickActionIdSchema,
            label: z.string().min(1).max(100),
            selectedText: agentQuickActionSelectedTextSchema,
            displayInstruction: z.string().trim().min(1).max(4_096).nullable()
          })
          .strict(),
        z
          .object({
            kind: z.literal('annotation_context'),
            displayContent: z.string().trim().min(1).max(262_144),
            annotationCount: z.number().int().min(1).max(10)
          })
          .strict()
      ])
      .optional()
  })
  .strict()

export const agentAssistantMessagePayloadSchema = z
  .object({
    content: z.string().max(2_097_152),
    stopReason: z.enum(['stop', 'length', 'toolUse', 'error', 'aborted']),
    provider: z.string().min(1).max(256),
    model: z.string().min(1).max(500),
    responseModel: z.string().min(1).max(500).optional(),
    responseId: z.string().min(1).max(500).optional(),
    metadata: modelExecutionMetadataSchema,
    timestamp: z.number().int().nonnegative(),
    interrupted: z.boolean()
  })
  .strict()

export const agentHistoryMessageSchema = z.discriminatedUnion('role', [
  z
    .object({
      role: z.literal('user'),
      content: z.string().min(1).max(262_144),
      timestamp: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({
      role: z.literal('assistant'),
      message: agentAssistantMessagePayloadSchema.omit({ interrupted: true })
    })
    .strict()
])

export const agentHistorySchema = z
  .array(agentHistoryMessageSchema)
  .max(200)
  .superRefine((messages, context) => {
    const bytes = new TextEncoder().encode(JSON.stringify(messages)).byteLength
    if (bytes > 2_097_152) {
      context.addIssue({ code: 'custom', message: 'Agent history exceeds the runtime bound' })
    }
  })

const boundedPiCompatSchema = z
  .record(z.string().min(1).max(100), z.json())
  .superRefine((compat, context) => {
    if (new TextEncoder().encode(JSON.stringify(compat)).byteLength > 16_384) {
      context.addIssue({
        code: 'custom',
        message: 'Agent runtime model compatibility data is too large'
      })
    }
  })

export const agentRuntimeModelSchema = z
  .object({
    id: z.string().min(1).max(500),
    name: z.string().min(1).max(500),
    api: piApiSchema,
    provider: z.string().min(1).max(200),
    baseUrl: z.url().max(2_048),
    reasoning: z.boolean(),
    thinkingLevelMap: agentThinkingLevelMapSchema.optional(),
    input: z
      .array(z.enum(['text', 'image']))
      .min(1)
      .max(2),
    contextWindow: z.number().int().positive().max(10_000_000),
    maxTokens: z.number().int().positive().max(10_000_000),
    compat: boundedPiCompatSchema.optional()
  })
  .strict()

export const agentRunStartSchema = z
  .object({
    operation: z.literal('run_start'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    agentSessionId: agentSessionIdSchema,
    agentRunId: agentRunIdSchema,
    modelRequestId: agentModelRequestIdSchema,
    config: providerConfigSchema.refine((config) => config.role === 'agent'),
    credential: agentRuntimeAuthSchema,
    systemPrompt: z.string().max(65_536),
    history: agentHistorySchema,
    prompt: z.string().min(1).max(AGENT_RUN_PROMPT_MAX_CHARACTERS),
    modelLimits: agentModelLimitsSchema.default(legacyAgentModelLimits),
    toolProfile: agentToolProfileSchema.default('writing'),
    interactionMode: agentInteractionModeSchema.default('write'),
    activeToolGroups: activeWritingToolGroupsSchema.default([]),
    runtimeMessageBudgetTokens: z.number().int().min(4_096).max(10_000_000).optional(),
    traceCapture: z.boolean().default(false),
    thinkingLevel: agentThinkingLevelSchema.default('off'),
    runtimeModel: agentRuntimeModelSchema.optional(),
    maxOutputTokens: z.number().int().min(1).max(131_072).default(8_192),
    temperature: z.number().min(0).max(2).optional()
  })
  .strict()

const agentQueueCommandBaseSchema = z.object({
  requestId: z.uuid(),
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  modelRequestId: agentModelRequestIdSchema,
  content: z.string().min(1).max(262_144),
  timestamp: z.number().int().nonnegative(),
  systemPrompt: z.string().min(1).max(65_536)
})

export const agentQueueCommandSchema = z.discriminatedUnion('operation', [
  agentQueueCommandBaseSchema.extend({ operation: z.literal('steer') }).strict(),
  agentQueueCommandBaseSchema
    .extend({
      operation: z.literal('follow_up'),
      pendingMessageId: agentPendingMessageIdSchema
    })
    .strict()
])

export const agentQueueActionCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.enum(['delete_follow_up', 'reserve_follow_up']),
      requestId: z.uuid(),
      projectSessionId: projectSessionIdSchema,
      agentSessionId: agentSessionIdSchema,
      agentRunId: agentRunIdSchema,
      actionId: agentQueueActionIdSchema,
      pendingMessageId: agentPendingMessageIdSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('commit_follow_up_steer'),
      requestId: z.uuid(),
      projectSessionId: projectSessionIdSchema,
      agentSessionId: agentSessionIdSchema,
      agentRunId: agentRunIdSchema,
      actionId: agentQueueActionIdSchema,
      reservationId: agentQueueActionIdSchema,
      modelRequestId: agentModelRequestIdSchema,
      systemPrompt: z.string().min(1).max(65_536)
    })
    .strict()
])

export const agentFollowUpConsumptionAuthorizationSchema = z
  .object({
    operation: z.literal('authorize_follow_up_consumption'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    agentSessionId: agentSessionIdSchema,
    agentRunId: agentRunIdSchema,
    consumptionId: z.uuid(),
    pendingMessageId: agentPendingMessageIdSchema,
    modelRequestId: agentModelRequestIdSchema
  })
  .strict()

export const agentRuntimeCancelSchema = z
  .object({
    operation: z.literal('cancel'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    agentSessionId: agentSessionIdSchema,
    agentRunId: agentRunIdSchema
  })
  .strict()

export const agentModelCallAuthorizationSchema = z
  .object({
    operation: z.literal('authorize_model_call'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    agentSessionId: agentSessionIdSchema,
    agentRunId: agentRunIdSchema,
    continuationId: z.uuid(),
    modelRequestId: agentModelRequestIdSchema,
    systemPrompt: z.string().min(1).max(65_536),
    interactionMode: agentInteractionModeSchema.default('write'),
    activeToolGroups: activeWritingToolGroupsSchema.optional(),
    runtimeMessageBudgetTokens: z.number().int().min(4_096).max(10_000_000).optional(),
    finalize: z.boolean().optional()
  })
  .strict()

export const agentTraceCaptureAckSchema = z
  .object({
    operation: z.literal('ack_trace_capture'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    agentSessionId: agentSessionIdSchema,
    agentRunId: agentRunIdSchema,
    captureId: agentTraceCaptureIdSchema,
    ok: z.boolean(),
    errorCode: z.string().min(1).max(100).optional()
  })
  .strict()

export const agentRuntimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assistant_delta'), delta: z.string().min(1).max(65_536) }).strict(),
  z
    .object({
      type: z.literal('assistant_message'),
      modelRequestId: agentModelRequestIdSchema,
      message: agentAssistantMessagePayloadSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('model_trace_capture_requested'),
      captureId: agentTraceCaptureIdSchema,
      modelRequestId: agentModelRequestIdSchema,
      purpose: agentTracePurposeSchema,
      apiId: piApiSchema,
      physicalAttempt: z.number().int().min(1).max(20),
      documents: z
        .array(
          z
            .object({
              kind: agentTraceDocumentKindSchema,
              value: z.json(),
              metadata: z.record(z.string(), z.json()).optional()
            })
            .strict()
        )
        .min(1)
        .max(3)
    })
    .strict(),
  z
    .object({
      type: z.literal('model_call_finished'),
      modelRequestId: agentModelRequestIdSchema,
      outcome: z.enum(['succeeded', 'failed', 'aborted', 'timed_out']),
      metadata: modelExecutionMetadataSchema,
      httpStatus: z.number().int().min(100).max(599).optional(),
      failureCode: z.enum(['provider_retries_exhausted', 'provider_request_failed']).optional(),
      retryable: z.boolean().optional(),
      physicalAttemptCount: z.number().int().min(1).max(20).optional(),
      ttftMs: z.number().int().nonnegative().max(86_400_000).optional(),
      totalDurationMs: z.number().int().nonnegative().max(86_400_000).optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('model_call_retrying'),
      modelRequestId: agentModelRequestIdSchema,
      completedAttempts: z.number().int().min(1).max(4),
      maxAttempts: z.literal(5),
      delayMs: z.number().int().min(0).max(60_000),
      reasonCode: z.enum(['network', 'rate_limited', 'server_error', 'stream_ended'])
    })
    .strict(),
  z
    .object({
      type: z.literal('queue_updated'),
      delivery: z.enum(['steer', 'follow_up']),
      modelRequestId: agentModelRequestIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('queue_action_completed'),
      actionId: agentQueueActionIdSchema,
      operation: z.enum(['delete_follow_up', 'reserve_follow_up', 'commit_follow_up_steer']),
      outcome: z.enum(['completed', 'stale'])
    })
    .strict(),
  z
    .object({
      type: z.literal('follow_up_consumption_requested'),
      consumptionId: z.uuid(),
      pendingMessageId: agentPendingMessageIdSchema,
      modelRequestId: agentModelRequestIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('model_call_requested'),
      continuationId: z.uuid(),
      reason: z.literal('tool_continuation')
    })
    .strict(),
  z
    .object({
      type: z.literal('tool_attempted'),
      modelRequestId: agentModelRequestIdSchema,
      toolCallId: z.string().min(1).max(256),
      requestedToolName: z.string().min(1).max(256),
      argsHash: z.string().regex(/^[a-f0-9]{64}$/u),
      argumentShape: z.string().min(1).max(4_096),
      timestamp: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({
      type: z.literal('tool_preflight_failed'),
      modelRequestId: agentModelRequestIdSchema,
      toolCallId: z.string().min(1).max(256),
      requestedToolName: z.string().min(1).max(256),
      phase: z.literal('pre_dispatch'),
      diagnostic: agentToolPreflightDiagnosticSchema.optional(),
      durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
      timestamp: z.number().int().nonnegative()
    })
    .strict()
])

const agentRuntimeDiagnosticErrorSchema = z
  .object({
    name: z.string().max(200),
    message: z.string().max(4_096),
    stack: z.string().max(32_768).optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    code: z
      .enum([
        'context_overflow',
        'tool_batch_context_exhausted',
        'continuation_lost',
        'trace_capture_failed',
        'trace_payload_too_large'
      ])
      .optional()
  })
  .strict()

const agentRuntimeEnvelopeSchema = z.object({
  requestId: z.uuid(),
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema
})

export const agentSessionRunOutcomeSchema = z.enum(['finished', 'awaiting_review'])
export const agentSessionRunResultSchema = z
  .object({
    outcome: agentSessionRunOutcomeSchema
  })
  .strict()

export const agentRuntimeMessageSchema = z.discriminatedUnion('type', [
  agentRuntimeEnvelopeSchema
    .extend({ type: z.literal('event'), event: agentRuntimeEventSchema })
    .strict(),
  agentRuntimeEnvelopeSchema
    .extend({
      type: z.literal('result'),
      status: z.literal('completed'),
      outcome: agentSessionRunOutcomeSchema.default('finished')
    })
    .strict(),
  agentRuntimeEnvelopeSchema
    .extend({ type: z.literal('error'), error: agentRuntimeDiagnosticErrorSchema })
    .strict()
])

export const agentSessionStatusSchema = z.enum(['active', 'archived'])
export const agentRunStatusSchema = z.enum(['running', 'completed', 'interrupted', 'failed'])
export const agentEventTypeSchema = z.enum([
  'user_message',
  'assistant_message',
  'tool_call',
  'tool_result',
  'tool_attempted',
  'tool_preflight_failed',
  'approval_decision',
  'run_interrupted',
  'run_completed',
  'compaction_started',
  'compaction_summary',
  'compaction_failed'
])
export const agentCompactionTriggerSchema = z.enum([
  'auto_threshold',
  'manual',
  'provider_overflow'
])
export const agentLegacyCompactionSummaryPayloadSchema = z
  .object({
    summary: z.string().min(1).max(32_768),
    coveredThroughSequence: z.number().int().positive(),
    estimatedInputTokens: z.number().int().positive(),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
export const agentCompactionCheckpointV2PayloadSchema = z
  .object({
    schemaVersion: z.literal(2),
    compactionId: z.uuid(),
    trigger: agentCompactionTriggerSchema,
    stepIndex: z.number().int().positive().max(8),
    finalStep: z.boolean(),
    previousCheckpointEventId: agentEventIdSchema.nullable(),
    coveredFromSequence: z.number().int().positive(),
    coveredThroughSequence: z.number().int().positive(),
    summary: z.string().min(1).max(32_768),
    proposalOutcomes: z.array(z.record(z.string(), z.unknown())).max(256),
    approvalDecisions: z.array(z.record(z.string(), z.unknown())).max(256),
    citationIds: z.array(z.string().regex(/^citation-[a-f0-9]{40}$/u)).max(1_000),
    toolOutcomes: z.array(z.record(z.string(), z.unknown())).max(512),
    estimatedTokensBefore: z.number().int().nonnegative(),
    estimatedTokensAfter: z.number().int().nonnegative(),
    checkpointTokens: z.number().int().nonnegative(),
    tailTokens: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
  .refine((value) => value.coveredFromSequence <= value.coveredThroughSequence, {
    message: 'Compaction checkpoint coverage is invalid'
  })
export const agentCompactionCheckpointPayloadSchema = z
  .object({
    schemaVersion: z.literal(3),
    handoffMode: z.literal('bounded_conversation_memory'),
    compactionId: z.uuid(),
    trigger: agentCompactionTriggerSchema,
    stepIndex: z.number().int().positive().max(8),
    finalStep: z.boolean(),
    previousCheckpointEventId: agentEventIdSchema.nullable(),
    coveredFromSequence: z.number().int().positive(),
    coveredThroughSequence: z.number().int().positive(),
    summary: z.string().min(1).max(32_768),
    proposalOutcomes: z.array(z.record(z.string(), z.unknown())).max(256),
    approvalDecisions: z.array(z.record(z.string(), z.unknown())).max(256),
    citationIds: z.array(z.string().regex(/^citation-[a-f0-9]{40}$/u)).max(1_000),
    toolOutcomes: z.array(z.record(z.string(), z.unknown())).max(512),
    estimatedTokensBefore: z.number().int().nonnegative(),
    estimatedTokensAfter: z.number().int().nonnegative(),
    checkpointTokens: z.number().int().nonnegative(),
    tailTokens: z.number().int().nonnegative(),
    postCompactionBudgetTokens: z.number().int().positive(),
    checkpointBudgetTokens: z.number().int().positive(),
    recentTailBudgetTokens: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
  .refine((value) => value.coveredFromSequence <= value.coveredThroughSequence, {
    message: 'Compaction checkpoint coverage is invalid'
  })
  .refine(
    (value) =>
      value.checkpointBudgetTokens + value.recentTailBudgetTokens ===
      value.postCompactionBudgetTokens,
    { message: 'Compaction checkpoint budgets are inconsistent' }
  )
export const agentCompactionSummaryPayloadSchema = z.union([
  agentLegacyCompactionSummaryPayloadSchema,
  agentCompactionCheckpointV2PayloadSchema,
  agentCompactionCheckpointPayloadSchema
])
export const agentCompactionStartedPayloadSchema = z
  .object({
    schemaVersion: z.literal(2),
    compactionId: z.uuid(),
    trigger: agentCompactionTriggerSchema,
    phase: z.enum(['planning', 'summarizing']),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
export const agentCompactionFailedPayloadSchema = z
  .object({
    schemaVersion: z.literal(2),
    compactionId: z.uuid(),
    trigger: agentCompactionTriggerSchema,
    code: z.string().min(1).max(200),
    retryable: z.boolean(),
    aborted: z.boolean(),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
export const agentApprovalDecisionPayloadSchema = z
  .object({
    schemaVersion: z.literal(2),
    proposalId: z.uuid(),
    decision: z.enum(['approved', 'rejected']),
    continueRequested: z.boolean(),
    actor: z.literal('user'),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
export const mutationProposalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'applied',
  'failed',
  'undone'
])

export type AgentEditorContext = z.infer<typeof agentEditorContextSchema>
export type AgentApprovalMode = z.infer<typeof agentApprovalModeSchema>
export type AgentHistoryMessage = z.infer<typeof agentHistoryMessageSchema>
export type AgentRuntimeModel = z.infer<typeof agentRuntimeModelSchema>
export type AgentRunStart = z.infer<typeof agentRunStartSchema>
export type AgentQueueCommand = z.infer<typeof agentQueueCommandSchema>
export type AgentQueueActionCommand = z.infer<typeof agentQueueActionCommandSchema>
export type AgentFollowUpConsumptionAuthorization = z.infer<
  typeof agentFollowUpConsumptionAuthorizationSchema
>
export type AgentRuntimeCancel = z.infer<typeof agentRuntimeCancelSchema>
export type AgentModelCallAuthorization = z.infer<typeof agentModelCallAuthorizationSchema>
export type AgentTraceCaptureAck = z.infer<typeof agentTraceCaptureAckSchema>
export type AgentTracePurpose = z.infer<typeof agentTracePurposeSchema>
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>
export type AgentRuntimeMessage = z.infer<typeof agentRuntimeMessageSchema>
export type AgentSessionRunResult = z.infer<typeof agentSessionRunResultSchema>
export type AgentAssistantMessagePayload = z.infer<typeof agentAssistantMessagePayloadSchema>
export type AgentUserMessagePayload = z.infer<typeof agentUserMessagePayloadSchema>
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>
export type AgentEventType = z.infer<typeof agentEventTypeSchema>
export type AgentCompactionSummaryPayload = z.infer<typeof agentCompactionSummaryPayloadSchema>
export type AgentCompactionCheckpointPayload = z.infer<
  typeof agentCompactionCheckpointPayloadSchema
>
export type AgentCompactionCheckpointV2Payload = z.infer<
  typeof agentCompactionCheckpointV2PayloadSchema
>
export type AgentCompactionStartedPayload = z.infer<typeof agentCompactionStartedPayloadSchema>
export type AgentCompactionFailedPayload = z.infer<typeof agentCompactionFailedPayloadSchema>
export type AgentCompactionTrigger = z.infer<typeof agentCompactionTriggerSchema>
export type AgentApprovalDecisionPayload = z.infer<typeof agentApprovalDecisionPayloadSchema>
export type MutationProposalStatus = z.infer<typeof mutationProposalStatusSchema>
