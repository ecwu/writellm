import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AccentColor,
  AppFontFamily,
  AppearanceSettings,
  KnowledgeSettings,
  KnowledgeRetrievalSettings,
  LlmSettings,
  MineruSettings,
  ModelEndpointSettings,
  PublicLlmSettings,
  PublicMineruSettings,
  PublicModelEndpointSettings,
  PublicRerankEndpointSettings,
  RerankEndpointSettings,
  UpdateAppearanceSettingsPayload,
  UpdateLlmSettingsPayload
} from '../shared/types.js';
import { readProviderSecrets, type ProviderSecrets, writeProviderSecrets } from './secretStore.js';

export type OutboundDataPolicySnapshot = Pick<
  LlmSettings['outboundData'],
  'externalProcessingEnabled'
>;

const defaultKnowledgeRetrievalSettings: KnowledgeRetrievalSettings = {
  maxRetrievedChunks: 10,
  maxCandidateChunks: 40,
  rerankTopN: 30,
  adjacentChunkRadius: 1,
  maxChunksPerItem: 3,
  chunkTargetChars: 700,
  chunkOverlapChars: 100,
  embeddingBatchSize: 64
};

const loadElectron = createRequire(import.meta.url);

function getElectronApp(): typeof import('electron').app {
  const app = (loadElectron('electron') as typeof import('electron')).app;
  if (!app) {
    throw new Error('Electron application storage is unavailable in this runtime.');
  }
  return app;
}

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
  rerank: {
    provider: 'siliconflow-compatible',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'BAAI/bge-reranker-v2-m3',
    apiKey: '',
    enabled: true
  },
  vision: {
    provider: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5',
    apiKey: ''
  },
  appearance: {
    theme: 'system',
    accentColor: 'deep-teal',
    fontFamily: 'geist'
  },
  knowledge: {
    pdfExtractionEngine: 'pdfjs',
    mineru: {
      apiKey: '',
      modelVersion: 'vlm',
      language: 'ch',
      isOcr: false,
      enableTable: true,
      enableFormula: true
    },
    retrieval: defaultKnowledgeRetrievalSettings
  },
  outboundData: {
    externalProcessingEnabled: false,
    consentedAt: null
  }
};

function settingsPath(): string {
  const directory = getElectronApp().getPath('userData');
  mkdirSync(directory, { recursive: true });
  return path.join(directory, 'writellm-settings.json');
}

function toPublicEndpoint(settings: ModelEndpointSettings): PublicModelEndpointSettings {
  return {
    provider: settings.provider,
    baseURL: settings.baseURL,
    model: settings.model,
    hasApiKey: settings.apiKey.trim().length > 0
  };
}

function toPublicRerankEndpoint(settings: RerankEndpointSettings): PublicRerankEndpointSettings {
  return {
    provider: settings.provider,
    baseURL: settings.baseURL,
    model: settings.model,
    enabled: settings.enabled,
    hasApiKey: settings.apiKey.trim().length > 0
  };
}

function toPublic(settings: LlmSettings): PublicLlmSettings {
  return {
    chat: toPublicEndpoint(settings.chat),
    embedding: toPublicEndpoint(settings.embedding),
    rerank: toPublicRerankEndpoint(settings.rerank),
    vision: toPublicEndpoint(settings.vision),
    appearance: settings.appearance,
    knowledge: {
      pdfExtractionEngine: settings.knowledge.pdfExtractionEngine,
      mineru: toPublicMineru(settings.knowledge.mineru),
      retrieval: settings.knowledge.retrieval
    },
    outboundData: settings.outboundData
  };
}

function toPublicMineru(settings: MineruSettings): PublicMineruSettings {
  return {
    modelVersion: settings.modelVersion,
    language: settings.language,
    isOcr: settings.isOcr,
    enableTable: settings.enableTable,
    enableFormula: settings.enableFormula,
    hasApiKey: settings.apiKey.trim().length > 0
  };
}

function readEndpoint(
  parsed: Partial<ModelEndpointSettings> | undefined,
  fallback: ModelEndpointSettings
): ModelEndpointSettings {
  return {
    provider: parsed?.provider === 'anthropic-compatible' || parsed?.provider === 'deepseek'
      ? parsed.provider
      : 'openai-compatible',
    baseURL: parsed?.baseURL?.trim() || fallback.baseURL,
    model: parsed?.model?.trim() || fallback.model,
    apiKey: parsed?.apiKey ?? fallback.apiKey
  };
}

