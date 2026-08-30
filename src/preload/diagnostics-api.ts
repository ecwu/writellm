import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  diagnosticExportResultSchema,
  diagnosticsLevelInputSchema,
  diagnosticsSnapshotSchema,
  rendererErrorReportSchema
} from '../shared/contracts/diagnostics'
import { diagnosticLogSchema } from '../shared/observability/log-schema'
import type { DesktopApi } from './desktop-api'

export const diagnosticsApi: DesktopApi['diagnostics'] = {
  async snapshot() {
    return diagnosticsSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.diagnosticsSnapshot)
    )
  },
  reportRendererError(report) {
    ipcRenderer.send(
      IPC_CHANNELS.diagnosticsReportRendererError,
      rendererErrorReportSchema.parse(report)
    )
  },
  async setLevel(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.diagnosticsSetLevel,
      diagnosticsLevelInputSchema.parse(input)
    )
  },
  async openLogsDirectory() {
    await ipcRenderer.invoke(IPC_CHANNELS.diagnosticsOpenLogs)
  },
  async exportBundle() {
    return diagnosticExportResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.diagnosticsExport)
    )
  },
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown): void => {
      listener(diagnosticLogSchema.parse(input))
    }
    ipcRenderer.on(IPC_CHANNELS.diagnosticsEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.diagnosticsEvent, handler)
  }
}
