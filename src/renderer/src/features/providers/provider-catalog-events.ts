export const PROVIDER_CATALOG_CHANGED_EVENT = 'writellm:provider-catalog-changed'

export function notifyProviderCatalogChanged(target: EventTarget = window): void {
  target.dispatchEvent(new Event(PROVIDER_CATALOG_CHANGED_EVENT))
}

export function subscribeProviderCatalogChanged(
  listener: () => void,
  target: EventTarget = window
): () => void {
  target.addEventListener(PROVIDER_CATALOG_CHANGED_EVENT, listener)
  return () => target.removeEventListener(PROVIDER_CATALOG_CHANGED_EVENT, listener)
}
