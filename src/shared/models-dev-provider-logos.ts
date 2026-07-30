import {
  MODELS_DEV_PROVIDER_LOGOS,
  type ModelsDevProviderLogoId
} from './models-dev-provider-logos.generated'

const logoById = new Map(MODELS_DEV_PROVIDER_LOGOS.map((provider) => [provider.id, provider]))
const logoIds = new Set<string>(logoById.keys())

const providerAliases: Readonly<Record<string, ModelsDevProviderLogoId>> = {
  'ant-ling': 'bailing',
  'azure-openai-responses': 'azure',
  fireworks: 'fireworks-ai',
  'kimi-coding': 'kimi-for-coding',
  'openai-codex': 'openai',
  'openrouter-images': 'openrouter',
  together: 'togetherai',
  'vercel-ai-gateway': 'vercel',
  'zai-coding-cn': 'zai-coding-plan'
}

export interface ProviderLogoResolutionInput {
  providerId: string
  name: string
  baseUrl?: string
  logoOverrideId?: string | null
}

export function isModelsDevProviderLogoId(value: string): value is ModelsDevProviderLogoId {
  return logoIds.has(value)
}

export function resolveModelsDevProviderLogoId({
  providerId,
  name,
  baseUrl,
  logoOverrideId
}: ProviderLogoResolutionInput): ModelsDevProviderLogoId | null {
  if (logoOverrideId !== undefined && logoOverrideId !== null) {
    return isModelsDevProviderLogoId(logoOverrideId) ? logoOverrideId : null
  }
  if (isModelsDevProviderLogoId(providerId)) return providerId
  const alias = providerAliases[providerId]
  if (alias !== undefined && isModelsDevProviderLogoId(alias)) return alias

  const normalizedBaseUrl = normalizeUrl(baseUrl)
  if (normalizedBaseUrl !== null) {
    const endpointMatches = MODELS_DEV_PROVIDER_LOGOS.filter(
      (provider) => provider.api === normalizedBaseUrl
    )
    if (endpointMatches.length === 1) return endpointMatches[0]?.id ?? null
  }

  const normalizedName = normalizeIdentity(name)
  if (normalizedName === '') return null
  const nameMatches = MODELS_DEV_PROVIDER_LOGOS.filter((provider) => {
    const identities = [normalizeIdentity(provider.id), normalizeIdentity(provider.name)].filter(
      (identity) => identity.length >= 4
    )
    return identities.some(
      (identity) => normalizedName === identity || normalizedName.includes(identity)
    )
  })
  return nameMatches.length === 1 ? (nameMatches[0]?.id ?? null) : null
}

function normalizeIdentity(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
}

function normalizeUrl(value: string | undefined): string | null {
  if (value === undefined) return null
  try {
    const parsed = new URL(value)
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.origin}${path}`
  } catch {
    return null
  }
}

export { MODELS_DEV_PROVIDER_LOGOS }
export type { ModelsDevProviderLogoId }
