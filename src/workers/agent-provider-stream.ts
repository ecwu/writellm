import {
  createAssistantMessageEventStream,
  isRetryableAssistantError,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream
} from '@earendil-works/pi-ai'

export const AGENT_PROVIDER_MAX_ATTEMPTS = 5
export const AGENT_PROVIDER_MAX_RETRY_DELAY_MS = 30_000
export const AGENT_PROVIDER_MAX_RETRY_AFTER_MS = 60_000
const AGENT_PROVIDER_BASE_RETRY_DELAY_MS = 1_000

export type AgentProviderRetryReason = 'network' | 'rate_limited' | 'server_error' | 'stream_ended'

export interface AgentProviderRetryState {
  attemptCount: number
  retryCount: number
  exhausted: boolean
  retryableFailure: boolean
  lastReasonCode: AgentProviderRetryReason | null
  publishedContent: boolean
}

export interface RetryingAgentProviderStreamOptions {
  signal?: AbortSignal
  startAttempt(): AssistantMessageEventStream
  responseStatus(): number | undefined
  retryAfterMs(): number | undefined
  createErrorMessage(error: unknown, aborted: boolean): AssistantMessage
  onFirstAssistantContent?(input: { attempt: number }): void
  onRetry(input: {
    completedAttempts: number
    maxAttempts: number
    delayMs: number
    reasonCode: AgentProviderRetryReason
  }): void
}

export function createRetryingAgentProviderStream(options: RetryingAgentProviderStreamOptions): {
  stream: AssistantMessageEventStream
  state: AgentProviderRetryState
} {
  const stream = createAssistantMessageEventStream()
  const state: AgentProviderRetryState = {
    attemptCount: 0,
    retryCount: 0,
    exhausted: false,
    retryableFailure: false,
    lastReasonCode: null,
    publishedContent: false
  }

  void pumpAttempts(stream, state, options).catch((err: unknown) => {
    const aborted = options.signal?.aborted === true
    stream.push({
      type: 'error',
      reason: aborted ? 'aborted' : 'error',
      error: options.createErrorMessage(err, aborted)
    })
  })

  return { stream, state }
}

async function pumpAttempts(
  output: AssistantMessageEventStream,
  state: AgentProviderRetryState,
  options: RetryingAgentProviderStreamOptions
): Promise<void> {
  let firstAssistantContentObserved = false
  for (let attempt = 1; attempt <= AGENT_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    state.attemptCount = attempt
    assertNotAborted(options.signal)
    const buffered: AssistantMessageEvent[] = []
    let publishedContent = false
    let retry = false
    let attemptStream: AssistantMessageEventStream

    try {
      attemptStream = options.startAttempt()
    } catch (err) {
      const message = options.createErrorMessage(err, options.signal?.aborted === true)
      const decision = retryDecision(message, options.responseStatus())
      if (shouldRetry(decision.retryable, publishedContent, attempt)) {
        await scheduleRetry(state, options, attempt, decision.reasonCode)
        continue
      }
      finishFailure(output, state, message, decision, attempt)
      return
    }

    for await (const event of attemptStream) {
      const terminal =
        event.type === 'done' ? event.message : event.type === 'error' ? event.error : undefined
      if (terminal?.stopReason === 'pending' || terminal?.stopReason === 'deferred') {
        const error = Object.assign(
          new Error(`Provider returned unsupported terminal stop reason: ${terminal.stopReason}`),
          { code: 'unsupported_provider_stop_reason' }
        )
        const failure = options.createErrorMessage(error, options.signal?.aborted === true)
        flushBuffered(output, buffered)
        output.push({
          type: 'error',
          reason: failure.stopReason === 'aborted' ? 'aborted' : 'error',
          error: {
            ...terminal,
            stopReason: failure.stopReason,
            errorMessage: failure.errorMessage,
            deferred: undefined
          }
        })
        return
      }
      if (event.type === 'done') {
        flushBuffered(output, buffered)
        output.push(event)
        return
      }

      if (event.type === 'error') {
        if (!publishedContent && messageHasPublishedContent(event.error)) {
          if (!firstAssistantContentObserved) {
            firstAssistantContentObserved = true
            options.onFirstAssistantContent?.({ attempt })
          }
          flushBuffered(output, buffered)
          publishedContent = true
          state.publishedContent = true
        }
        const decision = retryDecision(event.error, options.responseStatus())
        if (shouldRetry(decision.retryable, publishedContent, attempt)) {
          retry = true
          await scheduleRetry(state, options, attempt, decision.reasonCode)
          break
        }
        state.retryableFailure = decision.retryable
        state.exhausted = decision.retryable && attempt === AGENT_PROVIDER_MAX_ATTEMPTS
        state.lastReasonCode = decision.reasonCode
        if (publishedContent) flushBuffered(output, buffered)
        output.push(event)
        return
      }

      buffered.push(event)
      if (!publishedContent && publishesAssistantContent(event)) {
        if (!firstAssistantContentObserved) {
          firstAssistantContentObserved = true
          options.onFirstAssistantContent?.({ attempt })
        }
        publishedContent = true
        state.publishedContent = true
        flushBuffered(output, buffered)
      } else if (publishedContent) {
        flushBuffered(output, buffered)
      }
    }

    if (retry) continue

    const message = options.createErrorMessage(
      new Error('Provider stream ended without a terminal event'),
      options.signal?.aborted === true
    )
    const decision = retryDecision(message, options.responseStatus())
    if (shouldRetry(decision.retryable, publishedContent, attempt)) {
      await scheduleRetry(state, options, attempt, 'stream_ended')
      continue
    }
    if (publishedContent) flushBuffered(output, buffered)
    finishFailure(output, state, message, decision, attempt)
    return
  }
}

