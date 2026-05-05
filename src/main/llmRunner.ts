import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output, streamText } from 'ai';
import type { z } from 'zod';
import type { GenerateLlmPayload, ModelEndpointSettings } from '../shared/types.js';

const defaultWritingSystemPrompt =
  'You are a writing assistant. Generate only the specific section or fragment requested by the user. Do not generate unrelated sections, surrounding document content, explanations, commentary, notes, introductions, conclusions, or meta text.';

function createModel(settings: ModelEndpointSettings) {
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
    supportsStructuredOutputs: true
  });
  return openaiCompatible(settings.model);
}

export async function* streamLlmText(
  settings: ModelEndpointSettings,
  payload: GenerateLlmPayload,
  abortSignal?: AbortSignal
) {
  if (!settings.apiKey.trim()) {
    throw new Error('LLM API key is required. Add it in Settings first.');
  }

  const result = streamText({
    model: createModel(settings),
    system: payload.systemPrompt?.trim()
      ? `${defaultWritingSystemPrompt}\n\n${payload.systemPrompt.trim()}`
      : defaultWritingSystemPrompt,
    prompt: payload.prompt,
    abortSignal,
    maxRetries: 0
  });

  for await (const textPart of result.textStream) {
    yield textPart;
  }
}

export async function generateLlmText(
  settings: ModelEndpointSettings,
  payload: {
    prompt: string;
    systemPrompt?: string;
    maxOutputTokens?: number;
    timeoutMs?: number;
  },
  abortSignal?: AbortSignal
): Promise<string> {
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

export async function generateLlmObject<TSchema extends z.ZodType>(
  settings: ModelEndpointSettings,
  payload: {
    prompt: string;
    systemPrompt?: string;
    schema: TSchema;
  },
  abortSignal?: AbortSignal
): Promise<z.infer<TSchema>> {
  if (!settings.apiKey.trim()) {
    throw new Error('LLM API key is required. Add it in Settings first.');
  }

  const result = await generateText({
    model: createModel(settings),
    system: payload.systemPrompt,
    prompt: payload.prompt,
    output: Output.object({ schema: payload.schema }),
    abortSignal,
    maxRetries: 0
  });

  return result.output as z.infer<TSchema>;
}
