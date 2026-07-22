export const WINDOW_PRESENTATION_ENV = 'WRITELLM_E2E_WINDOW_MODE'

export type WindowPresentation = 'interactive' | 'silent-e2e'

/**
 * Resolves the application window presentation once during Main bootstrap.
 * Normal launches remain interactive when the environment is absent.
 */
export function resolveWindowPresentation(raw: string | undefined): WindowPresentation {
  if (raw === undefined) return 'interactive'
  if (raw === 'interactive') return 'interactive'
  if (raw === 'silent') return 'silent-e2e'
  throw new Error(
    `${WINDOW_PRESENTATION_ENV} must be either "interactive" or "silent", received ${JSON.stringify(raw)}`
  )
}

export function isSilentWindowPresentation(
  presentation: WindowPresentation
): presentation is 'silent-e2e' {
  return presentation === 'silent-e2e'
}
