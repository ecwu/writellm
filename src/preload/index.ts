import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  accentPreferenceSchema,
  appInfoSchema,
  citationDisplayModeSchema,
  onboardingStateSchema,
  setAccentPreferenceInputSchema,
  setCitationDisplayModeInputSchema,
  setDefaultAgentApprovalModeInputSchema,
  setOnboardingStateInputSchema,
  setThemePreferenceInputSchema,
  themePreferenceSchema,
  type AppInfo,
  type AccentPreference,
  type CitationDisplayMode,
  type OnboardingState,
  type SetAccentPreferenceInput,
  type SetCitationDisplayModeInput,
  type SetThemePreferenceInput,
  type SetOnboardingStateInput,
  type ThemePreference,
  type SetDefaultAgentApprovalModeInput
} from '../shared/contracts/app'
import { agentApprovalModeSchema, type AgentApprovalMode } from '../shared/contracts/agent'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  createPublicationPresetInputSchema,
  publicationPresetIdInputSchema,
  publicationPresetSnapshotSchema,
  updatePublicationPresetInputSchema,
  type CreatePublicationPresetInput,
  type PublicationPresetSnapshot,
  type UpdatePublicationPresetInput
} from '../shared/contracts/publication-presets'
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
  agentArchiveSessionInputSchema,
  agentArchiveSessionResultSchema,
  agentAnswerUserQuestionInputSchema,
  agentAnswerUserQuestionResultSchema,
  agentCreateSessionInputSchema,
  agentCreateSessionResultSchema,
  agentCompactSessionInputSchema,
  agentCompactSessionResultSchema,
  agentEventPageInputSchema,
  agentEventPageSchema,
  agentListProposalsResultSchema,
  agentListRunsInputSchema,
  agentListRunsResultSchema,
  agentListSessionsInputSchema,
  agentListSessionsResultSchema,
  agentProjectActivitySnapshotSchema,
  agentProjectActivitySubscriptionInputSchema,
  agentGenerateSessionTitleInputSchema,
  agentGenerateSessionTitleResultSchema,
  agentPendingMessageActionInputSchema,
  agentQueueInputSchema,
  agentRendererEventSchema,
  agentRestoreSessionInputSchema,
  agentRestoreSessionResultSchema,
  agentRunInputSchema,
  agentSetApprovalModeInputSchema,
  agentSetApprovalModeResultSchema,
  agentSetModelSelectionInputSchema,
  agentSetModelSelectionResultSchema,
  agentSetThinkingLevelInputSchema,
  agentSetThinkingLevelResultSchema,
  agentStartRunInputSchema,
  agentStartRunResultSchema,
  agentStopCompactionInputSchema,
  agentStopCompactionResultSchema,
  agentSubscriptionInputSchema,
  type AgentEventPage,
  type AgentProjectActivitySnapshot,
  type AgentRendererEvent,
  type AgentRunRecord,
  type AgentSessionRecord
} from '../shared/contracts/agent-ipc'
import {
  userUpdateWritingTaskInputSchema,
  userUpdateWritingTaskResultSchema,
  type WritingTaskView
} from '../shared/contracts/writing-task'
import {
  changeSetBatchInputSchema,
  changeSetBatchResultSchema,
  type ChangeSetBatchInput,
  type ChangeSetBatchResult
} from '../shared/contracts/agent-change-set'
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
  projectCloneCancelResultSchema,
  projectCloneInputSchema,
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
  manuscriptExportCancelResultSchema,
  manuscriptExportInputSchema,
  manuscriptExportResultSchema,
  type ManuscriptExportKind,
  type ManuscriptExportResult
} from '../shared/contracts/manuscript-export'
import {
  deleteUserProjectTemplateInputSchema,
  projectTemplateCatalogSchema,
  projectTemplateExtractionPreviewSchema,
  saveUserProjectTemplateInputSchema,
  type ProjectTemplateExtractionPreview,
  type ProjectTemplateSummary
} from '../shared/contracts/project-templates'
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
  knowledgeCitationCoveragePageInputSchema,
  knowledgeCitationCoveragePageResultSchema,
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
  type KnowledgeCitationCoveragePageInput,
  type KnowledgeCitationCoveragePageResult,
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
  loadSectionInputSchema,
  manuscriptAssemblySchema,
  manuscriptAssetPreviewInputSchema,
  manuscriptAssetPreviewResultSchema,
  manuscriptAssetResultSchema,
  manuscriptReferenceIndexInputSchema,
  manuscriptReferenceIndexSchema,
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
  type ManuscriptReferenceIndex,
  type ManuscriptWorkspace,
  type ManuscriptWorkspaceInput,
  type MoveSectionRequest,
  type SaveSectionDocumentInput,
  type SaveSectionDocumentResponse,
  type UpdateManuscriptBriefRequest,
  type UpdateSectionRequest
} from '../shared/contracts/manuscript'
import {
  manuscriptImportApplyInputSchema,
  manuscriptImportApplyResultSchema,
  manuscriptImportCancelInputSchema,
  manuscriptImportCancelResultSchema,
  manuscriptImportPlanRequestSchema,
  manuscriptImportPlanResultSchema,
  type ManuscriptImportApplyInput,
  type ManuscriptImportApplyResult,
  type ManuscriptImportCancelResult,
  type ManuscriptImportPlanResult
} from '../shared/contracts/manuscript-import'
import {
  publicationPreviewInputSchema,
  publicationPreviewSchema,
  type PublicationOptions,
  type PublicationPreview
} from '../shared/contracts/publication'
import {
  deleteManuscriptAssetInputSchema,
  deleteManuscriptAssetResultSchema,
  manuscriptAssetWorkspaceInputSchema,
  manuscriptAssetWorkspacePageSchema,
  type DeleteManuscriptAssetResult,
  type ManuscriptAssetWorkspaceInput,
  type ManuscriptAssetWorkspacePage
} from '../shared/contracts/manuscript-assets'
import {
  manuscriptSearchInputSchema,
  manuscriptSearchNavigationInputSchema,
  manuscriptSearchNavigationResultSchema,
  manuscriptSearchResultSchema,
  type ManuscriptSearchInput,
  type ManuscriptSearchNavigationInput,
  type ManuscriptSearchNavigationResult,
  type ManuscriptSearchResult
} from '../shared/contracts/manuscript-search'
import {
  manuscriptReplacementApplyInputSchema,
  manuscriptReplacementApplyResultSchema,
  manuscriptReplacementChangedEventSchema,
  manuscriptReplacementDismissInputSchema,
  manuscriptReplacementPageInputSchema,
  manuscriptReplacementPageResultSchema,
  manuscriptReplacementPlanInputSchema,
  manuscriptReplacementPlanResultSchema,
  manuscriptReplacementSubscriptionInputSchema,
  manuscriptReplacementUndoInputSchema,
  manuscriptReplacementUndoResultSchema,
  type ManuscriptReplacementApplyInput,
  type ManuscriptReplacementApplyResult,
  type ManuscriptReplacementChangedEvent,
  type ManuscriptReplacementPageInput,
  type ManuscriptReplacementPageResult,
  type ManuscriptReplacementPlanInput,
  type ManuscriptReplacementPlanResult,
  type ManuscriptReplacementUndoResult
} from '../shared/contracts/manuscript-replacement'
import {
  listReviewIssuesIpcInputSchema,
  reviewIssueEventsInputSchema,
  reviewIssueEventsResultSchema,
  updateReviewIssueIpcInputSchema,
  updateReviewIssueIpcResultSchema,
  updateWritingRulesIpcInputSchema,
  type ListReviewIssuesIpcInput,
  type ReviewIssueEventsInput,
  type UpdateReviewIssueIpcInput,
  type UpdateWritingRulesIpcInput
} from '../shared/contracts/review-ipc'
import {
  listReviewIssuesResultSchema,
  type ListReviewIssuesResult,
  type ReviewIssueEvent,
  type ReviewIssueRecord
} from '../shared/contracts/review'
import {
  annotationRecordSchema,
  createAnnotationInputSchema,
  listAnnotationsInputSchema,
  listAnnotationsResultSchema,
  updateAnnotationInputSchema,
  type AnnotationRecord,
  type CreateAnnotationInput,
  type ListAnnotationsInput,
  type ListAnnotationsResult,
  type UpdateAnnotationInput
} from '../shared/contracts/annotations'
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
  imageProviderSelectionInputSchema,
  providerRoleInputSchema,
  providerSaveInputSchema,
  providerSettingsSnapshotSchema,
  type ProviderConnectionTestResult,
  type ImageProviderSelectionInput,
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
  readableCitationResolutionInputSchema,
  readableCitationResolutionResultSchema,
  type ExpandedCitation,
  type KnowledgeSearchInput,
  type KnowledgeSearchResult,
  type ReadableCitationResolutionInput,
  type ReadableCitationResolutionResult
} from '../shared/contracts/search'
import {
  notebookChatClearInputSchema,
  notebookChatCommandResultSchema,
  notebookChatEventSchema,
  notebookChatSetModelInputSchema,
  notebookChatSetThinkingLevelInputSchema,
  notebookChatSetSourcesInputSchema,
  notebookChatSnapshotInputSchema,
  notebookChatSnapshotSchema,
  notebookChatStartTurnInputSchema,
  notebookChatStartTurnResultSchema,
  notebookChatStopTurnInputSchema,
  notebookChatSubscribeInputSchema,
  notebookChatSubscribeResultSchema,
  notebookChatUnsubscribeInputSchema,
  type NotebookChatEvent,
  type NotebookChatSnapshot,
  type NotebookChatStartTurnResult,
  type NotebookSourceScope
} from '../shared/contracts/notebook'

