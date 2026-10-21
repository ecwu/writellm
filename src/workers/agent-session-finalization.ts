import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSessionRunResult } from '../shared/contracts/agent'
import { providerErrorDetails } from './agent-provider-errors'
import { AgentOutputLimitError } from './agent-provider-runtime'

export interface AgentSessionFinalizationInput {
  readonly maxOutputTokens: number
  readonly outputLimitError?: AgentOutputLimitError
  readonly runError?: unknown
  readonly lastAssistant?: AssistantMessage
  readonly lastAssistantRetriesExhausted: boolean
  readonly lastAssistantHttpStatus?: number
  readonly lastProviderError?: unknown
  readonly awaitingReview: boolean
}

export function finalizeAgentSessionResult(
  input: AgentSessionFinalizationInput
): AgentSessionRunResult {
  if (input.outputLimitError !== undefined) throw input.outputLimitError
  if (input.runError !== undefined) throw input.runError

  const lastAssistant = input.lastAssistant
  if (lastAssistant === undefined) throw new Error('Agent completed without an assistant response')
  if (lastAssistant.stopReason === 'length') throw new AgentOutputLimitError(input.maxOutputTokens)
  if (lastAssistant.stopReason === 'error') {
    const providerDetails = providerErrorDetails(lastAssistant, input.lastProviderError)
    const status = providerDetails.status ?? input.lastAssistantHttpStatus
    if (input.lastAssistantRetriesExhausted) {
      throw new AgentProviderRetriesExhaustedError(
        lastAssistant.errorMessage,
        status,
        providerDetails.cause,
        providerDetails.code
      )
    }
    const contextOverflow = isContextOverflowFailure(lastAssistant.errorMessage, status)
    const error: Error & { status?: number; code?: string } = new Error(
      lastAssistant.errorMessage ??
        (contextOverflow
          ? 'Agent provider context window exceeded'
          : 'Agent provider request failed'),
      providerDetails.cause === undefined ? undefined : { cause: providerDetails.cause }
    )
    if (status !== undefined) error.status = status
    if (contextOverflow) error.code = 'context_overflow'
    else if (providerDetails.code !== undefined) error.code = providerDetails.code
    throw error
  }
  if (lastAssistant.stopReason === 'aborted') {
    const error = new Error('Agent provider request aborted')
    error.name = 'AbortError'
    throw error
  }
  return { outcome: input.awaitingReview ? 'awaiting_review' : 'finished' }
}

export class AgentProviderRetriesExhaustedError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message?: string, status?: number, cause?: unknown, code?: string) {
    super(message ?? 'Agent provider request failed', cause === undefined ? undefined : { cause })
    this.name = 'ProviderRetriesExhaustedError'
    if (status !== undefined) this.status = status
    if (code !== undefined) this.code = code
  }
}

export function isContextOverflowFailure(
  message: string | undefined,
  status: number | undefined
): boolean {
  const normalized = message?.toLowerCase() ?? ''
  return (
    /context (?:length|window).*(?:exceed|overflow|too long)|maximum context|too many tokens/u.test(
      normalized
    ) ||
    (status === 400 && /context|token limit/u.test(normalized))
  )
}
