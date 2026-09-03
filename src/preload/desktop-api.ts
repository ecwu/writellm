import type {
  AppInfo,
  AccentPreference,
  CitationDisplayMode,
  OnboardingState,
  SetAccentPreferenceInput,
  SetCitationDisplayModeInput,
  SetThemePreferenceInput,
  SetOnboardingStateInput,
  ThemePreference,
  SetDefaultAgentApprovalModeInput
} from '../shared/contracts/app'
import type { AgentApprovalMode, AgentInteractionMode } from '../shared/contracts/agent'
import type {
  CreatePublicationPresetInput,
  PublicationPresetSnapshot,
  UpdatePublicationPresetInput
} from '../shared/contracts/publication-presets'
import type {
  InspectGithubSkillInput,
  InspectGithubSkillResult,
  InstallSkillInput,
  SetSkillEnabledInput,
  SkillsSnapshot,
  SkillUpdateResult,
  UninstallSkillInput,
  UpdateSkillInput
} from '../shared/contracts/skills'
import type {
  agentAnswerUserQuestionInputSchema,
  agentStartRunInputSchema,
  AgentEventPage,
  AgentProjectActivitySnapshot,
  AgentRendererEvent,
  AgentRunRecord,
  AgentSessionRecord
} from '../shared/contracts/agent-ipc'
import type {
  userUpdateWritingTaskInputSchema,
  WritingTaskView
} from '../shared/contracts/writing-task'
import type {
  ChangeSetBatchInput,
  ChangeSetBatchResult
} from '../shared/contracts/agent-change-set'
import type {
  rejectMutationProposalInputSchema,
  ApproveMutationProposalResult,
  MutationProposalActionResult,
  MutationProposalRecord,
  MutationProposalChanged,
  MutationSectionChanged
} from '../shared/contracts/agent-mutations'
import type {
  DiagnosticExportResult,
  DiagnosticsLevelInput,
  DiagnosticsSnapshot,
  RendererErrorReport
} from '../shared/contracts/diagnostics'
import type {
  CheckpointEntry,
  ActiveProject,
  CreateCheckpointInput,
  ListCheckpointsInput,
  ProjectCreateInput,
  ProjectLifecycleEvent,
  ProjectLifecycleSnapshot,
  ProjectSelectionResult,
  RecentProjectOpenInput,
  RecentProjects,
  ProjectSessionInput,
  VersionHistoryStatus
} from '../shared/contracts/projects'
import type {
  ManuscriptExportKind,
  ManuscriptExportResult
} from '../shared/contracts/manuscript-export'
import type {
  ProjectTemplateExtractionPreview,
  ProjectTemplateSummary
} from '../shared/contracts/project-templates'
import type { DiagnosticLog } from '../shared/observability/log-schema'
import type {
  JobStatus,
  JobStatusEvent,
  JobStatusInput,
  ListJobsInput,
  ListJobsResult
} from '../shared/contracts/jobs'
import type {
  KnowledgeCitationCoveragePageInput,
  KnowledgeCitationCoveragePageResult,
  ParsedKnowledgeBlockPage,
  ParsedKnowledgeMarkdown,
  ParsedKnowledgeMetadata,
  KnowledgeIndexStatus,
  KnowledgeItem
} from '../shared/contracts/knowledge'
import type { KnowledgeMappingPage, PdfPreviewResult } from '../shared/contracts/knowledge-mapping'
import type {
  editorSectionSchema,
  manuscriptAssetPreviewResultSchema,
  manuscriptAssetResultSchema,
  openEditorResultSchema,
  CreateSectionRequest,
  DeleteSectionRequest,
  EditorFlushRequest,
  ManuscriptAssembly,
  ManuscriptReferenceIndex,
  ManuscriptWorkspace,
  ManuscriptWorkspaceInput,
  MoveSectionRequest,
  SaveSectionDocumentInput,
  SaveSectionDocumentResponse,
  UpdateManuscriptBriefRequest,
  UpdateSectionRequest
} from '../shared/contracts/manuscript'
import type {
  ManuscriptImportApplyInput,
  ManuscriptImportApplyResult,
  ManuscriptImportCancelResult,
  ManuscriptImportPlanResult
} from '../shared/contracts/manuscript-import'
import type { PublicationOptions, PublicationPreview } from '../shared/contracts/publication'
import type {
  DeleteManuscriptAssetResult,
  ManuscriptAssetWorkspaceInput,
  ManuscriptAssetWorkspacePage
} from '../shared/contracts/manuscript-assets'
import type {
  ManuscriptSearchInput,
  ManuscriptSearchNavigationInput,
  ManuscriptSearchNavigationResult,
  ManuscriptSearchResult
} from '../shared/contracts/manuscript-search'
import type {
  ManuscriptReplacementApplyInput,
  ManuscriptReplacementApplyResult,
  ManuscriptReplacementChangedEvent,
  ManuscriptReplacementPageInput,
  ManuscriptReplacementPageResult,
  ManuscriptReplacementPlanInput,
  ManuscriptReplacementPlanResult,
  ManuscriptReplacementUndoResult
} from '../shared/contracts/manuscript-replacement'
import type { UpdateWritingRulesIpcInput } from '../shared/contracts/writing-rules-ipc'
import type {
  ProviderConnectionTestResult,
  ImageProviderSelectionInput,
  AgentAuthFlowInput,
  AgentAuthInteractionEvent,
  AgentAuthPromptResponse,
  AgentCustomPresetInput,
  AgentManualModelInput,
  AgentManualModelRemoveInput,
  AgentModelEnabledInput,
  AgentModelSelection,
  AgentThinkingLevel,
  AgentPresetInput,
  AgentPresetCredentialInput,
  AgentPresetLoginInput,
  AgentProviderEnabledInput,
  ProviderRoleInput,
  ProviderSaveInput,
  ProviderSettingsSnapshot
} from '../shared/contracts/providers'
import type {
  ExpandedCitation,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  ReadableCitationResolutionInput,
  ReadableCitationResolutionResult
} from '../shared/contracts/search'
import type {
  NotebookChatEvent,
  NotebookChatSnapshot,
  NotebookChatStartTurnResult,
  NotebookSourceScope
} from '../shared/contracts/notebook'
import type {
  BibliographyConfirmImportSelection,
  BibliographyImportPlan,
  BibliographyImportOutcome,
  BibliographySnapshot,
  FormattedReferenceSnapshot,
  LegacyCitationConversionPlan,
  ReferenceItem,
  ReferenceSearchResult,
  ReferenceSettings
} from '../shared/contracts/references'

