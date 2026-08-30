import { ZodError } from 'zod'
import {
  AGENT_TOOL_RESULT_SCHEMA_VERSION,
  agentToolResponseSchema,
  type AskUserResult,
  type AgentToolRequest,
  type AgentToolResponse
} from '../../shared/contracts/agent-tools'
import {
  submitChangeResultSchema,
  type MutationProposalOutcome
} from '../../shared/contracts/agent-mutations'
import { SkillReadError } from '../skills/skill-router'
import { AgentToolDomainError } from './read-tools'

export type AgentRunTermination =
  | {
      status: 'failed'
      code:
        | 'provider_timeout'
        | 'provider_retries_exhausted'
        | 'context_overflow'
        | 'context_overflow_after_activity'
        | 'compaction_required'
        | 'compaction_run_too_large'
        | 'continuation_lost'
        | 'tool_batch_context_exhausted'
        | 'skill_request_unfulfilled'
        | 'run_failed'
    }
  | { status: 'interrupted'; code: 'user_stopped' | 'project_closed' | 'run_interrupted' }

export class AgentRunCancellationError extends Error {
  constructor(
    readonly code: 'user_stopped' | 'project_closed',
    message: string
  ) {
    super(message)
    this.name = 'AgentRunCancellationError'
  }
}

export class AgentRunSetupError extends Error {
  constructor(
    readonly code: string,
    cause: unknown
  ) {
    super(code, { cause })
    this.name = 'AgentRunSetupError'
  }
}

export class AgentRunContextOverflowError extends Error {
  constructor(
    readonly code: 'context_overflow' | 'context_overflow_after_activity',
    cause: unknown
  ) {
    super(code, { cause })
    this.name = 'AgentRunContextOverflowError'
  }
}

export class AgentSkillPreparationError extends Error {
  constructor(
    readonly code: 'skill_request_unfulfilled',
    message: string
  ) {
    super(message)
    this.name = 'AgentSkillPreparationError'
  }
}

export class AgentCompactionRequiredError extends Error {
  readonly code: 'compaction_required' | 'compaction_run_too_large'

  constructor(cause: unknown) {
    super('Conversation history could not be compacted without losing user requirements', { cause })
    this.name = 'AgentCompactionRequiredError'
    this.code = hasErrorCode(cause, 'compaction_run_too_large')
      ? 'compaction_run_too_large'
      : 'compaction_required'
  }
}

export class AgentRunContinuationLostError extends Error {
  readonly code = 'continuation_lost'

  constructor(cause: unknown) {
    super('Agent tool continuation could not be resumed safely', { cause })
    this.name = 'AgentRunContinuationLostError'
  }
}

export function classifyRunFailure(error: unknown, signal: AbortSignal): AgentRunTermination {
  if (signal.aborted && signal.reason instanceof AgentRunCancellationError) {
    return { status: 'interrupted', code: signal.reason.code }
  }
  if (error instanceof Error && error.name === 'ProviderTimeoutError') {
    return { status: 'failed', code: 'provider_timeout' }
  }
  if (error instanceof Error && error.name === 'ProviderRetriesExhaustedError') {
    return { status: 'failed', code: 'provider_retries_exhausted' }
  }
  if (error instanceof AgentRunContextOverflowError) {
    return { status: 'failed', code: error.code }
  }
  if (error instanceof AgentCompactionRequiredError) {
    return { status: 'failed', code: error.code }
  }
  if (error instanceof AgentRunContinuationLostError || hasErrorCode(error, 'continuation_lost')) {
    return { status: 'failed', code: 'continuation_lost' }
  }
  if (error instanceof AgentSkillPreparationError) {
    return { status: 'failed', code: error.code }
  }
  if (hasErrorCode(error, 'skill_request_unfulfilled')) {
    return { status: 'failed', code: 'skill_request_unfulfilled' }
  }
  if (hasErrorCode(error, 'tool_batch_context_exhausted')) {
    return { status: 'failed', code: 'tool_batch_context_exhausted' }
  }
  if (signal.aborted) return { status: 'interrupted', code: 'run_interrupted' }
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      /exited before responding|terminated|project is closing|worker.*closed/i.test(error.message))
  ) {
    return { status: 'interrupted', code: 'run_interrupted' }
  }
  return { status: 'failed', code: 'run_failed' }
}

