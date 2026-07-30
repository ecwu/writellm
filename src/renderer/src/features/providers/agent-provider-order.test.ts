import { describe, expect, it } from 'vitest'
import { orderEnabledAgentProvidersFirst } from './agent-provider-order'

describe('orderEnabledAgentProvidersFirst', () => {
  it('places enabled providers first while preserving order inside each group', () => {
    const presets = [
      { presetId: 'disabled-a', enabled: false },
      { presetId: 'enabled-b', enabled: true },
      { presetId: 'disabled-c', enabled: false },
      { presetId: 'enabled-d', enabled: true }
    ]

    expect(orderEnabledAgentProvidersFirst(presets).map((preset) => preset.presetId)).toEqual([
      'enabled-b',
      'enabled-d',
      'disabled-a',
      'disabled-c'
    ])
  })

  it('does not mutate the catalog order', () => {
    const presets = [
      { presetId: 'disabled-a', enabled: false },
      { presetId: 'enabled-b', enabled: true }
    ]

    orderEnabledAgentProvidersFirst(presets)

    expect(presets.map((preset) => preset.presetId)).toEqual(['disabled-a', 'enabled-b'])
  })
})
