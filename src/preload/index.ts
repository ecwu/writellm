import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  appInfoSchema,
  setThemePreferenceInputSchema,
  themePreferenceSchema,
  type AppInfo,
  type SetThemePreferenceInput,
  type ThemePreference
} from '../shared/contracts/app'
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
  projectRecoveryActionInputSchema,
  projectSnapshotResultSchema,
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
  knowledgeImportPathsInputSchema,
  knowledgeItemActionInputSchema,
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  parsedKnowledgeAssetInputSchema,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeDocumentSchema,
  type ParsedKnowledgeDocument,
  type KnowledgeItem
} from '../shared/contracts/knowledge'
import {
  createSectionRequestSchema,
  deleteSectionRequestSchema,
  editorFlushAckInputSchema,
  editorFlushRequestSchema,
  editorFlushSubscriptionInputSchema,
  editorSectionSchema,
  editorSessionInputSchema,
  exportMarkdownInputSchema,
  exportNativeJsonInputSchema,
  exportResultSchema,
  finalFlushSaveInputSchema,
  importMarkdownInputSchema,
  loadSectionInputSchema,
  manuscriptAssemblySchema,
  manuscriptWorkspaceInputSchema,
  manuscriptWorkspaceSchema,
  moveSectionRequestSchema,
  openEditorResultSchema,
  saveSectionDocumentInputSchema,
  saveSectionDocumentResponseSchema,
  updateManuscriptBriefRequestSchema,
  updateSectionRequestSchema,
  type CreateSectionRequest,
  type DeleteSectionRequest,
  type EditorFlushRequest,
  type ManuscriptAssembly,
  type ManuscriptWorkspace,
  type ManuscriptWorkspaceInput,
  type MoveSectionRequest,
  type SaveSectionDocumentInput,
  type SaveSectionDocumentResponse,
  type UpdateManuscriptBriefRequest,
  type UpdateSectionRequest
} from '../shared/contracts/manuscript'
import {
  providerConnectionTestResultSchema,
  providerRoleInputSchema,
  providerSaveInputSchema,
  providerSettingsSnapshotSchema,
  type ProviderConnectionTestResult,
  type ProviderRoleInput,
  type ProviderSaveInput,
  type ProviderSettingsSnapshot
} from '../shared/contracts/providers'
import {
  citationExpansionInputSchema,
  citationExpansionResultSchema,
  knowledgeSearchInputSchema,
  knowledgeSearchResultSchema,
  type ExpandedCitation,
  type KnowledgeSearchInput,
  type KnowledgeSearchResult
} from '../shared/contracts/search'