export function hasErrorCode(error: unknown, expected: string, depth = 0): boolean {
  if (depth > 6 || error === null || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; cause?: unknown }
  return candidate.code === expected || hasErrorCode(candidate.cause, expected, depth + 1)
}

export function compactionFailurePayload(
  error: unknown,
  aborted: boolean
): { code: string; retryable: boolean } {
  if (aborted) return { code: 'aborted', retryable: false }
  if (hasErrorCode(error, 'compaction_run_too_large')) {
    return { code: 'compaction_run_too_large', retryable: false }
  }
  return { code: 'compaction_failed', retryable: true }
}

export function isContextOverflowError(error: unknown, depth = 0): boolean {
  if (depth > 6 || error === null || typeof error !== 'object') return false
  const candidate = error as {
    name?: unknown
    message?: unknown
    code?: unknown
    status?: unknown
    statusCode?: unknown
    cause?: unknown
  }
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : ''
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  const status = candidate.statusCode ?? candidate.status
  if (
    code.includes('context_length') ||
    code.includes('context_window') ||
    /context (?:length|window).*(?:exceed|overflow|too long)|maximum context|too many tokens/u.test(
      message
    ) ||
    (status === 400 && /context|token limit/u.test(message))
  ) {
    return true
  }
  return isContextOverflowError(candidate.cause, depth + 1)
}

export function toolResponseCapability(request: AgentToolRequest) {
  return {
    type: 'tool_response' as const,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName
  }
}

export function toolErrorResponse(
  request: AgentToolRequest,
  code: Extract<AgentToolResponse, { ok: false }>['error']['code'],
  message: string,
  retryable: boolean,
  recoveryUri?: string
): AgentToolResponse {
  return agentToolResponseSchema.parse({
    ...toolResponseCapability(request),
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    ok: false,
    error: structuredToolError(code, message, retryable, request.toolName, recoveryUri)
  })
}

export function clarificationHistoryMessage(result: AskUserResult): string {
  return `The user supplied these clarification answers. Treat them as user decisions for the requested task:\n${JSON.stringify(result.answers)}`
}

export function safeToolError(
  err: unknown,
  toolName: AgentToolRequest['toolName'],
  signal: AbortSignal,
  deadlineSignal: AbortSignal | null
): {
  code: Extract<AgentToolResponse, { ok: false }>['error']['code']
  message: string
  retryable: boolean
  recoveryUri?: string
} {
  if (deadlineSignal?.aborted && !signal.aborted) {
    return { code: 'deadline_exceeded', message: 'Agent tool deadline exceeded', retryable: true }
  }
  if (signal.aborted) {
    return { code: 'aborted', message: 'Agent tool request was aborted', retryable: true }
  }
  if (err instanceof AgentToolDomainError) {
    return { code: err.code, message: err.message.slice(0, 1_000), retryable: err.retryable }
  }
  if (err instanceof SkillReadError) {
    return {
      code: err.code,
      message: err.message.slice(0, 1_000),
      retryable: false,
      ...(err.recoveryUri === undefined ? {} : { recoveryUri: err.recoveryUri })
    }
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0]
    const path = issue?.path.length ? ` at /${issue.path.join('/')}` : ''
    return {
      code: 'invalid_arguments',
      message:
        `Invalid arguments for ${toolName}${path}: ${issue?.message ?? 'the input shape is invalid'}`.slice(
          0,
          1_000
        ),
      retryable: false
    }
  }
  if (toolName === 'generate_image') {
    const httpStatus = findToolErrorHttpStatus(err)
    const providerCode = findToolErrorProviderCode(err)
    const suffix = [
      httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
      providerCode
    ].filter((value): value is string => value !== undefined)
    const detail = suffix.length === 0 ? '' : ` (${suffix.join(' / ')})`
    const retryable =
      httpStatus === 408 || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)
    return {
      code: 'unavailable',
      message: retryable
        ? `Image provider is temporarily unavailable${detail}`
        : `Image provider rejected the generation request${detail}; verify the image API key, model access, and provider settings`,
      retryable
    }
  }
  return { code: 'internal', message: 'Agent tool failed', retryable: false }
}

