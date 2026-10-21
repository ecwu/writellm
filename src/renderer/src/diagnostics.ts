import { serializeAgentDiagnosticError } from '../../shared/agent-diagnostic-error'

/** Report Renderer failures. Main owns native IPC rejections before this UI callback runs. */
export function reportRendererOperationError(err: unknown, source: string): void {
  try {
    const diagnostic = serializeAgentDiagnosticError(err, 'renderer')
    if (/^Error invoking remote method '[^']+':/.test(diagnostic.message)) return
    window.desktop.diagnostics.reportRendererError({
      event: 'renderer.unhandled_rejection',
      message: diagnostic.message || 'Renderer operation failed',
      ...(diagnostic.stack ? { stack: diagnostic.stack } : {}),
      source,
      diagnostic
    })
    // error-handling: allow owner=renderer-diagnostics reason=diagnostic-channel-failure
  } catch {
    // The diagnostic channel itself failed. Do not retry it or interrupt UI recovery.
  }
}

/** Known business rejections carry fixed codes from Main; unknown errors use the caller's safe hint. */
export function manuscriptFailureMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && /\[(?:brief|outline)_version_conflict\]/.test(err.message)) {
    return 'The manuscript changed elsewhere. Refresh and try again.'
  }
  return fallback
}