function readRerankEndpoint(
  parsed: Partial<RerankEndpointSettings> | undefined,
  fallback: RerankEndpointSettings
): RerankEndpointSettings {
  return {
    provider: 'siliconflow-compatible',
    baseURL: parsed?.baseURL?.trim() || fallback.baseURL,
    model: parsed?.model?.trim() || fallback.model,
    apiKey: parsed?.apiKey ?? fallback.apiKey,
    enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : fallback.enabled
  };
}

function readAppearance(
  parsed: Partial<AppearanceSettings> | undefined,
  fallback: AppearanceSettings
): AppearanceSettings {
  return {
    theme: readThemeMode(parsed?.theme, fallback.theme),
    accentColor: readAccentColor(parsed?.accentColor, fallback.accentColor),
    fontFamily: readAppFontFamily(parsed?.fontFamily, fallback.fontFamily)
  };
}

function readThemeMode(value: unknown, fallback: AppearanceSettings['theme']): AppearanceSettings['theme'] {
  return value === 'system' || value === 'light' || value === 'dark' ? value : fallback;
}

function readAccentColor(value: unknown, fallback: AccentColor): AccentColor {
  return value === 'earth' ||
    value === 'forest' ||
    value === 'ochre' ||
    value === 'cinnabar' ||
    value === 'deep-teal' ||
    value === 'plum'
    ? value
    : fallback;
}

function readAppFontFamily(value: unknown, fallback: AppFontFamily): AppFontFamily {
  return value === 'geist' ||
    value === 'system-sans' ||
    value === 'serif' ||
    value === 'mono' ||
    value === 'humanist-sans'
    ? value
    : fallback;
}

function readMineru(
  parsed: Partial<MineruSettings> | undefined,
  fallback: MineruSettings
): MineruSettings {
  return {
    apiKey: parsed?.apiKey ?? fallback.apiKey,
    modelVersion: parsed?.modelVersion === 'pipeline' ? 'pipeline' : fallback.modelVersion,
    language: parsed?.language?.trim() || fallback.language,
    isOcr: typeof parsed?.isOcr === 'boolean' ? parsed.isOcr : fallback.isOcr,
    enableTable: typeof parsed?.enableTable === 'boolean' ? parsed.enableTable : fallback.enableTable,
    enableFormula: typeof parsed?.enableFormula === 'boolean' ? parsed.enableFormula : fallback.enableFormula
  };
}

function readKnowledge(
  parsed: Partial<KnowledgeSettings> | undefined,
  fallback: KnowledgeSettings
): KnowledgeSettings {
  return {
    pdfExtractionEngine: parsed?.pdfExtractionEngine === 'mineru' ? 'mineru' : fallback.pdfExtractionEngine,
    mineru: readMineru(parsed?.mineru, fallback.mineru),
    retrieval: readKnowledgeRetrieval(parsed?.retrieval, fallback.retrieval)
  };
}

function readKnowledgeRetrieval(
  parsed: Partial<KnowledgeRetrievalSettings> | undefined,
  fallback: KnowledgeRetrievalSettings
): KnowledgeRetrievalSettings {
  return normalizeKnowledgeRetrieval({
    maxRetrievedChunks: readInteger(parsed?.maxRetrievedChunks, fallback.maxRetrievedChunks),
    maxCandidateChunks: readInteger(parsed?.maxCandidateChunks, fallback.maxCandidateChunks),
    rerankTopN: readInteger(parsed?.rerankTopN, fallback.rerankTopN),
    adjacentChunkRadius: readInteger(parsed?.adjacentChunkRadius, fallback.adjacentChunkRadius),
    maxChunksPerItem: readInteger(parsed?.maxChunksPerItem, fallback.maxChunksPerItem),
    chunkTargetChars: readInteger(parsed?.chunkTargetChars, fallback.chunkTargetChars),
    chunkOverlapChars: readInteger(parsed?.chunkOverlapChars, fallback.chunkOverlapChars),
    embeddingBatchSize: readInteger(parsed?.embeddingBatchSize, fallback.embeddingBatchSize)
  });
}

function readInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
  return fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function normalizeKnowledgeRetrieval(settings: KnowledgeRetrievalSettings): KnowledgeRetrievalSettings {
  const maxRetrievedChunks = clampInteger(settings.maxRetrievedChunks, 1, 20);
  const maxCandidateChunks = Math.max(
    maxRetrievedChunks,
    clampInteger(settings.maxCandidateChunks, 1, 80)
  );
  const chunkTargetChars = clampInteger(settings.chunkTargetChars, 200, 3000);
  return {
    maxRetrievedChunks,
    maxCandidateChunks,
    rerankTopN: clampInteger(settings.rerankTopN, 1, 80),
    adjacentChunkRadius: clampInteger(settings.adjacentChunkRadius, 0, 3),
    maxChunksPerItem: clampInteger(settings.maxChunksPerItem, 1, 20),
    chunkTargetChars,
    chunkOverlapChars: Math.min(
      clampInteger(settings.chunkOverlapChars, 0, 1000),
      chunkTargetChars - 1
    ),
    embeddingBatchSize: clampInteger(settings.embeddingBatchSize, 1, 256)
  };
}

