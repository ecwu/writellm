import type { ServerResponse } from 'node:http'

export function sendSse(response: ServerResponse, chunks: unknown[], requestId?: string): void {
  if (response.destroyed) return
  const headers: Record<string, string> = {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache'
  }
  if (requestId !== undefined) headers['x-request-id'] = requestId
  response.writeHead(200, headers)
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

export function sendCompletion(
  response: ServerResponse,
  text: string,
  options: {
    id?: string
    model?: string
    requestId?: string | null
    promptTokens?: number
    completionTokens?: number
  } = {}
): void {
  const id = options.id ?? 'e2e-completion'
  const model = options.model ?? 'e2e-model'
  const promptTokens = options.promptTokens ?? 12
  const completionTokens = options.completionTokens ?? 4
  sendSse(
    response,
    [
      {
        id,
        object: 'chat.completion.chunk',
        created: 1,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
      },
      {
        id,
        object: 'chat.completion.chunk',
        created: 1,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
      }
    ],
    options.requestId === null ? undefined : (options.requestId ?? id)
  )
}

export function sendToolCall(
  response: ServerResponse,
  input: { responseId: string; toolCallId: string; name: string; args: unknown },
  options: {
    model?: string
    requestId?: string | null
    promptTokens?: number
    completionTokens?: number
    text?: string
  } = {}
): void {
  const model = options.model ?? 'e2e-model'
  const promptTokens = options.promptTokens ?? 10
  const completionTokens = options.completionTokens ?? 5
  sendSse(
    response,
    [
      {
        id: input.responseId,
        object: 'chat.completion.chunk',
        created: 1,
        model,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              ...(options.text === undefined ? {} : { content: options.text }),
              tool_calls: [
                {
                  index: 0,
                  id: input.toolCallId,
                  type: 'function',
                  function: { name: input.name, arguments: JSON.stringify(input.args) }
                }
              ]
            },
            finish_reason: null
          }
        ]
      },
      {
        id: input.responseId,
        object: 'chat.completion.chunk',
        created: 1,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        }
      }
    ],
    options.requestId === null ? undefined : (options.requestId ?? input.responseId)
  )
}
