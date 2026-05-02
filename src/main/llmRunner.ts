import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import type { GenerateLlmPayload, LlmSettings } from '../shared/types.js';

const defaultWritingSystemPrompt =
  'You are a writing assistant. Generate only the specific section or fragment requested by the user. Do not generate unrelated sections, surrounding document content, explanations, commentary, notes, introductions, conclusions, or meta text.';

function createModel(settings: LlmSettings) {
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
    apiKey: settings.apiKey
  });
  return openaiCompatible(settings.model);
}

export async function* streamLlmText(
  settings: LlmSettings,
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
    maxRetries: 0,
    timeout: { totalMs: 45_000 }
  });

  for await (const textPart of result.textStream) {
    yield textPart;
  }
}
