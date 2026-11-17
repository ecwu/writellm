import { resolveModelsDevProviderLogoId } from '../../../../shared/models-dev-provider-logos'
import type { ImageProviderId } from '../../../../shared/contracts/providers'

const transportLogoIds: Record<ImageProviderId, string> = {
  'google-gemini': 'google',
  'google-vertex': 'google-vertex',
  openai: 'openai',
  xai: 'xai'
}

export function imageSourceLogoId(source: {
  providerId: ImageProviderId
  name: string
  baseUrl: string
}): string | null {
  if (source.baseUrl === '') return transportLogoIds[source.providerId]
  return (
    resolveModelsDevProviderLogoId({
      providerId: '',
      name: source.name,
      baseUrl: source.baseUrl
    }) ?? transportLogoIds[source.providerId]
  )
}