export interface DesktopApi {
  app: {
    quit(): Promise<void>
    getInfo(): Promise<AppInfo>
    getThemePreference(): Promise<ThemePreference>
    setThemePreference(input: SetThemePreferenceInput): Promise<ThemePreference>
    getAccentPreference(): Promise<AccentPreference>
    setAccentPreference(input: SetAccentPreferenceInput): Promise<AccentPreference>
    getCitationDisplayMode(): Promise<CitationDisplayMode>
    setCitationDisplayMode(input: SetCitationDisplayModeInput): Promise<CitationDisplayMode>
    getDefaultAgentApprovalMode(): Promise<AgentApprovalMode>
    setDefaultAgentApprovalMode(input: SetDefaultAgentApprovalModeInput): Promise<AgentApprovalMode>
    getOnboardingState(): Promise<OnboardingState>
    setOnboardingState(input: SetOnboardingStateInput): Promise<OnboardingState>
    publicationPresets(): Promise<PublicationPresetSnapshot>
    createPublicationPreset(input: CreatePublicationPresetInput): Promise<PublicationPresetSnapshot>
    updatePublicationPreset(input: UpdatePublicationPresetInput): Promise<PublicationPresetSnapshot>
    deletePublicationPreset(input: { presetId: string }): Promise<PublicationPresetSnapshot>
    setDefaultPublicationPreset(input: { presetId: string }): Promise<PublicationPresetSnapshot>
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
    removeRecent(input: RecentProjectOpenInput): Promise<RecentProjects>
    create(input: ProjectCreateInput): Promise<ProjectSelectionResult>
    open(): Promise<ProjectSelectionResult>
    openRecent(input: RecentProjectOpenInput): Promise<ProjectSelectionResult>
    close(input: ProjectSessionInput): Promise<ProjectLifecycleSnapshot>
    switch(input: ProjectSessionInput): Promise<ProjectSelectionResult>
    clone(input: ProjectSessionInput): Promise<ProjectSelectionResult>
    cancelClone(input: ProjectSessionInput): Promise<{ cancelled: boolean }>
    templates(): Promise<ProjectTemplateSummary[]>
    previewTemplate(input: ProjectSessionInput): Promise<ProjectTemplateExtractionPreview>
    saveTemplate(input: {
      projectSessionId: string
      name: string
      description: string
      includePublicationPreset: boolean
    }): Promise<ProjectTemplateSummary[]>
    deleteTemplate(input: { templateId: string }): Promise<ProjectTemplateSummary[]>
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
      presetId?: string
    }): Promise<ManuscriptExportResult>
    cancelManuscriptExport(input: ProjectSessionInput): Promise<{ cancelled: boolean }>
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
    createImportPlan(input: {
      projectSessionId: string
      activeSectionId: string
      selection?: 'file' | 'directory'
    }): Promise<ManuscriptImportPlanResult>
    applyImportPlan(input: ManuscriptImportApplyInput): Promise<ManuscriptImportApplyResult>
    cancelImportPlan(input: {
      projectSessionId: string
      planId: string
    }): Promise<ManuscriptImportCancelResult>
    exportNativeJson(input: {
      projectSessionId: string
      sectionId: string
    }): Promise<{ relativePath: string }>
    exportMarkdown(input: {
      projectSessionId: string
      sectionId: string
      sectionRevisionId: string
      contentHash: string
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
    listAssets(input: ManuscriptAssetWorkspaceInput): Promise<ManuscriptAssetWorkspacePage>
    deleteAsset(input: {
      projectSessionId: string
      assetId: string
    }): Promise<DeleteManuscriptAssetResult>
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
    references(input: ManuscriptWorkspaceInput): Promise<ManuscriptReferenceIndex>
    preview(input: ManuscriptWorkspaceInput): Promise<ManuscriptAssembly>
    publicationPreview(input: {
      projectSessionId: string
      options?: Partial<PublicationOptions>
    }): Promise<PublicationPreview>
    updateBrief(input: UpdateManuscriptBriefRequest): Promise<ManuscriptWorkspace>
    createSection(input: CreateSectionRequest): Promise<ManuscriptWorkspace>
    updateSection(input: UpdateSectionRequest): Promise<ManuscriptWorkspace>
    moveSection(input: MoveSectionRequest): Promise<ManuscriptWorkspace>
    deleteSection(input: DeleteSectionRequest): Promise<ManuscriptWorkspace>
    search(input: ManuscriptSearchInput): Promise<ManuscriptSearchResult>
    revalidateSearch(
      input: ManuscriptSearchNavigationInput
    ): Promise<ManuscriptSearchNavigationResult>
    createReplacementPlan(
      input: ManuscriptReplacementPlanInput
    ): Promise<ManuscriptReplacementPlanResult>
    replacementPage(input: ManuscriptReplacementPageInput): Promise<ManuscriptReplacementPageResult>
    dismissReplacementPlan(input: { projectSessionId: string; planId: string }): Promise<void>
    applyReplacement(
      input: ManuscriptReplacementApplyInput
    ): Promise<ManuscriptReplacementApplyResult>
    undoReplacement(input: {
      projectSessionId: string
      undoCapability: string
    }): Promise<ManuscriptReplacementUndoResult>
    subscribeReplacementChanges(
      input: { projectSessionId: string },
      listener: (event: ManuscriptReplacementChangedEvent) => void
    ): Promise<() => void>
  }
  writingRules: {
    update(input: UpdateWritingRulesIpcInput): Promise<ManuscriptWorkspace>
  }
  agent: {
    listSessions(input: {
      projectSessionId: string
      status?: 'active' | 'archived'
    }): Promise<AgentSessionRecord[]>
    createSession(input: {
      projectSessionId: string
      title?: string
      modelSelection?: AgentModelSelection | null
    }): Promise<AgentSessionRecord>
    generateSessionTitle(input: {
      projectSessionId: string
      agentSessionId: string
    }): Promise<AgentSessionRecord>
    archiveSession(input: {
      projectSessionId: string
      agentSessionId: string
    }): Promise<AgentSessionRecord>
    restoreSession(input: {
      projectSessionId: string
      agentSessionId: string
    }): Promise<AgentSessionRecord>
    setApprovalMode(input: {
      projectSessionId: string
      agentSessionId: string
      mode: AgentApprovalMode
    }): Promise<AgentSessionRecord>
    setInteractionMode(input: {
      projectSessionId: string
      agentSessionId: string
      mode: AgentInteractionMode
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
    updateWritingTask(
      input: ReturnType<typeof userUpdateWritingTaskInputSchema.parse>
    ): Promise<WritingTaskView>
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
    steerPendingFollowUp(input: {
      projectSessionId: string
      agentRunId: string
      pendingMessageId: string
    }): Promise<void>
    deletePendingFollowUp(input: {
      projectSessionId: string
      agentRunId: string
      pendingMessageId: string
    }): Promise<void>
    abortRun(input: { projectSessionId: string; agentRunId: string }): Promise<void>
    answerUserQuestion(
      input: ReturnType<typeof agentAnswerUserQuestionInputSchema.parse>
    ): Promise<void>
    compactSession(input: {
      projectSessionId: string
      agentSessionId: string
    }): Promise<{ compactionId: string }>
    stopCompaction(input: {
      projectSessionId: string
      agentSessionId: string
      compactionId: string
    }): Promise<void>
    subscribeEvents(
      input: { projectSessionId: string; agentSessionId: string; afterSequence?: number },
      listener: (event: AgentRendererEvent) => void
    ): Promise<() => void>
    subscribeActivity(
      input: { projectSessionId: string },
      listener: (event: AgentRendererEvent) => void
    ): Promise<{
      snapshot: AgentProjectActivitySnapshot
      activate: () => Promise<void>
      unsubscribe: () => void
    }>
    approveProposal(input: {
      projectSessionId: string
      agentSessionId: string
      proposalId: string
    }): Promise<ApproveMutationProposalResult>
    rejectProposal(
      input: ReturnType<typeof rejectMutationProposalInputSchema.parse>
    ): Promise<MutationProposalActionResult>
    undoProposal(input: {
      projectSessionId: string
      agentSessionId: string
      proposalId: string
    }): Promise<MutationProposalActionResult>
    decideChangeSet(input: ChangeSetBatchInput): Promise<ChangeSetBatchResult>
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
    listReferences(input: { projectSessionId: string; query?: string }): Promise<ReferenceItem[]>
    searchReferences(input: {
      projectSessionId: string
      query?: string
    }): Promise<ReferenceSearchResult>
    bibliographySnapshot(input: { projectSessionId: string }): Promise<BibliographySnapshot | null>
    chooseBibliography(input: { projectSessionId: string }): Promise<BibliographySnapshot | null>
    refreshBibliography(input: { projectSessionId: string }): Promise<BibliographySnapshot | null>
    prepareReferenceImport(input: {
      projectSessionId: string
      connectorId: string
      candidateIds: string[]
      includePdf: boolean
    }): Promise<BibliographyImportPlan>
    confirmReferenceImport(input: {
      projectSessionId: string
      previewId: string
      selections: BibliographyConfirmImportSelection[]
    }): Promise<{
      references: ReferenceItem[]
      outcomes: BibliographyImportOutcome[]
    }>
    exportBibliography(input: {
      projectSessionId: string
      format: 'bibtex' | 'csl-json'
      scope: 'cited-only' | 'all-project'
    }): Promise<{ exported: boolean; exportedCount: number; lossCount: number }>
    planLegacyCitationConversion(input: {
      projectSessionId: string
    }): Promise<LegacyCitationConversionPlan>
    applyLegacyCitationConversion(input: {
      projectSessionId: string
      planId: string
    }): Promise<{ sectionsChanged: number }>
    referenceSettings(input: { projectSessionId: string }): Promise<ReferenceSettings>
    setReferenceSettings(input: {
      projectSessionId: string
      styleId: 'apa' | 'ieee' | 'vancouver'
      locale: string
    }): Promise<ReferenceSettings>
    chooseCustomReferenceStyle(input: { projectSessionId: string }): Promise<ReferenceSettings>
    formatReferences(input: { projectSessionId: string }): Promise<FormattedReferenceSnapshot>
    list(input: { projectSessionId: string }): Promise<KnowledgeItem[]>
    indexStatus(input: { projectSessionId: string }): Promise<KnowledgeIndexStatus>
    citationCoveragePage(
      input: KnowledgeCitationCoveragePageInput
    ): Promise<KnowledgeCitationCoveragePageResult>
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
    resolveReadableCitation(
      input: ReadableCitationResolutionInput
    ): Promise<ReadableCitationResolutionResult>
  }
  notebook: {
    snapshot(input: { projectSessionId: string }): Promise<NotebookChatSnapshot>
    startTurn(input: {
      projectSessionId: string
      content: string
    }): Promise<NotebookChatStartTurnResult>
    stopTurn(input: { projectSessionId: string }): Promise<NotebookChatSnapshot>
    clear(input: { projectSessionId: string }): Promise<NotebookChatSnapshot>
    setSources(input: {
      projectSessionId: string
      sourceScope: NotebookSourceScope
    }): Promise<NotebookChatSnapshot>
    setModel(input: {
      projectSessionId: string
      modelSelection: AgentModelSelection
    }): Promise<NotebookChatSnapshot>
    setThinkingLevel(input: {
      projectSessionId: string
      level: AgentThinkingLevel
    }): Promise<NotebookChatSnapshot>
    subscribe(
      input: { projectSessionId: string },
      listener: (event: NotebookChatEvent) => void
    ): Promise<{ snapshot: NotebookChatSnapshot; unsubscribe: () => void }>
  }
  providers: {
    snapshot(): Promise<ProviderSettingsSnapshot>
    save(input: ProviderSaveInput): Promise<ProviderSettingsSnapshot>
    remove(input: ProviderRoleInput): Promise<ProviderSettingsSnapshot>
    testConnection(input: ProviderRoleInput): Promise<ProviderConnectionTestResult>
    setActiveImage(input: ImageProviderSelectionInput): Promise<ProviderSettingsSnapshot>
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
