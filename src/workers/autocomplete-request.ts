import { z } from 'zod'
import {
  autocompleteUsageSchema,
  type AutocompleteWorkerRequest
} from '../shared/contracts/autocomplete'
import { autocompleteStyles, boundAutocomplete } from './autocomplete-style'
import { readBoundedText } from './outbound-http'

export class AutocompleteHttpError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly retryAt?: number
  ) {
    super(`Autocomplete HTTP ${httpStatus}`)
    this.name = 'AutocompleteHttpError'
  }
}
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        text: z.string().max(16_384).optional(),
        message: z.object({ content: z.string().max(16_384).nullable() }).optional()
      })
    )
    .min(1),
  usage: autocompleteUsageSchema.optional()
})

export async function runAutocompleteRequest(
  request: AutocompleteWorkerRequest,
  signal: AbortSignal,
  fetchImplementation: typeof fetch = fetch
): Promise<{
  text: string
  originalCharacters: number
  displayedCharacters: number
  usage?: z.infer<typeof autocompleteUsageSchema>
}> {
  const { input, modelId, credential, style } = request
  const common = {
    model: modelId,
    max_tokens: autocompleteStyles[style].tokens,
    temperature: 0.2,
    stream: false,
    stop: ['\n', '\r']
  }
  const body = input.atBlockEnd
    ? {
        ...common,
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'user',
            content: `Continue the following writing in the same language and style. ${autocompleteStyles[style].instruction} Return only the continuation, without explanations or repeating the prefix.`
          },
          { role: 'assistant', content: input.prefix, prefix: true }
        ]
      }
    : { ...common, prompt: input.prefix, suffix: input.suffix }
  const response = await fetchImplementation(
    `https://api.deepseek.com/beta/${input.atBlockEnd ? 'chat/completions' : 'completions'}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
      body: JSON.stringify(body),
      signal,
      redirect: 'error'
    }
  )
  if (!response.ok) {
    const retry = response.headers.get('retry-after')
    const seconds = retry === null ? NaN : Number(retry)
    const retryAt =
      retry === null
        ? NaN
        : Number.isFinite(seconds)
          ? Date.now() + seconds * 1_000
          : Date.parse(retry)
    await response.body?.cancel()
    throw new AutocompleteHttpError(response.status, Number.isFinite(retryAt) ? retryAt : undefined)
  }
  // JSON syntax errors can contain private response excerpts. Replace their message before
  // the original error is logged by the Worker; retain the same object, stack and cause.
  let json: unknown
  try {
    json = JSON.parse(await readBoundedText(response, 65_536))
  } catch (err) {
    if (err instanceof SyntaxError) {
      err.message = 'Autocomplete response is not valid JSON'
      err.stack = `${err.name}: ${err.message}\n${err.stack?.split('\n').slice(1).join('\n') ?? ''}`
    }
    throw err
  }
  const parsed = responseSchema.safeParse(json)
  if (!parsed.success) throw new Error('Autocomplete response shape is invalid')
  const choice = parsed.data.choices[0]
  if (!['stop', 'length'].includes(choice.finish_reason))
    throw new Error('Autocomplete generation did not finish normally')
  const content = input.atBlockEnd ? choice.message?.content : choice.text
  if (content === undefined) throw new Error('Autocomplete response content is missing')
  const text = boundAutocomplete(content ?? '', style, input.prefix)
  return {
    text,
    originalCharacters: [...(content ?? '')].length,
    displayedCharacters: [...text].length,
    ...(parsed.data.usage ? { usage: parsed.data.usage } : {})
  }
}
