import { useEffect, useRef } from 'react'
import { reportRendererOperationError } from '../diagnostics'

type SubscriptionRelease = (() => void) | { unsubscribe: () => void }

export interface DesktopSubscriptionOptions {
  source: string
  enabled?: boolean
  dependencies?: readonly unknown[]
  onError?: (error: unknown) => void
}

/**
 * Owns the async subscribe/release race shared by Main-backed Renderer subscriptions.
 * A subscription that resolves after unmount is released immediately.
 */
export function useDesktopSubscription<T>(
  subscribe: (listener: (event: T) => void) => Promise<SubscriptionRelease>,
  listener: (event: T) => void,
  options: DesktopSubscriptionOptions
): void {
  const subscribeRef = useRef(subscribe)
  const listenerRef = useRef(listener)
  const onErrorRef = useRef(options.onError)
  subscribeRef.current = subscribe
  listenerRef.current = listener
  onErrorRef.current = options.onError

  const enabled = options.enabled ?? true
  const dependencies = options.dependencies ?? []
  useEffect(() => {
    if (!enabled) return

    let disposed = false
    let release: (() => void) | undefined
    const source = options.source
    void subscribeRef
      .current((event) => {
        if (!disposed) listenerRef.current(event)
      })
      .then((subscription) => {
        const nextRelease =
          typeof subscription === 'function' ? subscription : subscription.unsubscribe
        if (disposed) nextRelease()
        else release = nextRelease
      })
      .catch((error: unknown) => {
        reportRendererOperationError(error, source)
        if (!disposed) onErrorRef.current?.(error)
      })

    return () => {
      disposed = true
      release?.()
    }
    // The caller supplies values that identify the subscription lifetime. The subscribe and
    // listener refs keep callbacks fresh without restarting the subscription on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, options.source, ...dependencies])
}