async function scheduleRetry(
  state: AgentProviderRetryState,
  options: RetryingAgentProviderStreamOptions,
  completedAttempts: number,
  reasonCode: AgentProviderRetryReason
): Promise<void> {
  state.retryCount = completedAttempts
  state.lastReasonCode = reasonCode
  const delayMs = retryDelayMs(completedAttempts, options.retryAfterMs())
  options.onRetry({
    completedAttempts,
    maxAttempts: AGENT_PROVIDER_MAX_ATTEMPTS,
    delayMs,
    reasonCode
  })
  await abortableDelay(delayMs, options.signal)
}

function finishFailure(
  output: AssistantMessageEventStream,
  state: AgentProviderRetryState,
  message: AssistantMessage,
  decision: { retryable: boolean; reasonCode: AgentProviderRetryReason },
  attempt: number
): void {
  state.retryableFailure = decision.retryable
  state.exhausted = decision.retryable && attempt === AGENT_PROVIDER_MAX_ATTEMPTS
  state.lastReasonCode = decision.reasonCode
  output.push({
    type: 'error',
    reason: message.stopReason === 'aborted' ? 'aborted' : 'error',
    error: message
  })
}

function shouldRetry(retryable: boolean, publishedContent: boolean, attempt: number): boolean {
  return retryable && !publishedContent && attempt < AGENT_PROVIDER_MAX_ATTEMPTS
}

function retryDecision(
  message: AssistantMessage,
  httpStatus: number | undefined
): { retryable: boolean; reasonCode: AgentProviderRetryReason } {
  const errorMessage = message.errorMessage ?? ''
  if (message.stopReason === 'aborted' || permanentProviderError(errorMessage, httpStatus)) {
    return { retryable: false, reasonCode: 'network' }
  }
  if (httpStatus === 429) {
    return { retryable: true, reasonCode: 'rate_limited' }
  }
  if (
    httpStatus === 408 ||
    httpStatus === 409 ||
    httpStatus === 425 ||
    (httpStatus !== undefined && httpStatus >= 500)
  ) {
    return { retryable: true, reasonCode: httpStatus >= 500 ? 'server_error' : 'network' }
  }
  if (isRetryableAssistantError(message)) {
    return {
      retryable: true,
      reasonCode: /rate.?limit|too many requests|429/iu.test(errorMessage)
        ? 'rate_limited'
        : /500|502|503|504|524|server|service.?unavailable|overloaded/iu.test(errorMessage)
          ? 'server_error'
          : /ended without|stream ended|terminated/iu.test(errorMessage)
            ? 'stream_ended'
            : 'network'
    }
  }
  return { retryable: false, reasonCode: 'network' }
}

function permanentProviderError(errorMessage: string, httpStatus: number | undefined): boolean {
  if (
    httpStatus === 400 ||
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 404 ||
    httpStatus === 413 ||
    httpStatus === 422
  ) {
    return true
  }
  return /insufficient_quota|quota exceeded|usage limit|out of budget|billing|context.{0,20}(length|window)|content.{0,20}(policy|filter)|invalid.{0,20}(request|model)|model.{0,20}(not found|access)|unauthori[sz]ed|forbidden/iu.test(
    errorMessage
  )
}

function retryDelayMs(completedAttempts: number, retryAfterMs: number | undefined): number {
  if (retryAfterMs !== undefined) {
    return Math.min(Math.max(0, retryAfterMs), AGENT_PROVIDER_MAX_RETRY_AFTER_MS)
  }
  return Math.min(
    AGENT_PROVIDER_BASE_RETRY_DELAY_MS * 2 ** Math.max(0, completedAttempts - 1),
    AGENT_PROVIDER_MAX_RETRY_DELAY_MS
  )
}

export function parseRetryAfterMs(
  headers: Readonly<Record<string, string>>,
  nowMs = Date.now()
): number | undefined {
  const retryAfterMs = headerValue(headers, 'retry-after-ms')
  if (retryAfterMs !== undefined && /^\d+(?:\.\d+)?$/u.test(retryAfterMs.trim())) {
    return Math.max(0, Math.round(Number(retryAfterMs)))
  }
  const retryAfter = headerValue(headers, 'retry-after')
  if (retryAfter === undefined) return undefined
  if (/^\d+(?:\.\d+)?$/u.test(retryAfter.trim())) {
    return Math.max(0, Math.round(Number(retryAfter) * 1_000))
  }
  const dateMs = Date.parse(retryAfter)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  return entry?.[1]
}

function publishesAssistantContent(event: AssistantMessageEvent): boolean {
  switch (event.type) {
    case 'text_delta':
    case 'thinking_delta':
    case 'toolcall_delta':
      return event.delta.length > 0
    case 'text_end':
    case 'thinking_end':
      return event.content.length > 0
    case 'toolcall_end':
      return true
    default:
      return false
  }
}

function messageHasPublishedContent(message: AssistantMessage): boolean {
  return message.content.some((part) => {
    if (part.type === 'text') return part.text.length > 0
    if (part.type === 'thinking') return part.thinking.length > 0
    return part.type === 'toolCall'
  })
}

function flushBuffered(
  output: AssistantMessageEventStream,
  buffered: AssistantMessageEvent[]
): void {
  for (const event of buffered.splice(0)) output.push(event)
}

function abortableDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  assertNotAborted(signal)
  if (delayMs === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal.reason instanceof Error ? signal.reason : abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError()
  }
}

function abortError(): Error {
  const error = new Error('Agent provider request aborted')
  error.name = 'AbortError'
  return error
}
