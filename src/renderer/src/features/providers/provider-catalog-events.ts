import type { ProviderSettingsSnapshot } from '../../../../shared/contracts/providers'

export const PROVIDER_CATALOG_CHANGED_EVENT = 'writellm:provider-catalog-changed'

export type ProviderCatalogChangedListener = (snapshot: ProviderSettingsSnapshot) => void

export function notifyProviderCatalogChanged(
  snapshot: ProviderSettingsSnapshot,
  target: EventTarget = window
): void {
  target.dispatchEvent(
    new CustomEvent<ProviderSettingsSnapshot>(PROVIDER_CATALOG_CHANGED_EVENT, {
      detail: snapshot
    })
  )
}

export function subscribeProviderCatalogChanged(
  listener: ProviderCatalogChangedListener,
  target: EventTarget = window
): () => void {
  const handler = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    listener(event.detail)
  }
  target.addEventListener(PROVIDER_CATALOG_CHANGED_EVENT, handler)
  return () => target.removeEventListener(PROVIDER_CATALOG_CHANGED_EVENT, handler)
}
