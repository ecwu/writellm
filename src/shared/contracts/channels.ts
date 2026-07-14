export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  projectCreate: 'project:create',
  projectOpen: 'project:open',
  projectClose: 'project:close',
  projectSwitch: 'project:switch',
  projectGetLifecycle: 'project:get-lifecycle',
  projectGetRecent: 'project:get-recent',
  projectOpenRecent: 'project:open-recent',
  projectSubscribeLifecycle: 'project:subscribe-lifecycle',
  projectUnsubscribeLifecycle: 'project:unsubscribe-lifecycle',
  projectLifecycleEvent: 'project:lifecycle-event',
  diagnosticsSnapshot: 'diagnostics:snapshot',
  diagnosticsEvent: 'diagnostics:event',
  diagnosticsReportRendererError: 'diagnostics:report-renderer-error',
  diagnosticsSetLevel: 'diagnostics:set-level',
  diagnosticsOpenLogs: 'diagnostics:open-logs',
  diagnosticsExport: 'diagnostics:export'
} as const