export function findToolErrorHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 6 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; cause?: unknown }
  const status = candidate.statusCode ?? candidate.status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    return status
  }
  return findToolErrorHttpStatus(candidate.cause, depth + 1)
}

export function findToolErrorProviderCode(error: unknown, depth = 0): string | undefined {
  if (depth > 6 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { providerCode?: unknown; cause?: unknown }
  if (
    typeof candidate.providerCode === 'string' &&
    /^[A-Z][A-Z0-9_]{1,127}$/.test(candidate.providerCode)
  ) {
    return candidate.providerCode
  }
  return findToolErrorProviderCode(candidate.cause, depth + 1)
}

export function structuredToolError(
  code: Extract<AgentToolResponse, { ok: false }>['error']['code'],
  message: string,
  retryable: boolean,
  toolName: AgentToolRequest['toolName'],
  recoveryUri?: string
): Extract<AgentToolResponse, { ok: false }>['error'] {
  const refreshTool = recoveryToolFor(toolName)
  switch (code) {
    case 'invalid_arguments':
      if (/citation|source label/iu.test(message)) {
        return {
          code,
          category: 'validation',
          message: actionableToolErrorMessage(
            message,
            'Call search_knowledge, then read_citations, copy the returned provenance, and retry once.'
          ),
          recovery: { action: 'refresh_context', tool: 'search_knowledge', maxAttempts: 1 }
        }
      }
      return {
        code,
        category: 'validation',
        message: actionableToolErrorMessage(message, 'Fix the named fields and retry once.'),
        recovery: { action: 'fix_arguments', maxAttempts: 1 }
      }
    case 'unauthorized':
      if (toolName === 'read_writing_skill' && recoveryUri !== undefined) {
        return {
          code,
          category: 'authorization',
          message: actionableToolErrorMessage(
            message,
            `Call read_writing_skill with recovery.uri and retry once.`
          ),
          recovery: {
            action: 'refresh_context',
            tool: 'read_writing_skill',
            maxAttempts: 1,
            uri: recoveryUri
          }
        }
      }
      return {
        code,
        category: 'authorization',
        message: actionableToolErrorMessage(message, 'Do not retry this operation.'),
        recovery: { action: 'do_not_retry' }
      }
    case 'not_found':
    case 'conflict':
      return {
        code,
        category: code === 'conflict' ? 'conflict' : 'precondition',
        message: actionableToolErrorMessage(
          message,
          `Call ${refreshTool}, copy the refreshed values, and retry once.`
        ),
        recovery: {
          action: 'refresh_context',
          tool: refreshTool,
          maxAttempts: 1,
          ...(recoveryUri === undefined ? {} : { uri: recoveryUri })
        }
      }
    case 'stale_cursor':
      return {
        code,
        category: 'conflict',
        message: actionableToolErrorMessage(
          message,
          `Call ${toolName} without a cursor and restart once.`
        ),
        recovery: { action: 'restart_pagination', tool: toolName, maxAttempts: 1 }
      }
    case 'result_too_large':
      return {
        code,
        category: 'precondition',
        message: actionableToolErrorMessage(message, 'Reduce the requested page or result size.'),
        recovery: { action: 'reduce_scope' }
      }
    case 'deadline_exceeded':
      return {
        code,
        category: 'transient',
        message: actionableToolErrorMessage(message, 'Retry this operation once.'),
        recovery: { action: 'retry', maxAttempts: 1 }
      }
    case 'aborted':
      return {
        code,
        category: 'cancelled',
        message: actionableToolErrorMessage(message, 'Do not retry automatically.'),
        recovery: { action: 'do_not_retry' }
      }
    case 'unavailable':
      return {
        code,
        category: 'transient',
        message: actionableToolErrorMessage(
          message,
          retryable ? 'Retry this operation once.' : 'Ask the user to verify provider access.'
        ),
        recovery: {
          action: retryable ? 'retry' : 'ask_user',
          maxAttempts: retryable ? 1 : undefined
        }
      }
    case 'internal':
      return {
        code,
        category: 'internal',
        message: actionableToolErrorMessage(
          message,
          'Do not retry automatically; report the failure.'
        ),
        recovery: { action: 'do_not_retry' }
      }
  }
}

export function recoveryToolFor(
  toolName: AgentToolRequest['toolName']
): AgentToolRequest['toolName'] {
  if (toolName === 'submit_section_change' || toolName === 'generate_image') return 'read_section'
  if (toolName === 'submit_outline_change') return 'read_outline'
  if (toolName === 'record_review_issues' || toolName === 'update_review_issues') {
    return 'list_review_issues'
  }
  if (toolName === 'create_writing_task' || toolName === 'update_writing_task') {
    return 'get_writing_task'
  }
  if (toolName === 'read_writing_skill') return 'read_writing_skill'
  if (toolName === 'read_citations') return 'search_knowledge'
  return toolName
}

export function actionableToolErrorMessage(message: string, next: string): string {
  const trimmed = message.trim().replace(/[.\s]+$/u, '')
  return `${trimmed}. Next: ${next}`.slice(0, 1_000)
}

export function submitResultFromOutcome(
  outcome: MutationProposalOutcome,
  proposal?: {
    appliedBriefVersion: number | null
    appliedOutlineVersion: number | null
    appliedRevisionId: string | null
  },
  idMapping?: {
    createdSectionRefs?: Record<string, string>
    createdBlockRefs?: Record<string, string>
  }
) {
  const status =
    outcome.outcome === 'applied'
      ? 'applied'
      : outcome.outcome === 'already_satisfied'
        ? 'satisfied'
        : outcome.outcome === 'rejected'
          ? 'rejected'
          : 'conflicted'
  const applicationStatus =
    outcome.outcome === 'applied'
      ? 'applied'
      : outcome.outcome === 'already_satisfied'
        ? 'no_change'
        : outcome.outcome === 'conflict'
          ? 'conflict'
          : 'not_applied'
  return submitChangeResultSchema.parse({
    proposal: {
      proposalId: outcome.effectiveProposalId,
      kind: outcome.kind,
      status
    },
    application: {
      status: applicationStatus,
      ...(proposal?.appliedBriefVersion === null || proposal?.appliedBriefVersion === undefined
        ? {}
        : { resultingBriefVersion: proposal.appliedBriefVersion }),
      ...(proposal?.appliedOutlineVersion === null || proposal?.appliedOutlineVersion === undefined
        ? {}
        : { resultingOutlineVersion: proposal.appliedOutlineVersion }),
      ...(proposal?.appliedRevisionId === null || proposal?.appliedRevisionId === undefined
        ? {}
        : { resultingRevisionId: proposal.appliedRevisionId }),
      ...(idMapping?.createdSectionRefs === undefined
        ? {}
        : { createdSectionRefs: idMapping.createdSectionRefs }),
      ...(idMapping?.createdBlockRefs === undefined
        ? {}
        : { createdBlockRefs: idMapping.createdBlockRefs })
    },
    continuation: 'continue',
    warnings:
      outcome.message === null
        ? []
        : [{ code: `proposal_${outcome.outcome}`, message: outcome.message }]
  })
}
