export function reportAutocompleteError(error: unknown): void {
  const original =
    error instanceof Error ? error : new Error('Autocomplete failed', { cause: error })
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.error',
    source: 'autocomplete',
    message: original.message,
    stack: original.stack
  })
}
export function openAutocompleteSettings(): void {
  window.dispatchEvent(new Event('writellm:open-autocomplete-settings'))
}
