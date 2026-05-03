import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AppearanceSettings,
  LlmSettings,
  ModelEndpointSettings,
  PublicLlmSettings,
  PublicModelEndpointSettings,
  UpdateAppearanceSettingsPayload,
  UpdateLlmSettingsPayload
} from '../shared/types.js';

const defaultSettings: LlmSettings = {
  chat: {
    provider: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5',
    apiKey: ''
  },
  embedding: {
    provider: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    apiKey: ''
  },
  vision: {
    provider: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5',
    apiKey: ''
  },
  appearance: {
    theme: 'light'
  }
};

function settingsPath(): string {
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, 'paperlab-settings.json');
}

function toPublicEndpoint(settings: ModelEndpointSettings): PublicModelEndpointSettings {
  return {
    provider: settings.provider,
    baseURL: settings.baseURL,
    model: settings.model,
    hasApiKey: settings.apiKey.trim().length > 0
  };
}

function toPublic(settings: LlmSettings): PublicLlmSettings {
  return {
    chat: toPublicEndpoint(settings.chat),
    embedding: toPublicEndpoint(settings.embedding),
    vision: toPublicEndpoint(settings.vision),
    appearance: settings.appearance
  };
}

function readEndpoint(
  parsed: Partial<ModelEndpointSettings> | undefined,
  fallback: ModelEndpointSettings
): ModelEndpointSettings {
  return {
    provider:
      parsed?.provider === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible',
    baseURL: parsed?.baseURL?.trim() || fallback.baseURL,
    model: parsed?.model?.trim() || fallback.model,
    apiKey: parsed?.apiKey ?? fallback.apiKey
  };
}

function readAppearance(
  parsed: Partial<AppearanceSettings> | undefined,
  fallback: AppearanceSettings
): AppearanceSettings {
  return {
    theme: parsed?.theme === 'dark' ? 'dark' : fallback.theme
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
      chat: readEndpoint(parsed.chat, defaultSettings.chat),
      embedding: readEndpoint(parsed.embedding, defaultSettings.embedding),
      vision: readEndpoint(parsed.vision, defaultSettings.vision),
      appearance: readAppearance(parsed.appearance, defaultSettings.appearance)
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
    chat: {
      provider: payload.provider,
      baseURL: payload.baseURL.trim(),
      model: payload.model.trim(),
      apiKey: payload.apiKey === undefined ? current.chat.apiKey : payload.apiKey
    },
    embedding: {
      provider: payload.embeddingProvider ?? current.embedding.provider,
      baseURL: payload.embeddingBaseURL?.trim() || current.embedding.baseURL,
      model: payload.embeddingModel?.trim() || current.embedding.model,
      apiKey:
        payload.embeddingApiKey === undefined ? current.embedding.apiKey : payload.embeddingApiKey
    },
    vision: {
      provider: payload.visionProvider ?? current.vision.provider,
      baseURL: payload.visionBaseURL?.trim() || current.vision.baseURL,
      model: payload.visionModel?.trim() || current.vision.model,
      apiKey: payload.visionApiKey === undefined ? current.vision.apiKey : payload.visionApiKey
    },
    appearance: current.appearance
  };

  if (!next.chat.baseURL || !next.embedding.baseURL || !next.vision.baseURL) {
    throw new Error('LLM base URL is required.');
  }
  if (!next.chat.model || !next.embedding.model || !next.vision.model) {
    throw new Error('LLM model name is required.');
  }

  writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return toPublic(next);
}

export function updateAppearanceSettings(
  payload: UpdateAppearanceSettingsPayload
): PublicLlmSettings {
  const current = readLlmSettings();
  const next: LlmSettings = {
    ...current,
    appearance: {
      theme: payload.theme
    }
  };

  writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return toPublic(next);
}
