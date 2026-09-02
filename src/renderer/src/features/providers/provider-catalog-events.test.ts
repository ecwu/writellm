import { describe, expect, it, vi } from 'vitest'
import type { ProviderSettingsSnapshot } from '../../../../shared/contracts/providers'
import {
  notifyProviderCatalogChanged,
  PROVIDER_CATALOG_CHANGED_EVENT,
  subscribeProviderCatalogChanged
} from './provider-catalog-events'

describe('Provider catalog Renderer events', () => {
  it('notifies active consumers and stops after unsubscribe', () => {
    const target = new EventTarget()
    const listener = vi.fn<(snapshot: ProviderSettingsSnapshot) => void>()
    const unsubscribe = subscribeProviderCatalogChanged(listener, target)
    const snapshot = {
      agentCatalog: { presets: [], defaultSelection: null }
    } as unknown as ProviderSettingsSnapshot

    notifyProviderCatalogChanged(snapshot, target)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(snapshot)
    expect(PROVIDER_CATALOG_CHANGED_EVENT).toBe('writellm:provider-catalog-changed')

    unsubscribe()
    notifyProviderCatalogChanged(snapshot, target)
    expect(listener).toHaveBeenCalledOnce()
  })
})