export interface DesktopApi {
  app: {
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
  review: {
    listIssues(input: ListReviewIssuesIpcInput): Promise<ListReviewIssuesResult>
    issueEvents(input: ReviewIssueEventsInput): Promise<ReviewIssueEvent[]>
    updateIssue(input: UpdateReviewIssueIpcInput): Promise<ReviewIssueRecord>
    updateWritingRules(input: UpdateWritingRulesIpcInput): Promise<ManuscriptWorkspace>
  }
  annotations: {
    list(input: ListAnnotationsInput): Promise<ListAnnotationsResult>
    create(input: CreateAnnotationInput): Promise<AnnotationRecord>
    update(input: UpdateAnnotationInput): Promise<AnnotationRecord>
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
    async getCitationDisplayMode() {
      return citationDisplayModeSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.appGetCitationDisplayMode)
      )
    },
    async setCitationDisplayMode(input) {
      return citationDisplayModeSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.appSetCitationDisplayMode,
          setCitationDisplayModeInputSchema.parse(input)
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
    },
    async getOnboardingState() {
      return onboardingStateSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.appGetOnboardingState)
      )
    },
    async setOnboardingState(input) {
      return onboardingStateSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.appSetOnboardingState,
          setOnboardingStateInputSchema.parse(input)
        )
      )
    },
    async publicationPresets() {
      return publicationPresetSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.publicationPresetsSnapshot)
      )
    },
    async createPublicationPreset(input) {
      return publicationPresetSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.publicationPresetsCreate,
          createPublicationPresetInputSchema.parse(input)
        )
      )
    },
    async updatePublicationPreset(input) {
      return publicationPresetSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.publicationPresetsUpdate,
          updatePublicationPresetInputSchema.parse(input)
        )
      )
    },
    async deletePublicationPreset(input) {
      return publicationPresetSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.publicationPresetsDelete,
          publicationPresetIdInputSchema.parse(input)
        )
      )
    },
    async setDefaultPublicationPreset(input) {
      return publicationPresetSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.publicationPresetsSetDefault,
          publicationPresetIdInputSchema.parse(input)
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
    async clone(input) {
      return projectSelectionResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.projectClone, projectCloneInputSchema.parse(input))
      )
    },
    async cancelClone(input) {
      return projectCloneCancelResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectCloneCancel,
          projectCloneInputSchema.parse(input)
        )
      )
    },
    async templates() {
      return projectTemplateCatalogSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.projectTemplatesList)
      )
    },
    async previewTemplate(input) {
      return projectTemplateExtractionPreviewSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectTemplatePreview,
          projectSessionInputSchema.parse(input)
        )
      )
    },
    async saveTemplate(input) {
      return projectTemplateCatalogSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectTemplateSave,
          saveUserProjectTemplateInputSchema.parse(input)
        )
      )
    },
    async deleteTemplate(input) {
      return projectTemplateCatalogSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectTemplateDelete,
          deleteUserProjectTemplateInputSchema.parse(input)
        )
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
    async cancelManuscriptExport(input) {
      return manuscriptExportCancelResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.projectManuscriptExportCancel,
          projectSessionInputSchema.parse(input)
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
    async createImportPlan(input) {
      return manuscriptImportPlanResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorCreateImportPlan,
          manuscriptImportPlanRequestSchema.parse(input)
        )
      )
    },
    async applyImportPlan(input) {
      return manuscriptImportApplyResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorApplyImportPlan,
          manuscriptImportApplyInputSchema.parse(input)
        )
      )
    },
    async cancelImportPlan(input) {
      return manuscriptImportCancelResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorCancelImportPlan,
          manuscriptImportCancelInputSchema.parse(input)
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
    async listAssets(input) {
      return manuscriptAssetWorkspacePageSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorListAssets,
          manuscriptAssetWorkspaceInputSchema.parse(input)
        )
      )
    },
    async deleteAsset(input) {
      return deleteManuscriptAssetResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.editorDeleteAsset,
          deleteManuscriptAssetInputSchema.parse(input)
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
    async references(input) {
      return manuscriptReferenceIndexSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptGetReferences,
          manuscriptReferenceIndexInputSchema.parse(input)
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
    async publicationPreview(input) {
      return publicationPreviewSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptGetPublicationPreview,
          publicationPreviewInputSchema.parse(input)
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
    },
    async search(input) {
      return manuscriptSearchResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptSearch,
          manuscriptSearchInputSchema.parse(input)
        )
      )
    },
    async revalidateSearch(input) {
      return manuscriptSearchNavigationResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptSearchRevalidate,
          manuscriptSearchNavigationInputSchema.parse(input)
        )
      )
    },
    async createReplacementPlan(input) {
      return manuscriptReplacementPlanResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptReplacementPlan,
          manuscriptReplacementPlanInputSchema.parse(input)
        )
      )
    },
    async replacementPage(input) {
      return manuscriptReplacementPageResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptReplacementPage,
          manuscriptReplacementPageInputSchema.parse(input)
        )
      )
    },
    async dismissReplacementPlan(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptReplacementDismiss,
        manuscriptReplacementDismissInputSchema.parse(input)
      )
    },
    async applyReplacement(input) {
      return manuscriptReplacementApplyResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptReplacementApply,
          manuscriptReplacementApplyInputSchema.parse(input)
        )
      )
    },
    async undoReplacement(input) {
      return manuscriptReplacementUndoResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.manuscriptReplacementUndo,
          manuscriptReplacementUndoInputSchema.parse(input)
        )
      )
    },
    async subscribeReplacementChanges(input, listener) {
      const subscription = manuscriptReplacementSubscriptionInputSchema.parse({
        ...input,
        subscriptionId: globalThis.crypto.randomUUID()
      })
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const changed = manuscriptReplacementChangedEventSchema.parse(value)
        if (changed.projectSessionId === input.projectSessionId) listener(changed)
      }
      ipcRenderer.on(IPC_CHANNELS.manuscriptReplacementChanged, handler)
      try {
        await ipcRenderer.invoke(IPC_CHANNELS.manuscriptReplacementSubscribe, subscription)
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.manuscriptReplacementChanged, handler)
        throw err
      }
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.manuscriptReplacementChanged, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.manuscriptReplacementUnsubscribe, subscription)
      }
    }
  },
  review: {
    async listIssues(input) {
      return listReviewIssuesResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.reviewListIssues,
          listReviewIssuesIpcInputSchema.parse(input)
        )
      )
    },
    async issueEvents(input) {
      return reviewIssueEventsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.reviewIssueEvents,
          reviewIssueEventsInputSchema.parse(input)
        )
      )
    },
    async updateIssue(input) {
      return updateReviewIssueIpcResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.reviewUpdateIssue,
          updateReviewIssueIpcInputSchema.parse(input)
        )
      )
    },
    async updateWritingRules(input) {
      return manuscriptWorkspaceSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.reviewUpdateWritingRules,
          updateWritingRulesIpcInputSchema.parse(input)
        )
      )
    }
  },
  annotations: {
    async list(input) {
      return listAnnotationsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.annotationsList,
          listAnnotationsInputSchema.parse(input)
        )
      )
    },
    async create(input) {
      return annotationRecordSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.annotationsCreate,
          createAnnotationInputSchema.parse(input)
        )
      )
    },
    async update(input) {
      return annotationRecordSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.annotationsUpdate,
          updateAnnotationInputSchema.parse(input)
        )
      )
    }
  },
  agent: {
    async listSessions(input) {
      return agentListSessionsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentListSessions,
          agentListSessionsInputSchema.parse(input)
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
    async generateSessionTitle(input) {
      return agentGenerateSessionTitleResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentGenerateSessionTitle,
          agentGenerateSessionTitleInputSchema.parse(input)
        )
      )
    },
    async archiveSession(input) {
      return agentArchiveSessionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentArchiveSession,
          agentArchiveSessionInputSchema.parse(input)
        )
      )
    },
    async restoreSession(input) {
      return agentRestoreSessionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentRestoreSession,
          agentRestoreSessionInputSchema.parse(input)
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
    async updateWritingTask(input) {
      return userUpdateWritingTaskResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentUpdateWritingTask,
          userUpdateWritingTaskInputSchema.parse(input)
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
    async steerPendingFollowUp(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentSteerPendingFollowUp,
        agentPendingMessageActionInputSchema.parse(input)
      )
    },
    async deletePendingFollowUp(input) {
      await ipcRenderer.invoke(
        IPC_CHANNELS.agentDeletePendingFollowUp,
        agentPendingMessageActionInputSchema.parse(input)
      )
    },
    async abortRun(input) {
      await ipcRenderer.invoke(IPC_CHANNELS.agentAbortRun, agentRunInputSchema.parse(input))
    },
    async answerUserQuestion(input) {
      agentAnswerUserQuestionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentAnswerUserQuestion,
          agentAnswerUserQuestionInputSchema.parse(input)
        )
      )
    },
    async compactSession(input) {
      return agentCompactSessionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentCompactSession,
          agentCompactSessionInputSchema.parse(input)
        )
      )
    },
    async stopCompaction(input) {
      agentStopCompactionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentStopCompaction,
          agentStopCompactionInputSchema.parse(input)
        )
      )
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
        if (parsed.kind === 'activity') return
        const sessionId =
          parsed.kind === 'durable'
            ? parsed.event.agentSessionId
            : parsed.kind === 'session'
              ? parsed.session.agentSessionId
              : parsed.agentSessionId
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
    async subscribeActivity(input, listener) {
      const subscription = agentProjectActivitySubscriptionInputSchema.parse({
        ...input,
        subscriptionId: globalThis.crypto.randomUUID()
      })
      let replaying = true
      let disposed = false
      const queued: AgentRendererEvent[] = []
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const parsed = agentRendererEventSchema.parse(value)
        if (parsed.projectSessionId !== subscription.projectSessionId || disposed) return
        if (replaying) queued.push(parsed)
        else listener(parsed)
      }
      ipcRenderer.on(IPC_CHANNELS.agentActivity, handler)
      try {
        const snapshot = agentProjectActivitySnapshotSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.agentSubscribeActivity, subscription)
        )
        return {
          snapshot,
          activate: async () => {
            if (disposed || !replaying) return
            await ipcRenderer.invoke(IPC_CHANNELS.agentCompleteActivitySnapshot, subscription)
            replaying = false
            for (const event of queued.splice(0)) listener(event)
          },
          unsubscribe: () => {
            disposed = true
            ipcRenderer.removeListener(IPC_CHANNELS.agentActivity, handler)
            void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeActivity, subscription)
          }
        }
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.agentActivity, handler)
        void ipcRenderer.invoke(IPC_CHANNELS.agentUnsubscribeActivity, subscription)
        throw err
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
    async decideChangeSet(input) {
      return changeSetBatchResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.agentChangeSetBatch,
          changeSetBatchInputSchema.parse(input)
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
    async citationCoveragePage(input) {
      return knowledgeCitationCoveragePageResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeCitationCoveragePage,
          knowledgeCitationCoveragePageInputSchema.parse(input)
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
    },
    async resolveReadableCitation(input) {
      return readableCitationResolutionResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.knowledgeResolveReadableCitation,
          readableCitationResolutionInputSchema.parse(input)
        )
      )
    }
  },
  notebook: {
    async snapshot(input) {
      return notebookChatSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.notebookChatSnapshot,
          notebookChatSnapshotInputSchema.parse(input)
        )
      )
    },
    async startTurn(input) {
      return notebookChatStartTurnResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.notebookChatStartTurn,
          notebookChatStartTurnInputSchema.parse(input)
        )
      )
    },
    async stopTurn(input) {
      return notebookChatCommandResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.notebookChatStopTurn,
          notebookChatStopTurnInputSchema.parse(input)
        )
      )
    },
    async clear(input) {
      return notebookChatCommandResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.notebookChatClear,
          notebookChatClearInputSchema.parse(input)
        )
      )
    },
    async setSources(input) {
      return notebookChatCommandResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.notebookChatSetSources,
          notebookChatSetSourcesInputSchema.parse(input)
        )
      )
    },
    async setModel(input) {
      return notebookChatCommandResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.notebookChatSetModel,
          notebookChatSetModelInputSchema.parse(input)
        )
      )
    },
    async setThinkingLevel(input) {
      return notebookChatCommandResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.notebookChatSetThinkingLevel,
          notebookChatSetThinkingLevelInputSchema.parse(input)
        )
      )
    },
    async subscribe(input, listener) {
      const parsedInput = notebookChatSubscribeInputSchema.parse(input)
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        const notebookEvent = notebookChatEventSchema.parse(value)
        if (notebookEvent.projectSessionId === parsedInput.projectSessionId) {
          listener(notebookEvent)
        }
      }
      ipcRenderer.on(IPC_CHANNELS.notebookChatEvent, handler)
      try {
        const result = notebookChatSubscribeResultSchema.parse(
          await ipcRenderer.invoke(IPC_CHANNELS.notebookChatSubscribe, parsedInput)
        )
        return {
          snapshot: result.snapshot,
          unsubscribe: () => {
            ipcRenderer.removeListener(IPC_CHANNELS.notebookChatEvent, handler)
            void ipcRenderer.invoke(
              IPC_CHANNELS.notebookChatUnsubscribe,
              notebookChatUnsubscribeInputSchema.parse(parsedInput)
            )
          }
        }
      } catch (err) {
        ipcRenderer.removeListener(IPC_CHANNELS.notebookChatEvent, handler)
        throw err
      }
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
    async setActiveImage(input) {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.providersSetActiveImage,
          imageProviderSelectionInputSchema.parse(input)
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
