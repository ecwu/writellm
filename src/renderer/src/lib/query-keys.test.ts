import { describe, expect, it } from 'vitest'
import { rendererQueryKeys } from './query-keys'

describe('rendererQueryKeys', () => {
  it('keeps project version history caches scoped to the project session', () => {
    const first = rendererQueryKeys.projectVersionHistory.checkpoints('session-a')
    const second = rendererQueryKeys.projectVersionHistory.checkpoints('session-b')

    expect(first).not.toEqual(second)
    expect(first[1]).toBe('session-a')
    expect(second[1]).toBe('session-b')
  })

  it('shares the provider settings key with other application-wide consumers', () => {
    expect(rendererQueryKeys.settings.providers).toEqual(['provider-settings'])
  })
})
