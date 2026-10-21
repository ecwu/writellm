import { reportRendererOperationError } from '../../diagnostics'

export function reportAutocompleteError(error: unknown): void {
  reportRendererOperationError(error, 'autocomplete')
}
export function openAutocompleteSettings(): void {
  window.dispatchEvent(new Event('writellm:open-autocomplete-settings'))
}
