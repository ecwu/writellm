import { z } from 'zod'
import { modelExecutionMetadataSchema } from './model-runtime'
import { projectSessionIdSchema } from './projects'
import { providerConfigSchema } from './providers'

export const AGENT_EVENT_SCHEMA_VERSION = 1
export const AGENT_RUNTIME_VERSION = '0.80.10'

export const agentSessionIdSchema = z.uuid()
export const agentRunIdSchema = z.uuid()
export const agentEventIdSchema = z.uuid()
export const agentModelRequestIdSchema = z.uuid()

export const agentEditorContextSchema = z
  .object({
    activeSectionId: z.uuid().nullable(),
    activeBlockId: z.string().min(1).max(256).nullable(),
    selectedBlockIds: z.array(z.string().min(1).max(256)).max(256)
  })
  .strict()

export const agentUserMessagePayloadSchema = z
  .object({
    content: z.string().min(1).max(262_144),
    delivery: z.enum(['prompt', 'steer', 'follow_up']),
    timestamp: z.number().int().nonnegative()
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

export const agentRunStartSchema = z
  .object({
    operation: z.literal('run_start'),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    agentSessionId: agentSessionIdSchema,
    agentRunId: agentRunIdSchema,
    modelRequestId: agentModelRequestIdSchema,
    config: providerConfigSchema.refine((config) => config.role === 'agent'),
    credential: z.string().min(1).max(16_384),
    systemPrompt: z.string().max(65_536),
    history: agentHistorySchema,
    prompt: z.string().min(1).max(262_144),
    maxOutputTokens: z.number().int().min(1).max(131_072).default(8_192),
    temperature: z.number().min(0).max(2).optional()
  })
  .strict()

export const agentQueueCommandSchema = z
  .object({
    operation: z.enum(['steer', 'follow_up']),
    requestId: z.uuid(),
    projectSessionId: projectSessionIdSchema,
    agentSessionId: agentSessionIdSchema,
    agentRunId: agentRunIdSchema,
    modelRequestId: agentModelRequestIdSchema,
    content: z.string().min(1).max(262_144),
    timestamp: z.number().int().nonnegative()
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
    modelRequestId: agentModelRequestIdSchema
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
      type: z.literal('model_call_finished'),
      modelRequestId: agentModelRequestIdSchema,
      outcome: z.enum(['succeeded', 'failed', 'aborted', 'timed_out']),
      metadata: modelExecutionMetadataSchema,
      httpStatus: z.number().int().min(100).max(599).optional()
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
      type: z.literal('model_call_requested'),
      continuationId: z.uuid(),
      reason: z.literal('tool_continuation')
    })
    .strict()
])

const agentRuntimeDiagnosticErrorSchema = z
  .object({
    name: z.string().max(200),
    message: z.string().max(4_096),
    stack: z.string().max(32_768).optional(),
    httpStatus: z.number().int().min(100).max(599).optional()
  })
  .strict()

const agentRuntimeEnvelopeSchema = z.object({
  requestId: z.uuid(),
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema
})

export const agentRuntimeMessageSchema = z.discriminatedUnion('type', [
  agentRuntimeEnvelopeSchema
    .extend({ type: z.literal('event'), event: agentRuntimeEventSchema })
    .strict(),
  agentRuntimeEnvelopeSchema
    .extend({ type: z.literal('result'), status: z.literal('completed') })
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
  'run_interrupted',
  'run_completed',
  'compaction_summary'
])
export const agentCompactionSummaryPayloadSchema = z
  .object({
    summary: z.string().min(1).max(32_768),
    coveredThroughSequence: z.number().int().positive(),
    estimatedInputTokens: z.number().int().positive(),
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
export type AgentHistoryMessage = z.infer<typeof agentHistoryMessageSchema>
export type AgentRunStart = z.infer<typeof agentRunStartSchema>
export type AgentQueueCommand = z.infer<typeof agentQueueCommandSchema>
export type AgentRuntimeCancel = z.infer<typeof agentRuntimeCancelSchema>
export type AgentModelCallAuthorization = z.infer<typeof agentModelCallAuthorizationSchema>
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>
export type AgentRuntimeMessage = z.infer<typeof agentRuntimeMessageSchema>
export type AgentAssistantMessagePayload = z.infer<typeof agentAssistantMessagePayloadSchema>
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>
export type AgentEventType = z.infer<typeof agentEventTypeSchema>
export type AgentCompactionSummaryPayload = z.infer<typeof agentCompactionSummaryPayloadSchema>
export type MutationProposalStatus = z.infer<typeof mutationProposalStatusSchema>
