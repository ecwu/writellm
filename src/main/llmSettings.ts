import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LlmSettings, PublicLlmSettings, UpdateLlmSettingsPayload } from '../shared/types.js';

const defaultSettings: LlmSettings = {
  provider: 'openai-compatible',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-5',
  apiKey: ''
};

function settingsPath(): string {
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, 'paperlab-settings.json');
}

function toPublic(settings: LlmSettings): PublicLlmSettings {
  return {
    provider: settings.provider,
    baseURL: settings.baseURL,
    model: settings.model,
    hasApiKey: settings.apiKey.trim().length > 0
  };
}

export function readLlmSettings(): LlmSettings {
  const filePath = settingsPath();
  if (!existsSync(filePath)) {
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LlmSettings>;
    return {
      provider:
        parsed.provider === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible',
      baseURL: parsed.baseURL?.trim() || defaultSettings.baseURL,
      model: parsed.model?.trim() || defaultSettings.model,
      apiKey: parsed.apiKey ?? ''
    };
  } catch {
    return defaultSettings;
  }
}

export function readPublicLlmSettings(): PublicLlmSettings {
  return toPublic(readLlmSettings());
}

export function updateLlmSettings(payload: UpdateLlmSettingsPayload): PublicLlmSettings {
  const current = readLlmSettings();
  const next: LlmSettings = {
    provider: payload.provider,
    baseURL: payload.baseURL.trim(),
    model: payload.model.trim(),
    apiKey: payload.apiKey === undefined ? current.apiKey : payload.apiKey
  };

  if (!next.baseURL) {
    throw new Error('LLM base URL is required.');
  }
  if (!next.model) {
    throw new Error('LLM model name is required.');
  }

  writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return toPublic(next);
}
