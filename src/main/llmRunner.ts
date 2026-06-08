import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Output, generateText } from 'ai';
import type { z } from 'zod';
import type { ModelEndpointSettings } from '../shared/types.js';

function createModel(settings: ModelEndpointSettings, options: { structuredOutputs?: boolean } = {}) {
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

function extractJsonFromText(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const jsonMatch = text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    return jsonMatch[1];
  }
  return text.trim();
}

type JsonSchemaType = string | { [key: string]: JsonSchemaType } | JsonSchemaType[];

function zodSchemaToJson(schema: z.ZodTypeAny): JsonSchemaType {
  const def = (schema as z.ZodTypeAny & { _def: Record<string, unknown> })._def;
  switch (def.typeName) {
    case 'ZodString': return 'string';
    case 'ZodNumber': return 'number';
    case 'ZodBoolean': return 'boolean';
    case 'ZodArray': return [zodSchemaToJson(def.type as unknown as z.ZodTypeAny)];
    case 'ZodObject': {
      const shape = (def as Record<string, unknown>).shape as Record<string, z.ZodTypeAny>;
      const result: Record<string, JsonSchemaType> = {};
      for (const [key, value] of Object.entries(shape)) {
        result[key] = zodSchemaToJson(value);
      }
      return result;
    }
    case 'ZodOptional': return zodSchemaToJson(def.innerType as unknown as z.ZodTypeAny);
    case 'ZodEnum': return def.values as string[];
    case 'ZodDefault': return zodSchemaToJson(def.type as unknown as z.ZodTypeAny);
    case 'ZodNullable': return zodSchemaToJson(def.innerType as unknown as z.ZodTypeAny);
    default: return 'string';
  }
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

  try {
    const result = await generateText({
      model: createModel(settings, { structuredOutputs: true }),
      system: payload.systemPrompt,
      prompt: payload.prompt,
      output: Output.object({ schema: payload.schema }),
      abortSignal,
      maxRetries: 0
    });
    return result.output as z.infer<TSchema>;
  } catch {
    // Some OpenAI-compatible endpoints ignore or reject JSON schema response_format.
    // Fall back to the looser instruction-based path so older providers still work.
  }

  const jsonInstruction = `\n\nYou must respond with ONLY a valid JSON object (no markdown fences, no commentary). The JSON must conform to this exact schema: ${payload.schema.description ?? JSON.stringify(zodSchemaToJson(payload.schema))}`;
  const systemWithJson = (payload.systemPrompt ?? '') + jsonInstruction;

  const result = await generateText({
    model: createModel(settings),
    system: systemWithJson || undefined,
    prompt: payload.prompt,
    abortSignal,
    maxRetries: 0
  });

  const rawJson = extractJsonFromText(result.text);
  return payload.schema.parse(JSON.parse(rawJson)) as z.infer<TSchema>;
}