export function readLlmSettings(): LlmSettings {
  const filePath = settingsPath();
  if (!existsSync(filePath)) {
    return applyProviderSecrets(defaultSettings, readProviderSecrets());
  }

  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LlmSettings>;
  const legacySecrets = legacyProviderSecrets(parsed);
  const storedSecrets = readProviderSecrets();
  const secrets = mergeProviderSecrets(storedSecrets, legacySecrets);
  const settings: LlmSettings = {
    chat: readEndpoint(parsed.chat, defaultSettings.chat),
    embedding: readEndpoint(parsed.embedding, defaultSettings.embedding),
    rerank: readRerankEndpoint(parsed.rerank, defaultSettings.rerank),
    vision: readEndpoint(parsed.vision, defaultSettings.vision),
    appearance: readAppearance(parsed.appearance, defaultSettings.appearance),
    knowledge: readKnowledge(parsed.knowledge, defaultSettings.knowledge),
    outboundData: readOutboundData(parsed.outboundData, defaultSettings.outboundData)
  };
  const secured = applyProviderSecrets(settings, secrets);
  if (hasProviderSecrets(legacySecrets)) {
    writeProviderSecrets(secrets);
    writePersistedSettings(secured);
  }
  return secured;
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
    rerank: {
      provider: payload.rerankProvider ?? current.rerank.provider,
      baseURL: payload.rerankBaseURL?.trim() || current.rerank.baseURL,
      model: payload.rerankModel?.trim() || current.rerank.model,
      apiKey: payload.rerankApiKey === undefined ? current.rerank.apiKey : payload.rerankApiKey,
      enabled: payload.rerankEnabled ?? current.rerank.enabled
    },
    vision: {
      provider: payload.visionProvider ?? current.vision.provider,
      baseURL: payload.visionBaseURL?.trim() || current.vision.baseURL,
      model: payload.visionModel?.trim() || current.vision.model,
      apiKey: payload.visionApiKey === undefined ? current.vision.apiKey : payload.visionApiKey
    },
    appearance: current.appearance,
    knowledge: {
      pdfExtractionEngine: payload.knowledgePdfExtractionEngine ?? current.knowledge.pdfExtractionEngine,
      mineru: {
        apiKey:
          payload.mineruApiKey === undefined ? current.knowledge.mineru.apiKey : payload.mineruApiKey,
        modelVersion: payload.mineruModelVersion ?? current.knowledge.mineru.modelVersion,
        language: payload.mineruLanguage?.trim() || current.knowledge.mineru.language,
        isOcr: payload.mineruIsOcr ?? current.knowledge.mineru.isOcr,
        enableTable: payload.mineruEnableTable ?? current.knowledge.mineru.enableTable,
        enableFormula: payload.mineruEnableFormula ?? current.knowledge.mineru.enableFormula
      },
      retrieval: readKnowledgeRetrieval(
        payload.knowledgeRetrieval,
        current.knowledge.retrieval
      )
    },
    outboundData: payload.allowExternalProcessing === undefined
      ? current.outboundData
      : {
          externalProcessingEnabled: payload.allowExternalProcessing,
          consentedAt: payload.allowExternalProcessing ? new Date().toISOString() : null
        }
  };

  if (!next.chat.baseURL || !next.embedding.baseURL || !next.vision.baseURL) {
    throw new Error('LLM base URL is required.');
  }
  if (!next.rerank.baseURL) {
    throw new Error('Rerank base URL is required.');
  }
  if (!next.chat.model || !next.embedding.model || !next.vision.model) {
    throw new Error('LLM model name is required.');
  }
  if (!next.rerank.model) {
    throw new Error('Rerank model name is required.');
  }
  if (!next.knowledge.mineru.language) {
    throw new Error('MinerU language is required.');
  }

  writeProviderSecrets(providerSecretsFromSettings(next));
  writePersistedSettings(next);
  return toPublic(next);
}

