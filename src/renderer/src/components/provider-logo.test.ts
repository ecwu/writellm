import { describe, expect, it } from 'vitest'
import { MODELS_DEV_PROVIDER_LOGOS } from '../../../shared/models-dev-provider-logos'
import { providerLogoAssetUrl } from './provider-logo'

describe('provider logo asset resolution', () => {
  it('resolves every catalog provider through the bundled asset map', () => {
    for (const provider of MODELS_DEV_PROVIDER_LOGOS) {
      expect(providerLogoAssetUrl(provider.id), provider.id).toBeTruthy()
    }
    expect(providerLogoAssetUrl('togetherai')).not.toBeNull()
  })

  it('resolves deduplicated aliases to their shared asset', () => {
    const alibaba = providerLogoAssetUrl('alibaba')
    expect(alibaba).not.toBeNull()
    expect(providerLogoAssetUrl('alibaba-coding-plan')).toBe(alibaba)
    expect(providerLogoAssetUrl('alibaba-coding-plan-cn')).toBe(alibaba)
    expect(providerLogoAssetUrl('alibaba-token-plan')).toBe(alibaba)
  })

  it('uses the initial fallback for unknown provider IDs', () => {
    expect(providerLogoAssetUrl('unknown-provider')).toBeNull()
  })
})
