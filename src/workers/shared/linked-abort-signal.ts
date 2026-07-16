export function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController
): () => void {
  if (source === undefined) return () => undefined
  const abort = (): void => target.abort(source.reason)
  if (source.aborted) {
    abort()
    return () => undefined
  }
  source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}