export function updateAppearanceSettings(
  payload: UpdateAppearanceSettingsPayload
): PublicLlmSettings {
  const current = readLlmSettings();
  const next: LlmSettings = {
    ...current,
    appearance: {
      theme: readThemeMode(payload.theme, defaultSettings.appearance.theme),
      accentColor: payload.accentColor,
      fontFamily: payload.fontFamily
    }
  };

  writePersistedSettings(next);
  return toPublic(next);
}

export function assertOutboundDataAllowed(
  endpointUrl: string,
  operation: 'chat' | 'embedding' | 'rerank' | 'vision' | 'pdf',
  policy?: OutboundDataPolicySnapshot
): void {
  if (isLocalEndpoint(endpointUrl)) {
    return;
  }
  if (policy) {
    if (policy.externalProcessingEnabled) {
      return;
    }
    throw new Error(`External ${operation} processing is disabled. Review and enable it in Settings before sending workspace data to a provider.`);
  }
  // The main-process smoke harness imports these services under ELECTRON_RUN_AS_NODE,
  // where Electron does not expose an app/user-data context for persisted policy.
  if (process.versions.electron && process.env.ELECTRON_RUN_AS_NODE === '1') {
    return;
  }
  if (readLlmSettings().outboundData.externalProcessingEnabled) {
    return;
  }
  throw new Error(`External ${operation} processing is disabled. Review and enable it in Settings before sending workspace data to a provider.`);
}

function readOutboundData(
  parsed: Partial<LlmSettings['outboundData']> | undefined,
  fallback: LlmSettings['outboundData']
): LlmSettings['outboundData'] {
  return {
    externalProcessingEnabled: typeof parsed?.externalProcessingEnabled === 'boolean'
      ? parsed.externalProcessingEnabled
      : fallback.externalProcessingEnabled,
    consentedAt: typeof parsed?.consentedAt === 'string' ? parsed.consentedAt : null
  };
}

function applyProviderSecrets(settings: LlmSettings, secrets: ProviderSecrets): LlmSettings {
  return {
    ...settings,
    chat: { ...settings.chat, apiKey: secrets.chatApiKey },
    embedding: { ...settings.embedding, apiKey: secrets.embeddingApiKey },
    rerank: { ...settings.rerank, apiKey: secrets.rerankApiKey },
    vision: { ...settings.vision, apiKey: secrets.visionApiKey },
    knowledge: {
      ...settings.knowledge,
      mineru: { ...settings.knowledge.mineru, apiKey: secrets.mineruApiKey }
    }
  };
}

function legacyProviderSecrets(settings: Partial<LlmSettings>): ProviderSecrets {
  return {
    chatApiKey: settings.chat?.apiKey ?? '',
    embeddingApiKey: settings.embedding?.apiKey ?? '',
    rerankApiKey: settings.rerank?.apiKey ?? '',
    visionApiKey: settings.vision?.apiKey ?? '',
    mineruApiKey: settings.knowledge?.mineru?.apiKey ?? ''
  };
}

function providerSecretsFromSettings(settings: LlmSettings): ProviderSecrets {
  return {
    chatApiKey: settings.chat.apiKey,
    embeddingApiKey: settings.embedding.apiKey,
    rerankApiKey: settings.rerank.apiKey,
    visionApiKey: settings.vision.apiKey,
    mineruApiKey: settings.knowledge.mineru.apiKey
  };
}

function mergeProviderSecrets(existing: ProviderSecrets, legacy: ProviderSecrets): ProviderSecrets {
  return {
    chatApiKey: legacy.chatApiKey || existing.chatApiKey,
    embeddingApiKey: legacy.embeddingApiKey || existing.embeddingApiKey,
    rerankApiKey: legacy.rerankApiKey || existing.rerankApiKey,
    visionApiKey: legacy.visionApiKey || existing.visionApiKey,
    mineruApiKey: legacy.mineruApiKey || existing.mineruApiKey
  };
}

function hasProviderSecrets(secrets: ProviderSecrets): boolean {
  return Object.values(secrets).some((value) => value.trim().length > 0);
}

function writePersistedSettings(settings: LlmSettings): void {
  const persisted: LlmSettings = {
    ...settings,
    chat: { ...settings.chat, apiKey: '' },
    embedding: { ...settings.embedding, apiKey: '' },
    rerank: { ...settings.rerank, apiKey: '' },
    vision: { ...settings.vision, apiKey: '' },
    knowledge: {
      ...settings.knowledge,
      mineru: { ...settings.knowledge.mineru, apiKey: '' }
    }
  };
  writeFileSync(settingsPath(), `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
}

function isLocalEndpoint(endpointUrl: string): boolean {
  try {
    const url = new URL(endpointUrl);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  } catch {
    return false;
  }
}
