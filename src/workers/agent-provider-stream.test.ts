import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent
} from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRetryingAgentProviderStream, parseRetryAfterMs } from './agent-provider-stream'

afterEach(() => vi.useRealTimers())

describe('createRetryingAgentProviderStream', () => {
  it('forwards pending streaming content until a real terminal response arrives', async () => {
    const partial = message('pending', 'Streaming text')
    const retrying = createRetryingAgentProviderStream({
      startAttempt: () =>
        eventStream(
          { type: 'start', partial },
          { type: 'text_delta', contentIndex: 0, delta: 'Streaming text', partial },
          { type: 'done', reason: 'stop', message: message('stop', 'Streaming text') }
        ),
      responseStatus: () => 200,
      retryAfterMs: () => undefined,
      createErrorMessage: (error) => message('error', '', String(error)),
      onRetry: () => undefined
    })
    const events: AssistantMessageEvent[] = []
    for await (const event of retrying.stream) events.push(event)
    expect(events).toContainEqual(expect.objectContaining({ type: 'text_delta', partial }))
    expect(await retrying.stream.result()).toMatchObject({ stopReason: 'stop' })
  })

  it.each(['pending', 'deferred'] as const)(
    'fails a terminal %s response without retrying or losing partial output',
    async (stopReason) => {
      const createErrorMessage = vi.fn((error: unknown) => message('error', '', String(error)))
      const startAttempt = vi.fn(() =>
        eventStream({
          type: 'done',
          reason: stopReason === 'deferred' ? 'deferred' : 'stop',
          message: message(stopReason, 'Unfinished response')
        })
      )
      const retrying = createRetryingAgentProviderStream({
        startAttempt,
        responseStatus: () => 200,
        retryAfterMs: () => 0,
        createErrorMessage,
        onRetry: () => undefined
      })
      expect(await retrying.stream.result()).toMatchObject({
        stopReason: 'error',
        content: [{ type: 'text', text: 'Unfinished response' }],
        errorMessage: expect.stringContaining(`unsupported terminal stop reason: ${stopReason}`)
      })
      expect(createErrorMessage).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'unsupported_provider_stop_reason' }),
        false
      )
      expect(startAttempt).toHaveBeenCalledTimes(1)
      expect(retrying.state).toMatchObject({ retryCount: 0, retryableFailure: false })
    }
  )

  it('retries four transient failures and succeeds on the fifth logical attempt', async () => {
    let attempts = 0
    const retries: number[] = []
    const retrying = createRetryingAgentProviderStream({
      startAttempt: () => {
        attempts += 1
        return attempts < 5
          ? eventStream(errorEvent('503 service unavailable'))
          : eventStream(
              { type: 'start', partial: message('stop') },
              { type: 'done', reason: 'stop', message: message('stop', 'complete') }
            )
      },
      responseStatus: () => (attempts < 5 ? 503 : 200),
      retryAfterMs: () => 0,
      createErrorMessage: (error, aborted) =>
        message(aborted ? 'aborted' : 'error', '', String(error)),
      onRetry: ({ completedAttempts }) => retries.push(completedAttempts)
    })

    await expect(retrying.stream.result()).resolves.toMatchObject({ stopReason: 'stop' })
    expect(attempts).toBe(5)
    expect(retries).toEqual([1, 2, 3, 4])
    expect(retrying.state).toMatchObject({ attemptCount: 5, retryCount: 4, exhausted: false })
  })

  it('does not retry after assistant content has been published', async () => {
    let attempts = 0
    const events: AssistantMessageEvent[] = []
    const retrying = createRetryingAgentProviderStream({
      startAttempt: () => {
        attempts += 1
        const partial = message('stop', 'partial')
        return eventStream(
          { type: 'start', partial },
          { type: 'text_start', contentIndex: 0, partial },
          { type: 'text_delta', contentIndex: 0, delta: 'partial', partial },
          errorEvent('socket connection was closed', 'partial')
        )
      },
      responseStatus: () => undefined,
      retryAfterMs: () => 0,
      createErrorMessage: (error, aborted) =>
        message(aborted ? 'aborted' : 'error', '', String(error)),
      onRetry: () => undefined
    })

    for await (const event of retrying.stream) events.push(event)
    expect(attempts).toBe(1)
    expect(events.some((event) => event.type === 'text_delta')).toBe(true)
    expect(await retrying.stream.result()).toMatchObject({ stopReason: 'error' })
    expect(retrying.state).toMatchObject({
      retryCount: 0,
      exhausted: false,
      retryableFailure: true,
      publishedContent: true
    })
  })

  it('does not retry permanent authorization or quota failures', async () => {
    for (const failure of [
      { status: 401, error: 'unauthorized' },
      { status: 429, error: 'insufficient_quota billing limit reached' }
    ]) {
      let attempts = 0
      const retrying = createRetryingAgentProviderStream({
        startAttempt: () => {
          attempts += 1
          return eventStream(errorEvent(failure.error))
        },
        responseStatus: () => failure.status,
        retryAfterMs: () => 0,
        createErrorMessage: (error, aborted) =>
          message(aborted ? 'aborted' : 'error', '', String(error)),
        onRetry: () => undefined
      })
      await expect(retrying.stream.result()).resolves.toMatchObject({ stopReason: 'error' })
      expect(attempts).toBe(1)
      expect(retrying.state.retryableFailure).toBe(false)
    }
  })

  it('cancels an active retry delay', async () => {
    const controller = new AbortController()
    let attempts = 0
    let retryScheduled: (() => void) | undefined
    const scheduled = new Promise<void>((resolve) => {
      retryScheduled = resolve
    })
    const retrying = createRetryingAgentProviderStream({
      signal: controller.signal,
      startAttempt: () => {
        attempts += 1
        return eventStream(errorEvent('503 service unavailable'))
      },
      responseStatus: () => 503,
      retryAfterMs: () => 10_000,
      createErrorMessage: (error, aborted) =>
        message(aborted ? 'aborted' : 'error', '', String(error)),
      onRetry: () => retryScheduled?.()
    })

    await scheduled
    controller.abort()
    await expect(retrying.stream.result()).resolves.toMatchObject({ stopReason: 'aborted' })
    expect(attempts).toBe(1)
  })
})

describe('parseRetryAfterMs', () => {
  it('parses millisecond, second, and HTTP-date headers', () => {
    expect(parseRetryAfterMs({ 'retry-after-ms': '1250' }, 0)).toBe(1_250)
    expect(parseRetryAfterMs({ 'Retry-After': '2' }, 0)).toBe(2_000)
    expect(parseRetryAfterMs({ 'retry-after': 'Thu, 01 Jan 1970 00:00:03 GMT' }, 1_000)).toBe(2_000)
  })
})

function eventStream(...events: AssistantMessageEvent[]) {
  const stream = createAssistantMessageEventStream()
  for (const event of events) stream.push(event)
  return stream
}

function errorEvent(errorMessage: string, content = ''): AssistantMessageEvent {
  return {
    type: 'error',
    reason: 'error',
    error: message('error', content, errorMessage)
  }
}

function message(
  stopReason: AssistantMessage['stopReason'],
  content = '',
  errorMessage?: string
): AssistantMessage {
  return {
    role: 'assistant',
    content: content.length === 0 ? [] : [{ type: 'text', text: content }],
    api: 'openai-completions',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: 1
  }
}
