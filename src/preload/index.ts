import { contextBridge, ipcRenderer } from 'electron'
import { appInfoSchema, type AppInfo } from '../shared/contracts/app'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  diagnosticExportResultSchema,
  diagnosticsLevelInputSchema,
  diagnosticsSnapshotSchema,
  rendererErrorReportSchema,
  type DiagnosticExportResult,
  type DiagnosticsLevelInput,
  type DiagnosticsSnapshot,
  type RendererErrorReport
} from '../shared/contracts/diagnostics'
import { diagnosticLogSchema, type DiagnosticLog } from '../shared/observability/log-schema'

export interface DesktopApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  diagnostics: {
    snapshot(): Promise<DiagnosticsSnapshot>
    reportRendererError(report: RendererErrorReport): void
    setLevel(input: DiagnosticsLevelInput): Promise<void>
    openLogsDirectory(): Promise<void>
    exportBundle(): Promise<DiagnosticExportResult>
    subscribe(listener: (entry: DiagnosticLog) => void): () => void
  }
}

const desktopApi: DesktopApi = {
  app: {
    async getInfo() {
      return appInfoSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.appGetInfo))
    }
  },
  diagnostics: {
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
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
