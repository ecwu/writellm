import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  accentPreferenceSchema,
  appInfoSchema,
  setAccentPreferenceInputSchema,
  setDefaultAgentApprovalModeInputSchema,
  setThemePreferenceInputSchema,
  themePreferenceSchema,
  type AppInfo,
  type AccentPreference,
  type SetAccentPreferenceInput,
  type SetThemePreferenceInput,
  type ThemePreference,
  type SetDefaultAgentApprovalModeInput
} from '../shared/contracts/app'
import { agentApprovalModeSchema, type AgentApprovalMode } from '../shared/contracts/agent'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  cancelSkillOperationInputSchema,
  inspectGithubSkillInputSchema,
  inspectGithubSkillResultSchema,
  installSkillInputSchema,
  setSkillEnabledInputSchema,
  skillChangeEventSchema,
  skillIdInputSchema,
  skillMutationResultSchema,
  skillsSnapshotSchema,
  skillUpdateResultSchema,
  uninstallSkillInputSchema,
  updateSkillInputSchema,
  type InspectGithubSkillInput,
  type InspectGithubSkillResult,
  type InstallSkillInput,
  type SetSkillEnabledInput,
  type SkillsSnapshot,
  type SkillUpdateResult,
  type UninstallSkillInput,
  type UpdateSkillInput
} from '../shared/contracts/skills'
import {
  agentCreateSessionInputSchema,
  agentCreateSessionResultSchema,
  agentEventPageInputSchema,
  agentEventPageSchema,
  agentListProposalsResultSchema,
  agentListRunsInputSchema,
  agentListRunsResultSchema,
  agentListSessionsResultSchema,
  agentProjectInputSchema,
  agentQueueInputSchema,
  agentRendererEventSchema,
  agentRunInputSchema,
  agentSetApprovalModeInputSchema,
  agentSetApprovalModeResultSchema,
  agentSetModelSelectionInputSchema,
  agentSetModelSelectionResultSchema,
  agentSetThinkingLevelInputSchema,
  agentSetThinkingLevelResultSchema,
  agentStartRunInputSchema,
  agentStartRunResultSchema,
  agentSubscriptionInputSchema,
  type AgentEventPage,
  type AgentRendererEvent,
  type AgentRunRecord,
  type AgentSessionRecord
} from '../shared/contracts/agent-ipc'
import {
  approveMutationProposalInputSchema,
  approveMutationProposalResultSchema,
  cancelImageGenerationInputSchema,
  cancelImageGenerationResultSchema,
  mutationProposalActionResultSchema,
  mutationProposalChangedSchema,
  mutationSubscriptionInputSchema,
  rejectMutationProposalInputSchema,
  undoMutationProposalInputSchema,
  type ApproveMutationProposalResult,
  type MutationProposalActionResult,
  type MutationProposalRecord,
  type MutationProposalChanged,
  type MutationSectionChanged
} from '../shared/contracts/agent-mutations'
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
  checkpointOperationResultSchema,
  compareCheckpointStateInputSchema,
  compareCheckpointStateResultSchema,
  createCheckpointInputSchema,
  dismissVersionHistoryPromptInputSchema,
  enableVersionHistoryInputSchema,
  listCheckpointsInputSchema,
  listCheckpointsResultSchema,
  projectCreateInputSchema,
  projectLifecycleEventSchema,
  projectLifecycleSnapshotSchema,
  projectRecoveryActionInputSchema,
  projectSnapshotResultSchema,
  recentProjectOpenInputSchema,
  recentProjectsSchema,
  projectSelectionResultSchema,
  projectSessionInputSchema,
  reinitializeVersionHistoryInputSchema,
  restoreCheckpointInputSchema,
  restoreCheckpointResultSchema,
  versionHistoryStatusSchema,
  type CheckpointEntry,
  type ActiveProject,
  type CreateCheckpointInput,
  type ListCheckpointsInput,
  type ProjectCreateInput,
  type ProjectLifecycleEvent,
  type ProjectLifecycleSnapshot,
  type ProjectSelectionResult,
  type RecentProjectOpenInput,
  type RecentProjects,
  type ProjectSessionInput,
  type VersionHistoryStatus
} from '../shared/contracts/projects'
import {
  manuscriptExportInputSchema,
  manuscriptExportResultSchema,
  type ManuscriptExportKind,
  type ManuscriptExportResult
} from '../shared/contracts/manuscript-export'
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
  knowledgeEmbeddingRefreshInputSchema,
  knowledgeImportPathsInputSchema,
  knowledgeIndexStatusSchema,
  knowledgeItemActionInputSchema,
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  parsedKnowledgeAssetInputSchema,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeBlockPageInputSchema,
  parsedKnowledgeBlockPageSchema,
  parsedKnowledgeMarkdownInputSchema,
  parsedKnowledgeMarkdownSchema,
  parsedKnowledgeMetadataSchema,
  type ParsedKnowledgeBlockPage,
  type ParsedKnowledgeMarkdown,
  type ParsedKnowledgeMetadata,
  type KnowledgeIndexStatus,
  type KnowledgeItem
} from '../shared/contracts/knowledge'
import {
  knowledgeMappingPageInputSchema,
  knowledgeMappingPageSchema,
  pdfPreviewInputSchema,
  pdfPreviewReleaseInputSchema,
  pdfPreviewResultSchema,
  type KnowledgeMappingPage,
  type PdfPreviewResult
} from '../shared/contracts/knowledge-mapping'
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
  manuscriptAssetPreviewInputSchema,
  manuscriptAssetPreviewResultSchema,
  manuscriptAssetImportReferenceInputSchema,
  manuscriptAssetImportReferenceResultSchema,
  manuscriptAssetResultSchema,
  manuscriptWorkspaceInputSchema,
  manuscriptWorkspaceSchema,
  moveSectionRequestSchema,
  openEditorResultSchema,
  saveSectionDocumentInputSchema,
  saveSectionDocumentResponseSchema,
  uploadManuscriptAssetInputSchema,
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
  agentCustomPresetInputSchema,
  agentAuthFlowInputSchema,
  agentAuthInteractionEventSchema,
  agentAuthPromptResponseSchema,
  agentManualModelInputSchema,
  agentManualModelRemoveInputSchema,
  agentModelEnabledInputSchema,
  agentModelSelectionSchema,
  agentProviderEnabledInputSchema,
  agentPresetInputSchema,
  agentPresetCredentialInputSchema,
  agentPresetLoginInputSchema,
  providerConnectionTestResultSchema,
  providerRoleInputSchema,
  providerSaveInputSchema,
  providerSettingsSnapshotSchema,
  type ProviderConnectionTestResult,
  type AgentAuthFlowInput,
  type AgentAuthInteractionEvent,
  type AgentAuthPromptResponse,
  type AgentCustomPresetInput,
  type AgentManualModelInput,
  type AgentManualModelRemoveInput,
  type AgentModelEnabledInput,
  type AgentModelSelection,
  type AgentThinkingLevel,
  type AgentPresetInput,
  type AgentPresetCredentialInput,
  type AgentPresetLoginInput,
  type AgentProviderEnabledInput,
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
    getAccentPreference(): Promise<AccentPreference>
    setAccentPreference(input: SetAccentPreferenceInput): Promise<AccentPreference>
    getDefaultAgentApprovalMode(): Promise<AgentApprovalMode>
    setDefaultAgentApprovalMode(input: SetDefaultAgentApprovalModeInput): Promise<AgentApprovalMode>
  }
  skills: {
    snapshot(): Promise<SkillsSnapshot>
    inspectGithub(input: InspectGithubSkillInput): Promise<InspectGithubSkillResult>
    install(input: InstallSkillInput): Promise<SkillsSnapshot>
    setEnabled(input: SetSkillEnabledInput): Promise<SkillsSnapshot>
    checkUpdate(input: { skillId: string; operationId: string }): Promise<SkillUpdateResult>
    update(input: UpdateSkillInput): Promise<SkillsSnapshot>
    uninstall(input: UninstallSkillInput): Promise<SkillsSnapshot>
    cancelOperation(input: { operationId: string }): Promise<void>
    subscribeChanges(listener: (revision: number) => void): () => void
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
    recoverStaleLock(): Promise<ProjectLifecycleSnapshot>
    retryClose(): Promise<ProjectLifecycleSnapshot>
    discardIncompleteCreate(): Promise<ProjectLifecycleSnapshot>
    locateMoved(): Promise<ProjectSelectionResult>
    exportRecoveryDiagnostics(): Promise<{ exported: boolean }>
    returnToClosed(): Promise<ProjectLifecycleSnapshot>
    createSnapshot(input: ProjectSessionInput): Promise<{ created: boolean }>
    restoreSnapshot(): Promise<ProjectSelectionResult>
    exportManuscript(input: {
      projectSessionId: string
      kind: ManuscriptExportKind
    }): Promise<ManuscriptExportResult>
    versionHistoryStatus(input: ProjectSessionInput): Promise<VersionHistoryStatus>
    enableVersionHistory(input: ProjectSessionInput): Promise<CheckpointEntry>
    reinitializeVersionHistory(input: ProjectSessionInput): Promise<CheckpointEntry>
    dismissVersionHistoryPrompt(input: ProjectSessionInput): Promise<VersionHistoryStatus>
    createCheckpoint(input: CreateCheckpointInput): Promise<CheckpointEntry>
    listCheckpoints(
      input: ListCheckpointsInput
    ): Promise<{ checkpoints: CheckpointEntry[]; nextCursor: string | null }>
    compareCheckpointState(input: ProjectSessionInput): Promise<{
      status: 'up-to-date' | 'uncheckpointed-changes'
      headOid: string
    }>
    restoreCheckpoint(input: {
      projectSessionId: string
      oid: string
    }): Promise<{ checkpoint: CheckpointEntry; project: ActiveProject }>
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
    uploadAsset(input: {
      projectSessionId: string
      originalName: string
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
      dataBase64: string
    }): Promise<ReturnType<typeof manuscriptAssetResultSchema.parse>>
    resolveAsset(input: {
      projectSessionId: string
      assetId: string
    }): Promise<ReturnType<typeof manuscriptAssetPreviewResultSchema.parse>>
    resolveImportAsset(input: {
      projectSessionId: string
      reference: string
    }): Promise<{ logicalUrl: string }>
    finalFlushSave(
      input: SaveSectionDocumentInput & {
        projectSessionId: string
        closingToken: string
        purpose?: 'close' | 'snapshot' | 'export' | 'mutation'
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
  agent: {
    listSessions(input: { projectSessionId: string }): Promise<AgentSessionRecord[]>
    createSession(input: {
      projectSessionId: string
      title: string
      modelSelection?: AgentModelSelection | null
    }): Promise<AgentSessionRecord>
    setApprovalMode(input: {
      projectSessionId: string
      agentSessionId: string
      mode: AgentApprovalMode
    }): Promise<AgentSessionRecord>
    setModelSelection(input: {
      projectSessionId: string
      agentSessionId: string
      selection: AgentModelSelection
    }): Promise<AgentSessionRecord>
    setThinkingLevel(input: {
      projectSessionId: string
      agentSessionId: string
      level: AgentThinkingLevel
    }): Promise<AgentSessionRecord>
    listEvents(input: {
      projectSessionId: string
      agentSessionId: string
      afterSequence?: number
      limit?: number
    }): Promise<AgentEventPage>
    listRuns(input: {
      projectSessionId: string
      agentSessionId: string
      limit?: number
    }): Promise<AgentRunRecord[]>
    listProposals(input: {
      projectSessionId: string
      agentSessionId: string
    }): Promise<MutationProposalRecord[]>
    startRun(input: ReturnType<typeof agentStartRunInputSchema.parse>): Promise<AgentRunRecord>
    steerRun(input: {
      projectSessionId: string
      agentRunId: string
      content: string
    }): Promise<void>
    followUpRun(input: {
      projectSessionId: string
      agentRunId: string
      content: string
    }): Promise<void>
    abortRun(input: { projectSessionId: string; agentRunId: string }): Promise<void>
    subscribeEvents(
      input: { projectSessionId: string; agentSessionId: string; afterSequence?: number },
      listener: (event: AgentRendererEvent) => void
    ): Promise<() => void>
    approveProposal(input: {
      projectSessionId: string
      agentSessionId: string
      proposalId: string
    }): Promise<ApproveMutationProposalResult>
    rejectProposal(input: {
      projectSessionId: string
      agentSessionId: string
      proposalId: string
      reason: string
    }): Promise<MutationProposalActionResult>
    undoProposal(input: {
      projectSessionId: string
      agentSessionId: string
      proposalId: string
    }): Promise<MutationProposalActionResult>
    cancelImageGeneration(input: {
      projectSessionId: string
      agentSessionId: string
      proposalId: string
    }): Promise<{ cancelled: boolean }>
    subscribeSectionChanged(
      input: { projectSessionId: string },
      listener: (event: MutationSectionChanged) => void
    ): Promise<() => void>
    subscribeMutations(
      input: { projectSessionId: string },
      listener: (event: MutationProposalChanged) => void
    ): Promise<() => void>
  }
  knowledge: {
    list(input: { projectSessionId: string }): Promise<KnowledgeItem[]>
    indexStatus(input: { projectSessionId: string }): Promise<KnowledgeIndexStatus>
    chooseAndImport(input: { projectSessionId: string }): Promise<KnowledgeItem[]>
    importDropped(input: { projectSessionId: string; files: File[] }): Promise<KnowledgeItem[]>
    cancel(input: { projectSessionId: string; knowledgeItemId: string }): Promise<KnowledgeItem[]>
    delete(input: { projectSessionId: string; knowledgeItemId: string }): Promise<KnowledgeItem[]>
    reveal(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    openOriginal(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    startParse(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    cancelParse(input: { projectSessionId: string; knowledgeItemId: string }): Promise<void>
    refreshEmbeddings(input: { projectSessionId: string; knowledgeItemId?: string }): Promise<void>
    createPdfPreview(input: {
      projectSessionId: string
      knowledgeItemId: string
    }): Promise<PdfPreviewResult>
    releasePdfPreview(input: { projectSessionId: string; previewId: string }): Promise<void>
    mappingPage(input: {
      projectSessionId: string
      knowledgeItemId: string
      pageIndex: number
    }): Promise<KnowledgeMappingPage>
    parsedMetadata(input: {
      projectSessionId: string
      knowledgeItemId: string
    }): Promise<ParsedKnowledgeMetadata>
    parsedBlocks(input: {
      projectSessionId: string
      knowledgeItemId: string
      parseRevisionId: string
      cursor?: number
      limit?: number
    }): Promise<ParsedKnowledgeBlockPage>
    parsedMarkdown(input: {
      projectSessionId: string
      knowledgeItemId: string
      parseRevisionId: string
    }): Promise<ParsedKnowledgeMarkdown>
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
    saveAgentPreset(input: AgentCustomPresetInput): Promise<ProviderSettingsSnapshot>
    removeAgentPreset(input: AgentPresetInput): Promise<ProviderSettingsSnapshot>
    refreshAgentPreset(input: AgentPresetInput): Promise<ProviderSettingsSnapshot>
    setAgentDefault(selection: AgentModelSelection | null): Promise<ProviderSettingsSnapshot>
    setAgentCredential(input: AgentPresetCredentialInput): Promise<ProviderSettingsSnapshot>
    clearAgentCredential(input: AgentPresetInput): Promise<ProviderSettingsSnapshot>
    setAgentProviderEnabled(input: AgentProviderEnabledInput): Promise<ProviderSettingsSnapshot>
    setAgentModelEnabled(input: AgentModelEnabledInput): Promise<ProviderSettingsSnapshot>
    saveAgentManualModel(input: AgentManualModelInput): Promise<ProviderSettingsSnapshot>
    removeAgentManualModel(input: AgentManualModelRemoveInput): Promise<ProviderSettingsSnapshot>
    loginAgentPreset(
      input: AgentPresetLoginInput,
      listener: (event: AgentAuthInteractionEvent) => void
    ): Promise<ProviderSettingsSnapshot>
    respondAgentAuth(input: AgentAuthPromptResponse): Promise<void>
    cancelAgentAuth(input: AgentAuthFlowInput): Promise<void>
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

// Main registers one skills:changed subscription per webContents. Multiplex every Renderer
// listener here so one component unsubscribing cannot silence the others.
const skillChangeListeners = new Set<(revision: number) => void>()
let skillChangeDispatcherAttached = false

function attachSkillChangeDispatcher(): void {
  if (skillChangeDispatcherAttached) return
  ipcRenderer.on(IPC_CHANNELS.skillsChanged, (_event: Electron.IpcRendererEvent, raw: unknown) => {
    const revision = skillChangeEventSchema.parse(raw).revision
    for (const listener of skillChangeListeners) listener(revision)
  })
  skillChangeDispatcherAttached = true
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
    },
    async getAccentPreference() {
      return accentPreferenceSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.appGetAccentPreference)
      )
    },
    async setAccentPreference(input) {
      return accentPreferenceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.appSetAccentPreference,
          setAccentPreferenceInputSchema.parse(input)
        )
      )
    },
    async getDefaultAgentApprovalMode() {
      return agentApprovalModeSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.appGetDefaultAgentApprovalMode)
      )
    },
    async setDefaultAgentApprovalMode(input) {
      return agentApprovalModeSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.appSetDefaultAgentApprovalMode,
          setDefaultAgentApprovalModeInputSchema.parse(input)
        )
      )
    }
  },
  skills: {
    async snapshot() {
      return skillsSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.skillsSnapshot))
    },
    async inspectGithub(input) {
      return inspectGithubSkillResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.skillsInspectGithub,
          inspectGithubSkillInputSchema.parse(input)
        )
      )
    },
    async install(input) {
      return skillMutationResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.skillsInstall, installSkillInputSchema.parse(input))
      ).snapshot
    },
    async setEnabled(input) {
      return skillMutationResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.skillsSetEnabled,
          setSkillEnabledInputSchema.parse(input)
        )
      ).snapshot
    },
    async checkUpdate(input) {
      return skillUpdateResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.skillsCheckUpdate, skillIdInputSchema.parse(input))
      )
    },
    async update(input) {
      return skillMutationResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.skillsUpdate, updateSkillInputSchema.parse(input))
      ).snapshot
    },
    async uninstall(input) {
      return skillMutationResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.skillsUninstall,
          uninstallSkillInputSchema.parse(input)
        )
      ).snapshot
    },
    async cancelOperation(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.skillsCancelOperation,
        cancelSkillOperationInputSchema.parse(input)
      )
    },
    subscribeChanges(listener) {
      attachSkillChangeDispatcher()
      skillChangeListeners.add(listener)
      if (skillChangeListeners.size === 1) {
        ipcRenderer.send(IPC_CHANNELS.skillsSubscribeChanges)
      }
      return () => {
        skillChangeListeners.delete(listener)
        if (skillChangeListeners.size === 0) {
          ipcRenderer.send(IPC_CHANNELS.skillsUnsubscribeChanges)
        }
      }
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
    async recoverStaleLock() {
      return projectLifecycleSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectRecoveryStaleLock,
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
    async exportManuscript(input) {
      return manuscriptExportResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectManuscriptExport,
          manuscriptExportInputSchema.parse(input)
        )
      )
    },
    async versionHistoryStatus(input) {
      return versionHistoryStatusSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryStatus,
          projectSessionInputSchema.parse(input)
        )
      )
    },
    async enableVersionHistory(input) {
      return checkpointOperationResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryEnable,
          enableVersionHistoryInputSchema.parse(input)
        )
      ).checkpoint
    },
    async reinitializeVersionHistory(input) {
      return checkpointOperationResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryReinitialize,
          reinitializeVersionHistoryInputSchema.parse(input)
        )
      ).checkpoint
    },
    async dismissVersionHistoryPrompt(input) {
      return versionHistoryStatusSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryDismissPrompt,
          dismissVersionHistoryPromptInputSchema.parse(input)
        )
      )
    },
    async createCheckpoint(input) {
      return checkpointOperationResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryCreateCheckpoint,
          createCheckpointInputSchema.parse(input)
        )
      ).checkpoint
    },
    async listCheckpoints(input) {
      return listCheckpointsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryListCheckpoints,
          listCheckpointsInputSchema.parse(input)
        )
      )
    },
    async compareCheckpointState(input) {
      return compareCheckpointStateResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryCompareState,
          compareCheckpointStateInputSchema.parse(input)
        )
      )
    },
    async restoreCheckpoint(input) {
      return restoreCheckpointResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectHistoryRestoreCheckpoint,
          restoreCheckpointInputSchema.parse(input)
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
    async uploadAsset(input) {
      return manuscriptAssetResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorUploadAsset,
          uploadManuscriptAssetInputSchema.parse(input)
        )
      )
    },
    async resolveAsset(input) {
      return manuscriptAssetPreviewResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorResolveAsset,
          manuscriptAssetPreviewInputSchema.parse(input)
        )
      )
    },
    async resolveImportAsset(input) {
      return manuscriptAssetImportReferenceResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorResolveImportAsset,
          manuscriptAssetImportReferenceInputSchema.parse(input)
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
  agent: {
    async listSessions(input) {
      return agentListSessionsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentListSessions,
          agentProjectInputSchema.parse(input)
        )
      )
    },
    async createSession(input) {
      return agentCreateSessionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentCreateSession,
          agentCreateSessionInputSchema.parse(input)
        )
      )
    },
    async setApprovalMode(input) {
      return agentSetApprovalModeResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentSetApprovalMode,
          agentSetApprovalModeInputSchema.parse(input)
        )
      )
    },
    async setModelSelection(input) {
      return agentSetModelSelectionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentSetModelSelection,
          agentSetModelSelectionInputSchema.parse(input)
        )
      )
    },
    async setThinkingLevel(input) {
      return agentSetThinkingLevelResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentSetThinkingLevel,
          agentSetThinkingLevelInputSchema.parse(input)
        )
      )
    },
    async listEvents(input) {
      return agentEventPageSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentListEvents,
          agentEventPageInputSchema.parse(input)
        )
      )
    },
    async listRuns(input) {
      return agentListRunsResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.agentListRuns, agentListRunsInputSchema.parse(input))
      )
    },
    async listProposals(input) {
      return agentListProposalsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentListProposals,
          agentListRunsInputSchema.omit({ limit: true }).parse(input)
        )
      )
    },
    async startRun(input) {
      return agentStartRunResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.agentStartRun, agentStartRunInputSchema.parse(input))
      ).run
    },
    async steerRun(input) {
      await ipcRenderer.invoke(IPC_CHANNELS.agentSteerRun, agentQueueInputSchema.parse(input))
    },
    async followUpRun(input) {
      await ipcRenderer.invoke(IPC_CHANNELS.agentFollowUpRun, agentQueueInputSchema.parse(input))
    },
    async abortRun(input) {
      await ipcRenderer.invoke(IPC_CHANNELS.agentAbortRun, agentRunInputSchema.parse(input))
    },
    async subscribeEvents(input, listener) {
      const subscription = agentSubscriptionInputSchema.parse({
        ...input,
        subscriptionId: globalThis.crypto.randomUUID(),
        afterSequence: input.afterSequence ?? 0
      })
      let lastSequence = subscription.afterSequence
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = agentRendererEventSchema.parse(value)
        if (parsed.projectSessionId !== subscription.projectSessionId) return
        const sessionId =
          parsed.kind === 'durable' ? parsed.event.agentSessionId : parsed.agentSessionId
        if (sessionId !== subscription.agentSessionId) return
        if (parsed.kind === 'durable') {
          if (parsed.event.sequence <= lastSequence) return
          lastSequence = parsed.event.sequence
        }
        listener(parsed)
      }
      ipcRenderer.on(IPC_CHANNELS.agentEvent, handler)
      try {
        let page = agentEventPageSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeEvents, subscription)
        )
        while (true) {
          for (const event of page.events) {
            if (event.sequence <= lastSequence) continue
            lastSequence = event.sequence
            listener(
              agentRendererEventSchema.parse({
                kind: 'durable',
                projectSessionId: subscription.projectSessionId,
                event
              })
            )
          }
          if (!page.hasMore) break
          page = agentEventPageSchema.parse(
            await ipcRenderer.invoke(
              IPC_CHANNELS.agentListEvents,
              agentEventPageInputSchema.parse({
                projectSessionId: subscription.projectSessionId,
                agentSessionId: subscription.agentSessionId,
                afterSequence: page.nextAfterSequence
              })
            )
          )
        }
        await ipcRenderer.invoke(IPC_CHANNELS.agentCompleteReplay, {
          ...subscription,
          afterSequence: lastSequence
        })
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeEvents, subscription)
        throw err
      }
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeEvents, subscription)
      }
    },
    async approveProposal(input) {
      return approveMutationProposalResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentProposalApprove,
          approveMutationProposalInputSchema.parse(input)
        )
      )
    },
    async rejectProposal(input) {
      return mutationProposalActionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentProposalReject,
          rejectMutationProposalInputSchema.parse(input)
        )
      )
    },
    async undoProposal(input) {
      return mutationProposalActionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentProposalUndo,
          undoMutationProposalInputSchema.parse(input)
        )
      )
    },
    async cancelImageGeneration(input) {
      return cancelImageGenerationResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentCancelImageGeneration,
          cancelImageGenerationInputSchema.parse(input)
        )
      )
    },
    async subscribeSectionChanged(input, listener) {
      const subscription = mutationSubscriptionInputSchema.parse({
        ...input,
        subscriptionId: globalThis.crypto.randomUUID()
      })
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const changed = mutationProposalChangedSchema.parse(value)
        if (
          changed.projectSessionId === subscription.projectSessionId &&
          changed.sectionChanged !== null
        ) {
          listener(changed.sectionChanged)
        }
      }
      ipcRenderer.on(IPC_CHANNELS.agentMutationChanged, handler)
      try {
        await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeMutations, subscription)
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
        throw err
      }
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeMutations, subscription)
      }
    },
    async subscribeMutations(input, listener) {
      const subscription = mutationSubscriptionInputSchema.parse({
        ...input,
        subscriptionId: globalThis.crypto.randomUUID()
      })
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const changed = mutationProposalChangedSchema.parse(value)
        if (changed.projectSessionId === subscription.projectSessionId) listener(changed)
      }
      ipcRenderer.on(IPC_CHANNELS.agentMutationChanged, handler)
      try {
        await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeMutations, subscription)
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
        throw err
      }
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.agentMutationChanged, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeMutations, subscription)
      }
    }
  },
  knowledge: {
    async list(input) {
      return knowledgeListResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.knowledgeList, knowledgeListInputSchema.parse(input))
      )
    },
    async indexStatus(input) {
      return knowledgeIndexStatusSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeIndexStatus,
          knowledgeListInputSchema.parse(input)
        )
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
    async refreshEmbeddings(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeRefreshEmbeddings,
        knowledgeEmbeddingRefreshInputSchema.parse(input)
      )
    },
    async createPdfPreview(input) {
      return pdfPreviewResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeCreatePdfPreview,
          pdfPreviewInputSchema.parse(input)
        )
      )
    },
    async releasePdfPreview(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeReleasePdfPreview,
        pdfPreviewReleaseInputSchema.parse(input)
      )
    },
    async mappingPage(input) {
      return knowledgeMappingPageSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeMappingPage,
          knowledgeMappingPageInputSchema.parse(input)
        )
      )
    },
    async parsedMetadata(input) {
      return parsedKnowledgeMetadataSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeParsedMetadata,
          knowledgeItemActionInputSchema.parse(input)
        )
      )
    },
    async parsedBlocks(input) {
      return parsedKnowledgeBlockPageSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeParsedBlocks,
          parsedKnowledgeBlockPageInputSchema.parse(input)
        )
      )
    },
    async parsedMarkdown(input) {
      return parsedKnowledgeMarkdownSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeParsedMarkdown,
          parsedKnowledgeMarkdownInputSchema.parse(input)
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
    },
    async saveAgentPreset(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersSaveAgentPreset,
          agentCustomPresetInputSchema.parse(input)
        )
      )
    },
    async removeAgentPreset(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersRemoveAgentPreset,
          agentPresetInputSchema.parse(input)
        )
      )
    },
    async refreshAgentPreset(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersRefreshAgentPreset,
          agentPresetInputSchema.parse(input)
        )
      )
    },
    async setAgentDefault(selection) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersSetAgentDefault,
          agentModelSelectionSchema.nullable().parse(selection)
        )
      )
    },
    async setAgentCredential(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersSetAgentCredential,
          agentPresetCredentialInputSchema.parse(input)
        )
      )
    },
    async clearAgentCredential(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersClearAgentCredential,
          agentPresetInputSchema.parse(input)
        )
      )
    },
    async setAgentProviderEnabled(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersSetAgentProviderEnabled,
          agentProviderEnabledInputSchema.parse(input)
        )
      )
    },
    async setAgentModelEnabled(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersSetAgentModelEnabled,
          agentModelEnabledInputSchema.parse(input)
        )
      )
    },
    async saveAgentManualModel(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersSaveAgentManualModel,
          agentManualModelInputSchema.parse(input)
        )
      )
    },
    async removeAgentManualModel(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersRemoveAgentManualModel,
          agentManualModelRemoveInputSchema.parse(input)
        )
      )
    },
    async loginAgentPreset(input, listener) {
      const parsedInput = agentPresetLoginInputSchema.parse(input)
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = agentAuthInteractionEventSchema.parse(value)
        if (parsed.flowId === parsedInput.flowId) listener(parsed)
      }
      ipcRenderer.on(IPC_CHANNELS.providersAgentAuthEvent, handler)
      try {
        return providerSettingsSnapshotSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.providersLoginAgentPreset, parsedInput)
        )
      } finally {
        ipcRenderer.removeListener(IPC_CHANNELS.providersAgentAuthEvent, handler)
      }
    },
    async respondAgentAuth(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersRespondAgentAuth,
        agentAuthPromptResponseSchema.parse(input)
      )
    },
    async cancelAgentAuth(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersCancelAgentAuth,
        agentAuthFlowInputSchema.parse(input)
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
