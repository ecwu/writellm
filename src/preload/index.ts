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
import {
  projectCreateInputSchema,
  projectLifecycleEventSchema,
  projectLifecycleSnapshotSchema,
  recentProjectOpenInputSchema,
  recentProjectsSchema,
  projectSelectionResultSchema,
  projectSessionInputSchema,
  type ProjectCreateInput,
  type ProjectLifecycleEvent,
  type ProjectLifecycleSnapshot,
  type ProjectSelectionResult,
  type RecentProjectOpenInput,
  type RecentProjects,
  type ProjectSessionInput
} from '../shared/contracts/projects'
import { diagnosticLogSchema, type DiagnosticLog } from '../shared/observability/log-schema'

export interface DesktopApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  projects: {
    lifecycle(): Promise<ProjectLifecycleSnapshot>
    recent(): Promise<RecentProjects>
    create(input: ProjectCreateInput): Promise<ProjectSelectionResult>
    open(): Promise<ProjectSelectionResult>
    openRecent(input: RecentProjectOpenInput): Promise<ProjectSelectionResult>
    close(input: ProjectSessionInput): Promise<ProjectLifecycleSnapshot>
    switch(input: ProjectSessionInput): Promise<ProjectSelectionResult>
    subscribe(
      input: ProjectSessionInput,
      listener: (event: ProjectLifecycleEvent) => void
    ): Promise<() => void>
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
  projects: {
    async lifecycle() {
      return projectLifecycleSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.projectGetLifecycle)
      )
    },
    async recent() {
      return recentProjectsSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectGetRecent))
    },
    async create(input) {
      return projectSelectionResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.projectCreate, projectCreateInputSchema.parse(input))
      )
    },
    async open() {
      return projectSelectionResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectOpen))
    },
    async openRecent(input) {
      return projectSelectionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectOpenRecent,
          recentProjectOpenInputSchema.parse(input)
        )
      )
    },
    async close(input) {
      return projectLifecycleSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.projectClose, projectSessionInputSchema.parse(input))
      )
    },
    async switch(input) {
      return projectSelectionResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.projectSwitch, projectSessionInputSchema.parse(input))
      )
    },
    async subscribe(input, listener) {
      const parsedInput = projectSessionInputSchema.parse(input)
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const lifecycleEvent = projectLifecycleEventSchema.parse(value)
        if (lifecycleEvent.projectSessionId === parsedInput.projectSessionId) {
          listener(lifecycleEvent)
        }
      }
      ipcRenderer.on(IPC_CHANNELS.projectLifecycleEvent, handler)
      try {
        await ipcRenderer.invoke(IPC_CHANNELS.projectSubscribeLifecycle, parsedInput)
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.projectLifecycleEvent, handler)
        throw err
      }
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.projectLifecycleEvent, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.projectUnsubscribeLifecycle, parsedInput)
      }
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
