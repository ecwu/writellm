import { describe, expect, it, vi } from 'vitest'
import { autocompleteWorkerRequestSchema } from '../shared/contracts/autocomplete'
import { runAutocompleteRequest } from './autocomplete-request'

const request = autocompleteWorkerRequestSchema.parse({
  operation: 'autocomplete',
  style: 'word',
  requestId: '00000000-0000-4000-8000-000000000001',
  projectSessionId: '00000000-0000-4000-8000-000000000002',
  context: {},
  modelId: 'deepseek-v4-pro',
  credential: 'test-only-key',
  input: {
    requestId: '00000000-0000-4000-8000-000000000001',
    projectSessionId: '00000000-0000-4000-8000-000000000002',
    sectionId: '00000000-0000-4000-8000-000000000003',
    blockId: 'block',
    generation: 1,
    prefix: 'Once upon a',
    suffix: ' forest.',
    atBlockEnd: false
  }
})
describe('DeepSeek autocomplete adapter', () => {
  it.each([false, true])(
    'uses the correct fixed endpoint and protocol (block end: %s)',
    async (atBlockEnd) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [{ text: ' quiet', message: { content: ' quiet' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 }
        })
      )
      const signal = new AbortController().signal
      const result = await runAutocompleteRequest(
        {
          ...request,
          input: { ...request.input, atBlockEnd, suffix: atBlockEnd ? '' : ' forest.' }
        },
        signal,
        fetcher
      )
      expect(result).toMatchObject({ text: ' quiet', usage: { total_tokens: 14 } })
      const [url, init] = fetcher.mock.calls[0]
      expect(url).toBe(
        `https://api.deepseek.com/beta/${atBlockEnd ? 'chat/completions' : 'completions'}`
      )
      expect(init).toMatchObject({
        signal,
        redirect: 'error',
        headers: { Authorization: 'Bearer test-only-key' }
      })
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        model: 'deepseek-v4-pro',
        max_tokens: 32,
        temperature: 0.2,
        stream: false,
        stop: ['\n', '\r']
      })
      if (atBlockEnd)
        expect(body).toMatchObject({
          thinking: { type: 'disabled' },
          messages: [{ role: 'user' }, { role: 'assistant', prefix: true, content: 'Once upon a' }]
        })
      else expect(body).toMatchObject({ prompt: 'Once upon a', suffix: ' forest.' })
    }
  )
  it.each(['word', 'sentence', 'paragraph'] as const)(
    'applies %s budgets to both protocols',
    async (style) => {
      for (const atBlockEnd of [true, false]) {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            choices: [
              {
                text: ' one two three four five. Next.',
                message: { content: ' one two three four five. Next.' },
                finish_reason: 'stop'
              }
            ]
          })
        )
        const result = await runAutocompleteRequest(
          {
            ...request,
            style,
            input: { ...request.input, atBlockEnd, suffix: atBlockEnd ? '' : request.input.suffix }
          },
          new AbortController().signal,
          fetcher
        )
        const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
        expect(body.max_tokens).toBe({ word: 32, sentence: 128, paragraph: 384 }[style])
        expect(result.text).toBe(
          {
            word: ' one two three four',
            sentence: ' one two three four five.',
            paragraph: ' one two three four five. Next.'
          }[style]
        )
        expect(result.displayedCharacters).toBe([...result.text].length)
        if (atBlockEnd)
          expect(body.messages[0].content).toContain(
            { word: 'four words', sentence: 'current sentence', paragraph: 'current paragraph' }[
              style
            ]
          )
        else {
          expect(body.prompt).toBe(request.input.prefix)
          expect(body.suffix).toBe(request.input.suffix)
          expect(body.messages).toBeUndefined()
        }
      }
    }
  )
  it('allows a bounded length result, preserving leading spaces and stopping at a newline', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [{ text: ' suggestion\nprivate next line', finish_reason: 'length' }]
      })
    )
    expect(await runAutocompleteRequest(request, new AbortController().signal, fetcher)).toEqual({
      text: ' suggestion',
      originalCharacters: 29,
      displayedCharacters: 11
    })
  })
  it.each(['content_filter', 'aborted', 'insufficient_system_resource'])(
    'rejects partial content after %s',
    async (finish_reason) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ choices: [{ text: 'partial', finish_reason }] }))
      await expect(
        runAutocompleteRequest(request, new AbortController().signal, fetcher)
      ).rejects.toThrow('did not finish normally')
    }
  )
  it.each([401, 403, 429, 500])(
    'reports HTTP %s without reading private error bodies or retrying',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('sensitive body', { status, headers: { 'Retry-After': '60' } })
        )
      await expect(
        runAutocompleteRequest(request, new AbortController().signal, fetcher)
      ).rejects.toMatchObject({ httpStatus: status, retryAt: expect.any(Number) })
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )
  it('sanitizes JSON syntax error excerpts and bounds response bodies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private manuscript not json'))
    await expect(
      runAutocompleteRequest(request, new AbortController().signal, fetcher)
    ).rejects.toThrow('Autocomplete response is not valid JSON')
    fetcher.mockResolvedValue(new Response('x'.repeat(70_000)))
    await expect(
      runAutocompleteRequest(request, new AbortController().signal, fetcher)
    ).rejects.toThrow('Outbound HTTP policy')
  })
})
