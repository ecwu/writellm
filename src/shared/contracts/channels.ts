export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  diagnosticsSnapshot: 'diagnostics:snapshot',
  diagnosticsEvent: 'diagnostics:event',
  diagnosticsReportRendererError: 'diagnostics:report-renderer-error',
  diagnosticsSetLevel: 'diagnostics:set-level',
  diagnosticsOpenLogs: 'diagnostics:open-logs',
  diagnosticsExport: 'diagnostics:export'
} as const
