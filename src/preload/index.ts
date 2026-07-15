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
import {
  jobStatusEventSchema,
  jobStatusInputSchema,
  jobStatusSchema,
  listJobsInputSchema,
  listJobsResultSchema,
  type JobStatus,
  type JobStatusEvent,
  type JobStatusInput,
  type ListJobsInput,
  type ListJobsResult
} from '../shared/contracts/jobs'
import {
  editorFlushRequestSchema,
  editorSectionSchema,
  editorSessionInputSchema,
  exportMarkdownInputSchema,
  exportNativeJsonInputSchema,
  exportResultSchema,
  finalFlushSaveInputSchema,
  importMarkdownInputSchema,
  loadSectionInputSchema,
  openEditorResultSchema,
  saveSectionDocumentInputSchema,
  saveSectionDocumentResultSchema,
  type EditorFlushRequest,
  type SaveSectionDocumentInput,
  type SaveSectionDocumentResult
} from '../shared/contracts/manuscript'

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
  jobs: {
    list(input: ListJobsInput): Promise<ListJobsResult>
    status(input: JobStatusInput): Promise<JobStatus>
    cancel(input: JobStatusInput): Promise<JobStatus>
    subscribe(
      input: { projectSessionId: string },
      listener: (event: JobStatusEvent) => void
    ): Promise<() => void>
  }
  editor: {
    open(input: {
      projectSessionId: string
    }): Promise<ReturnType<typeof openEditorResultSchema.parse>>
    loadSection(input: {
      projectSessionId: string
      sectionId: string
    }): Promise<ReturnType<typeof editorSectionSchema.parse>>
    saveSectionDocument(
      input: SaveSectionDocumentInput & { projectSessionId: string }
    ): Promise<SaveSectionDocumentResult>
    importMarkdown(
      input: SaveSectionDocumentInput & { projectSessionId: string }
    ): Promise<SaveSectionDocumentResult>
    exportNativeJson(input: {
      projectSessionId: string
      sectionId: string
    }): Promise<{ relativePath: string }>
    exportMarkdown(input: {
      projectSessionId: string
      sectionId: string
      sectionRevisionId: string
      contentHash: string
      markdown: string
    }): Promise<{ relativePath: string }>
    finalFlushSave(
      input: SaveSectionDocumentInput & { projectSessionId: string; closingToken: string }
    ): Promise<SaveSectionDocumentResult>
    acknowledgeFlush(input: EditorFlushRequest & { sectionRevisionId: string }): Promise<void>
    subscribeFlush(
      input: { projectSessionId: string },
      listener: (request: EditorFlushRequest) => void
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
  jobs: {
    async list(input) {
      return listJobsResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.jobsList, listJobsInputSchema.parse(input))
      )
    },
    async status(input) {
      return jobStatusSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.jobsGetStatus, jobStatusInputSchema.parse(input))
      )
    },
    async cancel(input) {
      return jobStatusSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.jobsRequestCancellation,
          jobStatusInputSchema.parse(input)
        )
      )
    },
    async subscribe(input, listener) {
      const parsedInput = jobStatusInputSchema.omit({ jobId: true }).parse(input)
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const statusEvent = jobStatusEventSchema.parse(value)
        if (statusEvent.projectSessionId === parsedInput.projectSessionId) listener(statusEvent)
      }
      ipcRenderer.on(IPC_CHANNELS.jobsStatusEvent, handler)
      try {
        await ipcRenderer.invoke(IPC_CHANNELS.jobsSubscribeStatus, parsedInput)
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.jobsStatusEvent, handler)
        throw err
      }
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.jobsStatusEvent, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.jobsUnsubscribeStatus, parsedInput)
      }
    }
  },
  editor: {
    async open(input) {
      return openEditorResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.editorOpen, editorSessionInputSchema.parse(input))
      )
    },
    async loadSection(input) {
      return editorSectionSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorLoadSection,
          loadSectionInputSchema.parse(input)
        )
      )
    },
    async saveSectionDocument(input) {
      return saveSectionDocumentResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorSaveSectionDocument,
          saveSectionDocumentInputSchema.parse(input)
        )
      )
    },
    async importMarkdown(input) {
      return saveSectionDocumentResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorImportMarkdown,
          importMarkdownInputSchema.parse(input)
        )
      )
    },
    async exportNativeJson(input) {
      return exportResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorExportNativeJson,
          exportNativeJsonInputSchema.parse(input)
        )
      )
    },
    async exportMarkdown(input) {
      return exportResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorExportMarkdown,
          exportMarkdownInputSchema.parse(input)
        )
      )
    },
    async finalFlushSave(input) {
      return saveSectionDocumentResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorFinalFlushSave,
          finalFlushSaveInputSchema.parse(input)
        )
      )
    },
    async acknowledgeFlush(input) {
      await ipcRenderer.invoke(IPC_CHANNELS.editorFlushAck, input)
    },
    async subscribeFlush(input, listener) {
      const parsed = editorSessionInputSchema.parse(input)
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const request = editorFlushRequestSchema.parse(value)
        if (request.projectSessionId === parsed.projectSessionId) listener(request)
      }
      ipcRenderer.on(IPC_CHANNELS.editorFlushRequest, handler)
      try {
        await ipcRenderer.invoke(IPC_CHANNELS.editorSubscribeFlush, parsed)
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.editorFlushRequest, handler)
        throw err
      }
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.editorFlushRequest, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.editorUnsubscribeFlush, parsed)
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
