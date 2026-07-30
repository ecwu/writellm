import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isModelsDevProviderLogoId,
  MODELS_DEV_PROVIDER_LOGOS,
  resolveModelsDevProviderLogoId
} from './models-dev-provider-logos'

const forbiddenSvgPatterns = [
  /<!doctype/i,
  /<!entity/i,
  /<script[\s>]/i,
  /<foreignObject[\s>]/i,
  /<(?:iframe|object|embed|image|audio|video)[\s>]/i,
  /<style[\s>]/i,
  /\son[a-z0-9:_-]*\s*=/i,
  /\s(?:href|xlink:href)\s*=\s*["'](?!#)/i,
  /url\(\s*["']?(?!#)/i
]

describe('models.dev Provider logos', () => {
  it('packages every manifest logo with its reviewed digest', async () => {
    expect(MODELS_DEV_PROVIDER_LOGOS.length).toBeGreaterThan(100)
    for (const provider of MODELS_DEV_PROVIDER_LOGOS) {
      const svg = await readFile(
        resolve(process.cwd(), 'src/renderer/src/assets/provider-logos', `${provider.id}.svg`),
        'utf8'
      )
      expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(100 * 1_024)
      expect(createHash('sha256').update(svg.trim()).digest('hex')).toBe(provider.sha256)
      expect(forbiddenSvgPatterns.some((pattern) => pattern.test(svg))).toBe(false)
      expect(isModelsDevProviderLogoId(provider.id)).toBe(true)
    }
  })

  it('resolves exact IDs, curated aliases, endpoints, names, and explicit overrides', () => {
    expect(resolveModelsDevProviderLogoId({ providerId: 'deepseek', name: 'DeepSeek' })).toBe(
      'deepseek'
    )
    expect(resolveModelsDevProviderLogoId({ providerId: 'fireworks', name: 'Fireworks' })).toBe(
      'fireworks-ai'
    )
    expect(
      resolveModelsDevProviderLogoId({
        providerId: 'writellm-custom:deepseek',
        name: 'Legacy Agent',
        baseUrl: 'https://api.deepseek.com/'
      })
    ).toBe('deepseek')
    expect(
      resolveModelsDevProviderLogoId({
        providerId: 'writellm-custom:legacy',
        name: 'Legacy Agent - DeepSeek'
      })
    ).toBe('deepseek')
    expect(
      resolveModelsDevProviderLogoId({
        providerId: 'deepseek',
        name: 'DeepSeek',
        logoOverrideId: 'openai'
      })
    ).toBe('openai')
    expect(
      resolveModelsDevProviderLogoId({
        providerId: 'unknown',
        name: 'Unknown',
        logoOverrideId: 'not-in-the-snapshot'
      })
    ).toBeNull()
    expect(
      resolveModelsDevProviderLogoId({
        providerId: 'writellm-custom:ambiguous',
        name: 'Alibaba (China)'
      })
    ).toBeNull()
  })
})
