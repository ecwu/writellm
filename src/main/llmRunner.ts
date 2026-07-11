import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Output, generateText, streamText } from 'ai';
import type { z } from 'zod';
import type { ModelEndpointSettings } from '../shared/types.js';
import { assertOutboundDataAllowed, type OutboundDataPolicySnapshot } from './llmSettings.js';

function createModel(settings: ModelEndpointSettings, options: { jsonMode?: boolean; structuredOutputs?: boolean } = {}) {
  if (settings.provider === 'deepseek') {
    if (options.jsonMode) {
      const deepseekJson = createOpenAICompatible({
        name: 'deepseek-json',
        baseURL: settings.baseURL,
        apiKey: settings.apiKey,
        transformRequestBody: (body) => ({
          ...body,
          response_format: { type: 'json_object' }
        })
      });
      return deepseekJson(settings.model);
    }
    return createDeepSeek({
      baseURL: settings.baseURL,
      apiKey: settings.apiKey
    })(settings.model);
  }
  if (settings.provider === 'anthropic-compatible') {
    const anthropic = createAnthropic({
      baseURL: settings.baseURL,
      apiKey: settings.apiKey
    });
    return anthropic(settings.model);
  }

  const openaiCompatible = createOpenAICompatible({
    name: 'openaiCompatible',
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    supportsStructuredOutputs: options.structuredOutputs ?? false
  });
  return openaiCompatible(settings.model);
}

export async function generateLlmText(
  settings: ModelEndpointSettings,
  payload: {
    prompt: string;
    systemPrompt?: string;
    maxOutputTokens?: number;
    timeoutMs?: number;
  },
  abortSignal?: AbortSignal,
  outboundDataPolicy?: OutboundDataPolicySnapshot
): Promise<string> {
  assertOutboundDataAllowed(settings.baseURL, 'chat', outboundDataPolicy);
  if (!settings.apiKey.trim()) {
    throw new Error('LLM API key is required. Add it in Settings first.');
  }

  const result = await generateText({
    model: createModel(settings),
    system: payload.systemPrompt,
    prompt: payload.prompt,
    abortSignal,
    maxOutputTokens: payload.maxOutputTokens,
    timeout: payload.timeoutMs,
    maxRetries: 0
  });

  return result.text;
}

function extractJsonFromText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i)?.[1] ?? text;
  const candidate = firstCompleteJsonObject(fenced);
  if (!candidate) {
    throw new Error(`Model did not return a complete JSON object. Received: ${text}`);
  }
  return candidate;
}

function firstCompleteJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (start < 0) {
      if (character === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          start = -1;
        }
      }
    }
  }
  return null;
}

function jsonSystemPrompt(systemPrompt: string | undefined, jsonExample?: string): string {
  return [
    systemPrompt?.trim(),
    'Return only one complete JSON object. Do not wrap it in Markdown and do not add commentary.',
    jsonExample ? `Use this exact JSON shape (replace values, keep every key): ${jsonExample}` : null
  ].filter(Boolean).join('\n\n');
}

export async function generateLlmObject<TSchema extends z.ZodType>(
  settings: ModelEndpointSettings,
  payload: {
    prompt: string;
    systemPrompt?: string;
    schema: TSchema;
    jsonExample?: string;
    maxOutputTokens?: number;
  },
  abortSignal?: AbortSignal,
  outboundDataPolicy?: OutboundDataPolicySnapshot
): Promise<z.infer<TSchema>> {
  assertOutboundDataAllowed(settings.baseURL, 'chat', outboundDataPolicy);
  if (!settings.apiKey.trim()) {
    throw new Error('LLM API key is required. Add it in Settings first.');
  }

  if (settings.provider !== 'deepseek') {
    const result = await generateText({
      model: createModel(settings, { structuredOutputs: true }),
      system: jsonSystemPrompt(payload.systemPrompt, payload.jsonExample),
      prompt: payload.prompt,
      output: Output.object({ schema: payload.schema }),
      abortSignal,
      maxOutputTokens: payload.maxOutputTokens,
      maxRetries: 0
    });
    return result.output as z.infer<TSchema>;
  }

  const result = await generateText({
    model: createModel(settings, { jsonMode: settings.provider === 'deepseek' }),
    system: jsonSystemPrompt(payload.systemPrompt, payload.jsonExample),
    prompt: payload.prompt,
    abortSignal,
    maxOutputTokens: payload.maxOutputTokens,
    temperature: settings.provider === 'deepseek' ? 0.2 : undefined,
    maxRetries: 0
  });

  const rawJson = extractJsonFromText(result.text);
  return payload.schema.parse(JSON.parse(rawJson)) as z.infer<TSchema>;
}

export async function streamLlmObject<TSchema extends z.ZodType>(
  settings: ModelEndpointSettings,
  payload: {
    prompt: string;
    systemPrompt?: string;
    schema: TSchema;
    onTextDelta: (text: string) => void;
    jsonExample?: string;
    maxOutputTokens?: number;
  },
  abortSignal?: AbortSignal,
  outboundDataPolicy?: OutboundDataPolicySnapshot
): Promise<z.infer<TSchema>> {
  assertOutboundDataAllowed(settings.baseURL, 'chat', outboundDataPolicy);
  if (!settings.apiKey.trim()) {
    throw new Error('LLM API key is required. Add it in Settings first.');
  }

  const result = streamText({
    model: createModel(settings, { jsonMode: settings.provider === 'deepseek' }),
    system: jsonSystemPrompt(payload.systemPrompt, payload.jsonExample),
    prompt: payload.prompt,
    abortSignal,
    maxOutputTokens: payload.maxOutputTokens,
    temperature: settings.provider === 'deepseek' ? 0.2 : undefined,
    maxRetries: 0
  });
  let text = '';
  for await (const delta of result.textStream) {
    text += delta;
    payload.onTextDelta(delta);
  }
  return payload.schema.parse(JSON.parse(extractJsonFromText(text))) as z.infer<TSchema>;
}
