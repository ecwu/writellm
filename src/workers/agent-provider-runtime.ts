import type { Api, Model, ProviderStreams } from '@earendil-works/pi-ai'
import type {
  AgentModelLimits,
  AgentRuntimeModel,
  AgentRuntimeAuth
} from '../shared/contracts/agent'
import type { ProviderConfig } from '../shared/contracts/providers'

export class AgentOutputLimitError extends Error {
  readonly code = 'output_limit_reached'
  readonly stage = 'provider'

  constructor(maxOutputTokens: number) {
    super(
      `The model response was cut off by the output limit (requested budget: ${maxOutputTokens} tokens). Lower Thinking or request a smaller section, then continue.`
    )
    this.name = 'AgentOutputLimitError'
  }
}

export function buildAgentProviderModel(input: {
  config: Extract<ProviderConfig, { role: 'agent' }>
  runtimeModel?: AgentRuntimeModel
  modelLimits: AgentModelLimits
  maxOutputTokens: number
}): Model<Api> {
  const { config, runtimeModel } = input
  return {
    id: runtimeModel?.id ?? config.model,
    name: runtimeModel?.name ?? config.model,
    api: runtimeModel?.api ?? config.api ?? ('openai-completions' as const),
    provider: runtimeModel?.provider ?? config.providerId,
    baseUrl: runtimeModel?.baseUrl ?? config.baseUrl,
    reasoning: runtimeModel?.reasoning ?? false,
    ...(runtimeModel?.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: runtimeModel.thinkingLevelMap }),
    input: runtimeModel?.input ?? ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: runtimeModel?.contextWindow ?? input.modelLimits?.contextWindowTokens ?? 131_072,
    maxTokens: runtimeModel?.maxTokens ?? input.maxOutputTokens,
    ...(runtimeModel?.compat !== undefined
      ? { compat: runtimeModel.compat }
      : config.api === undefined || config.api === 'openai-completions'
        ? { compat: { supportsUsageInStreaming: true, maxTokensField: 'max_tokens' as const } }
        : {})
  } as Model<Api>
}

export function apiKeyForProvider(
  auth: AgentRuntimeAuth,
  configuredProviderId: string,
  providerId: string
): string | undefined {
  return providerId === configuredProviderId ? auth.apiKey : undefined
}

export async function loadAgentStreamSimple(api: Api): Promise<ProviderStreams['streamSimple']> {
  switch (api) {
    case 'openai-completions':
      return (await import('@earendil-works/pi-ai/api/openai-completions')).streamSimple
    case 'openai-responses':
      return (await import('@earendil-works/pi-ai/api/openai-responses')).streamSimple
    case 'openai-codex-responses':
      return (await import('@earendil-works/pi-ai/api/openai-codex-responses')).streamSimple
    case 'azure-openai-responses':
      return (await import('@earendil-works/pi-ai/api/azure-openai-responses')).streamSimple
    case 'anthropic-messages':
      return (await import('@earendil-works/pi-ai/api/anthropic-messages')).streamSimple
    case 'google-generative-ai':
      return (await import('@earendil-works/pi-ai/api/google-generative-ai')).streamSimple
    case 'google-vertex':
      return (await import('@earendil-works/pi-ai/api/google-vertex')).streamSimple
    case 'mistral-conversations':
      return (await import('@earendil-works/pi-ai/api/mistral-conversations')).streamSimple
    case 'bedrock-converse-stream':
      return (await import('@earendil-works/pi-ai/api/bedrock-converse-stream')).streamSimple
    case 'pi-messages':
      return (await import('@earendil-works/pi-ai/api/pi-messages')).streamSimple
    default:
      throw new Error(`Unsupported Agent model API: ${api}`)
  }
}
