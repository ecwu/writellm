import type { StreamFunction, Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { ModelEndpointSettings } from '../../shared/types.js';
import { assertOutboundDataAllowed, type OutboundDataPolicySnapshot } from '../llmSettings.js';

const AGENT_PROVIDER_ID = 'writellm-agent';
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

export type PiModelPreflightCategory =
  | 'provider_configuration'
  | 'provider_capability'
  | 'provider_authentication'
  | 'consent_denied';

export class PiModelPreflightError extends Error {
  constructor(
    readonly category: PiModelPreflightCategory,
    message: string
  ) {
    super(message);
    this.name = 'PiModelPreflightError';
  }
}

export type PiModelAdapter = {
  model: Model<'openai-completions'>;
  streamFn: StreamFunction;
  getApiKey: (provider: string) => string | undefined;
  maxOutputTokens: number;
};

export function createPiModelAdapter(
  settings: ModelEndpointSettings,
  outboundDataPolicy: OutboundDataPolicySnapshot,
  options: {
    streamFn?: StreamFunction;
    maxOutputTokens?: number;
  } = {}
): PiModelAdapter {
  validateSettings(settings, outboundDataPolicy);

  const maxOutputTokens = normalizeMaxOutputTokens(options.maxOutputTokens);
  const apiKey = settings.apiKey.trim();
  const model: Model<'openai-completions'> = {
    id: settings.model.trim(),
    name: settings.model.trim(),
    api: 'openai-completions',
    provider: AGENT_PROVIDER_ID,
    baseUrl: settings.baseURL.trim().replace(/\/+$/, ''),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: maxOutputTokens,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false
    }
  };

  return {
    model,
    streamFn: options.streamFn ?? openAICompletionsApi().streamSimple,
    getApiKey: (provider) => provider === AGENT_PROVIDER_ID ? apiKey || undefined : undefined,
    maxOutputTokens
  };
}

function validateSettings(
  settings: ModelEndpointSettings,
  outboundDataPolicy: OutboundDataPolicySnapshot
): void {
  if (settings.provider !== 'openai-compatible' && settings.provider !== 'deepseek') {
    throw new PiModelPreflightError(
      'provider_capability',
      'Pi generation currently requires an OpenAI-compatible chat endpoint. Configure one in Settings before starting a run.'
    );
  }
  if (!settings.model.trim()) {
    throw new PiModelPreflightError('provider_configuration', 'An agent model is required. Configure one in Settings before starting a run.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(settings.baseURL);
  } catch {
    throw new PiModelPreflightError('provider_configuration', 'The agent endpoint must be a valid HTTP(S) URL.');
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new PiModelPreflightError('provider_configuration', 'The agent endpoint must use HTTP or HTTPS.');
  }
  try {
    assertOutboundDataAllowed(settings.baseURL, 'chat', outboundDataPolicy);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new PiModelPreflightError('consent_denied', message);
  }
}

function normalizeMaxOutputTokens(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }
  return Math.min(Math.trunc(value), DEFAULT_MAX_OUTPUT_TOKENS);
}
