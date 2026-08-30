import { describe, expect, it, vi } from 'vitest'
import {
  notifyProviderCatalogChanged,
  PROVIDER_CATALOG_CHANGED_EVENT,
  subscribeProviderCatalogChanged
} from './provider-catalog-events'

describe('Provider catalog Renderer events', () => {
  it('notifies active consumers and stops after unsubscribe', () => {
    const target = new EventTarget()
    const listener = vi.fn()
    const unsubscribe = subscribeProviderCatalogChanged(listener, target)

    notifyProviderCatalogChanged(target)
    expect(listener).toHaveBeenCalledOnce()
    expect(PROVIDER_CATALOG_CHANGED_EVENT).toBe('writellm:provider-catalog-changed')

    unsubscribe()
    notifyProviderCatalogChanged(target)
    expect(listener).toHaveBeenCalledOnce()
  })
})