export interface DesktopApi {
  app: {
    getInfo(): Promise<AppInfo>
    getThemePreference(): Promise<ThemePreference>
    setThemePreference(input: SetThemePreferenceInput): Promise<ThemePreference>
  }
  projects: {
    lifecycle(): Promise<ProjectLifecycleSnapshot>
    recent(): Promise<RecentProjects>
    create(input: ProjectCreateInput): Promise<ProjectSelectionResult>
    open(): Promise<ProjectSelectionResult>
    openRecent(input: RecentProjectOpenInput): Promise<ProjectSelectionResult>
    close(input: ProjectSessionInput): Promise<ProjectLifecycleSnapshot>
    switch(input: ProjectSessionInput): Promise<ProjectSelectionResult>
    retryOpen(): Promise<ProjectLifecycleSnapshot>
    retryClose(): Promise<ProjectLifecycleSnapshot>
    discardIncompleteCreate(): Promise<ProjectLifecycleSnapshot>
    locateMoved(): Promise<ProjectSelectionResult>
    exportRecoveryDiagnostics(): Promise<{ exported: boolean }>
    returnToClosed(): Promise<ProjectLifecycleSnapshot>
    createSnapshot(input: ProjectSessionInput): Promise<{ created: boolean }>
    restoreSnapshot(): Promise<ProjectSelectionResult>
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
    setActiveSection(input: { projectSessionId: string; sectionId: string }): Promise<void>
    saveSectionDocument(
      input: SaveSectionDocumentInput & { projectSessionId: string }
    ): Promise<SaveSectionDocumentResponse>
    importMarkdown(
      input: SaveSectionDocumentInput & { projectSessionId: string }
    ): Promise<SaveSectionDocumentResponse>
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
      input: SaveSectionDocumentInput & {
        projectSessionId: string
        closingToken: string
        purpose?: 'close' | 'snapshot'
      }
    ): Promise<SaveSectionDocumentResponse>
    acknowledgeFlush(
      input: EditorFlushRequest & { sectionId: string; sectionRevisionId: string }
    ): Promise<void>
    subscribeFlush(
      input: { projectSessionId: string },
      listener: (request: EditorFlushRequest) => void
    ): Promise<() => void>
  }
  manuscript: {
    workspace(input: ManuscriptWorkspaceInput): Promise<ManuscriptWorkspace>
    preview(input: ManuscriptWorkspaceInput): Promise<ManuscriptAssembly>
    updateBrief(input: UpdateManuscriptBriefRequest): Promise<ManuscriptWorkspace>
    createSection(input: CreateSectionRequest): Promise<ManuscriptWorkspace>
    updateSection(input: UpdateSectionRequest): Promise<ManuscriptWorkspace>
    moveSection(input: MoveSectionRequest): Promise<ManuscriptWorkspace>
    deleteSection(input: DeleteSectionRequest): Promise<ManuscriptWorkspace>
  }
  knowledge: {
    list(input: { projectSessionId: string }): Promise<KnowledgeItem[]>
    chooseAndImport(input: { projectSessionId: string }): Promise<KnowledgeItem[]>
    importDropped(input: { projectSessionId: string; files: File[] }): Promise<KnowledgeItem[]>
    cancel(input: { projectSessionId: string; knowledgeItemId: string }): Promise<KnowledgeItem[]>
    delete(input: { projectSessionId: string; knowledgeItemId: string }): Promise<KnowledgeItem[]>
    reveal(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    openOriginal(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    startParse(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    cancelParse(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    parsedDocument(input: {
      projectSessionId: string
      knowledgeItemId: string
    }): Promise<ParsedKnowledgeDocument>
    parsedAsset(input: {
      projectSessionId: string
      knowledgeItemId: string
      parseRevisionId: string
      assetRef: string
    }): Promise<{ mimeType: string; dataBase64: string }>
    search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult>
    expandCitations(input: {
      projectSessionId: string
      citationIds: string[]
    }): Promise<ExpandedCitation[]>
  }
  providers: {
    snapshot(): Promise<ProviderSettingsSnapshot>
    save(input: ProviderSaveInput): Promise<ProviderSettingsSnapshot>
    remove(input: ProviderRoleInput): Promise<ProviderSettingsSnapshot>
    testConnection(input: ProviderRoleInput): Promise<ProviderConnectionTestResult>
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
    },
    async getThemePreference() {
      return themePreferenceSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.appGetThemePreference)
      )
    },
    async setThemePreference(input) {
      return themePreferenceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.appSetThemePreference,
          setThemePreferenceInputSchema.parse(input)
        )
      )
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
    async retryOpen() {
      return projectLifecycleSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectRecoveryRetryOpen,
          projectRecoveryActionInputSchema.parse({})
        )
      )
    },
    async retryClose() {
      return projectLifecycleSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectRecoveryRetryClose,
          projectRecoveryActionInputSchema.parse({})
        )
      )
    },
    async discardIncompleteCreate() {
      return projectLifecycleSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectRecoveryDiscardIncompleteCreate,
          projectRecoveryActionInputSchema.parse({})
        )
      )
    },
    async locateMoved() {
      return projectSelectionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectRecoveryLocateMoved,
          projectRecoveryActionInputSchema.parse({})
        )
      )
    },
    async exportRecoveryDiagnostics() {
      return diagnosticExportResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectRecoveryExportDiagnostics,
          projectRecoveryActionInputSchema.parse({})
        )
      )
    },
    async returnToClosed() {
      return projectLifecycleSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectRecoveryReturnToClosed,
          projectRecoveryActionInputSchema.parse({})
        )
      )
    },
    async createSnapshot(input) {
      return projectSnapshotResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectSnapshotCreate,
          projectSessionInputSchema.parse(input)
        )
      )
    },
    async restoreSnapshot() {
      return projectSelectionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectSnapshotRestore,
          projectRecoveryActionInputSchema.parse({})
        )
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
    async setActiveSection(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorSetActiveSection,
        loadSectionInputSchema.parse(input)
      )
    },
    async saveSectionDocument(input) {
      return saveSectionDocumentResponseSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorSaveSectionDocument,
          saveSectionDocumentInputSchema.parse(input)
        )
      )
    },
    async importMarkdown(input) {
      return saveSectionDocumentResponseSchema.parse(
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
      return saveSectionDocumentResponseSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorFinalFlushSave,
          finalFlushSaveInputSchema.parse(input)
        )
      )
    },
    async acknowledgeFlush(input) {
      await ipcRenderer.invoke(IPC_CHANNELS.editorFlushAck, editorFlushAckInputSchema.parse(input))
    },
    async subscribeFlush(input, listener) {
      const session = editorSessionInputSchema.parse(input)
      const parsed = editorFlushSubscriptionInputSchema.parse({
        ...session,
        subscriptionId: globalThis.crypto.randomUUID()
      })
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const request = editorFlushRequestSchema.parse(value)
        if (request.projectSessionId === session.projectSessionId) listener(request)
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
  manuscript: {
    async workspace(input) {
      return manuscriptWorkspaceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptGetWorkspace,
          manuscriptWorkspaceInputSchema.parse(input)
        )
      )
    },
    async preview(input) {
      return manuscriptAssemblySchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptGetPreview,
          manuscriptWorkspaceInputSchema.parse(input)
        )
      )
    },
    async updateBrief(input) {
      return manuscriptWorkspaceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptUpdateBrief,
          updateManuscriptBriefRequestSchema.parse(input)
        )
      )
    },
    async createSection(input) {
      return manuscriptWorkspaceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptCreateSection,
          createSectionRequestSchema.parse(input)
        )
      )
    },
    async updateSection(input) {
      return manuscriptWorkspaceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptUpdateSection,
          updateSectionRequestSchema.parse(input)
        )
      )
    },
    async moveSection(input) {
      return manuscriptWorkspaceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptMoveSection,
          moveSectionRequestSchema.parse(input)
        )
      )
    },
    async deleteSection(input) {
      return manuscriptWorkspaceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptDeleteSection,
          deleteSectionRequestSchema.parse(input)
        )
      )
    }
  },
  knowledge: {
    async list(input) {
      return knowledgeListResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.knowledgeList, knowledgeListInputSchema.parse(input))
      )
    },
    async chooseAndImport(input) {
      return knowledgeListResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeChooseAndImport,
          knowledgeListInputSchema.parse(input)
        )
      )
    },
    async importDropped(input) {
      const paths = input.files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
      return knowledgeListResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeImportDropped,
          knowledgeImportPathsInputSchema.parse({
            projectSessionId: input.projectSessionId,
            paths
          })
        )
      )
    },
    async cancel(input) {
      return knowledgeListResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeCancel,
          knowledgeItemActionInputSchema.parse(input)
        )
      )
    },
    async delete(input) {
      return knowledgeListResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeDelete,
          knowledgeItemActionInputSchema.parse(input)
        )
      )
    },
    async reveal(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeReveal,
        knowledgeItemActionInputSchema.parse(input)
      )
    },
    async openOriginal(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeOpenOriginal,
        knowledgeItemActionInputSchema.parse(input)
      )
    },
    async startParse(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeStartParse,
        knowledgeItemActionInputSchema.parse(input)
      )
    },
    async cancelParse(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeCancelParse,
        knowledgeItemActionInputSchema.parse(input)
      )
    },
    async parsedDocument(input) {
      return parsedKnowledgeDocumentSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeParsedDocument,
          knowledgeItemActionInputSchema.parse(input)
        )
      )
    },
    async parsedAsset(input) {
      return parsedKnowledgeAssetSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeParsedAsset,
          parsedKnowledgeAssetInputSchema.parse(input)
        )
      )
    },
    async search(input) {
      return knowledgeSearchResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeSearch,
          knowledgeSearchInputSchema.parse(input)
        )
      )
    },
    async expandCitations(input) {
      return citationExpansionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeExpandCitations,
          citationExpansionInputSchema.parse(input)
        )
      )
    }
  },
  providers: {
    async snapshot() {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.providersSnapshot)
      )
    },
    async save(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.providersSave, providerSaveInputSchema.parse(input))
      )
    },
    async remove(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.providersRemove, providerRoleInputSchema.parse(input))
      )
    },
    async testConnection(input) {
      return providerConnectionTestResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersTestConnection,
          providerRoleInputSchema.parse(input)
        )
      )
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
