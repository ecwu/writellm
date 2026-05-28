import type {
  ApplySectionLlmEditPayload,
  AdoptGenerationPayload,
  CreatePatchFromGenerationRoundPayload,
  CreateKnowledgeItemPayload,
  CreateGenerationTaskPayload,
  CreateGenerationTaskResult,
  EnqueueKnowledgeFilesPayload,
  CreateNodePayload,
  EdgeKind,
  FocusedWorkspaceState,
  GenerationRoundRecord,
  GenerationSessionRecord,
  GenerateLlmPayload,
  GitHistoryRecord,
  GitStatusRecord,
  KnowledgeDebugDetails,
  KnowledgeRetrievalTraceEvent,
  KnowledgeSearchPayload,
  KnowledgeSourceTarget,
  LlmStreamEvent,
  NodeEdgeRecord,
  PublicLlmSettings,
  RecentWorkspace,
  RetrievedKnowledgeSource,
  ResolveKnowledgeCitationPayload,
  SaveLlmGenerationPayload,
  SectionHistoryDetail,
  UpdateAppearanceSettingsPayload,
  UpdateKnowledgeItemPayload,
  UpdateLlmSettingsPayload,
  UpdateNodeLayoutPayload,
  UpdateNodePayload,
  WorkspaceSummary,
  WritingPatchRecord
} from './types.js';

export const ipcChannels = {
  createWorkspace: 'writellm:createWorkspace',
  openWorkspace: 'writellm:openWorkspace',
  listRecentWorkspaces: 'writellm:listRecentWorkspaces',
  pickWorkspaceFolder: 'writellm:pickWorkspaceFolder',
  pickNewWorkspacePath: 'writellm:pickNewWorkspacePath',
  pickKnowledgeFiles: 'writellm:pickKnowledgeFiles',
  getState: 'writellm:getState',
  updateSectionMarkdown: 'writellm:updateSectionMarkdown',
  getGitStatus: 'writellm:getGitStatus',
  createGitCheckpoint: 'writellm:createGitCheckpoint',
  listGitHistory: 'writellm:listGitHistory',
  getSectionHistoryDetail: 'writellm:getSectionHistoryDetail',
  restoreSectionVersion: 'writellm:restoreSectionVersion',
  createNode: 'writellm:createNode',
  updateNode: 'writellm:updateNode',
  deleteNode: 'writellm:deleteNode',
  moveNode: 'writellm:moveNode',
  setActiveMainNode: 'writellm:setActiveMainNode',
  createNodeEdge: 'writellm:createNodeEdge',
  updateNodeEdge: 'writellm:updateNodeEdge',
  deleteNodeEdge: 'writellm:deleteNodeEdge',
  updateNodeLayout: 'writellm:updateNodeLayout',
  exportLatex: 'writellm:exportLatex',
  getLlmSettings: 'writellm:getLlmSettings',
  updateLlmSettings: 'writellm:updateLlmSettings',
  updateAppearanceSettings: 'writellm:updateAppearanceSettings',
  createKnowledgeItem: 'writellm:createKnowledgeItem',
  enqueueKnowledgeFiles: 'writellm:enqueueKnowledgeFiles',
  retryKnowledgeIngestJob: 'writellm:retryKnowledgeIngestJob',
  deleteKnowledgeIngestJob: 'writellm:deleteKnowledgeIngestJob',
  updateKnowledgeItem: 'writellm:updateKnowledgeItem',
  deleteKnowledgeItem: 'writellm:deleteKnowledgeItem',
  reindexKnowledgeItem: 'writellm:reindexKnowledgeItem',
  searchKnowledge: 'writellm:searchKnowledge',
  resolveKnowledgeCitation: 'writellm:resolveKnowledgeCitation',
  getKnowledgeDebugDetails: 'writellm:getKnowledgeDebugDetails',
  getWorkspaceAssetDataUrl: 'writellm:getWorkspaceAssetDataUrl',
  createGenerationTask: 'writellm:createGenerationTask',
  cancelGenerationTask: 'writellm:cancelGenerationTask',
  adoptGenerationTask: 'writellm:adoptGenerationTask',
  discardGenerationTask: 'writellm:discardGenerationTask',
  retryGenerationTask: 'writellm:retryGenerationTask',
  createPatchFromGenerationRound: 'writellm:createPatchFromGenerationRound',
  getWritingPatch: 'writellm:getWritingPatch',
  listWritingPatchesForSection: 'writellm:listWritingPatchesForSection',
  acceptWritingPatch: 'writellm:acceptWritingPatch',
  rejectWritingPatch: 'writellm:rejectWritingPatch',
  saveWritingPatchAsCandidate: 'writellm:saveWritingPatchAsCandidate',
  listGenerationSessions: 'writellm:listGenerationSessions',
  listGenerationRounds: 'writellm:listGenerationRounds',
  getGenerationRound: 'writellm:getGenerationRound',
  generateWithLlm: 'writellm:generateWithLlm',
  cancelLlmGeneration: 'writellm:cancelLlmGeneration',
  saveLlmGeneration: 'writellm:saveLlmGeneration',
  applySectionLlmEdit: 'writellm:applySectionLlmEdit',
  llmStream: 'writellm:llmStream',
  knowledgeRetrievalStream: 'writellm:knowledgeRetrievalStream',
  knowledgeIngestUpdated: 'writellm:knowledgeIngestUpdated'
} as const;

export type WriteLLMIpc = {
  createWorkspace(path: string): Promise<WorkspaceSummary>;
  openWorkspace(path: string): Promise<WorkspaceSummary>;
  listRecentWorkspaces(): Promise<RecentWorkspace[]>;
  pickWorkspaceFolder(): Promise<string | null>;
  pickNewWorkspacePath(): Promise<string | null>;
  pickKnowledgeFiles(): Promise<string[]>;
  getState(focusSectionId?: string): Promise<FocusedWorkspaceState>;
  updateSectionMarkdown(sectionId: string, markdown: string): Promise<FocusedWorkspaceState>;
  getGitStatus(): Promise<GitStatusRecord>;
  createGitCheckpoint(message?: string): Promise<GitHistoryRecord | null>;
  listGitHistory(sectionId?: string): Promise<GitHistoryRecord[]>;
  getSectionHistoryDetail(sectionId: string, commitHash: string): Promise<SectionHistoryDetail>;
  restoreSectionVersion(sectionId: string, commitHash: string): Promise<FocusedWorkspaceState>;
  createNode(payload: CreateNodePayload): Promise<FocusedWorkspaceState>;
  updateNode(nodeId: string, payload: UpdateNodePayload): Promise<FocusedWorkspaceState>;
  deleteNode(nodeId: string): Promise<FocusedWorkspaceState>;
  moveNode(nodeId: string, newParentId: string | null, index: number): Promise<FocusedWorkspaceState>;
  setActiveMainNode(sectionId: string, contentNodeId: string | null): Promise<FocusedWorkspaceState>;
  createNodeEdge(fromNodeId: string, toNodeId: string, relationType: EdgeKind): Promise<NodeEdgeRecord>;
  updateNodeEdge(
    edgeId: string,
    relationType: EdgeKind,
    focusSectionId?: string | null
  ): Promise<FocusedWorkspaceState>;
  deleteNodeEdge(edgeId: string, focusSectionId?: string | null): Promise<FocusedWorkspaceState>;
  updateNodeLayout(payload: UpdateNodeLayoutPayload): Promise<FocusedWorkspaceState>;
  exportLatex(rootNodeId: string): Promise<{ path: string }>;
  getLlmSettings(): Promise<PublicLlmSettings>;
  updateLlmSettings(payload: UpdateLlmSettingsPayload): Promise<PublicLlmSettings>;
  updateAppearanceSettings(payload: UpdateAppearanceSettingsPayload): Promise<PublicLlmSettings>;
  createKnowledgeItem(payload: CreateKnowledgeItemPayload): Promise<FocusedWorkspaceState>;
  enqueueKnowledgeFiles(payload: EnqueueKnowledgeFilesPayload): Promise<FocusedWorkspaceState>;
  retryKnowledgeIngestJob(jobId: string): Promise<FocusedWorkspaceState>;
  deleteKnowledgeIngestJob(jobId: string): Promise<FocusedWorkspaceState>;
  updateKnowledgeItem(itemId: string, payload: UpdateKnowledgeItemPayload): Promise<FocusedWorkspaceState>;
  deleteKnowledgeItem(itemId: string): Promise<FocusedWorkspaceState>;
  reindexKnowledgeItem(itemId: string): Promise<FocusedWorkspaceState>;
  searchKnowledge(payload: KnowledgeSearchPayload): Promise<RetrievedKnowledgeSource[]>;
  resolveKnowledgeCitation(payload: ResolveKnowledgeCitationPayload): Promise<KnowledgeSourceTarget | null>;
  getKnowledgeDebugDetails(): Promise<KnowledgeDebugDetails>;
  getWorkspaceAssetDataUrl(relativePath: string): Promise<string>;
  createGenerationTask(payload: CreateGenerationTaskPayload): Promise<CreateGenerationTaskResult>;
  cancelGenerationTask(roundId: string): Promise<GenerationRoundRecord>;
  adoptGenerationTask(payload: AdoptGenerationPayload): Promise<WritingPatchRecord>;
  discardGenerationTask(roundId: string): Promise<void>;
  retryGenerationTask(roundId: string): Promise<CreateGenerationTaskResult>;
  createPatchFromGenerationRound(payload: CreatePatchFromGenerationRoundPayload): Promise<WritingPatchRecord>;
  getWritingPatch(patchId: string): Promise<WritingPatchRecord | null>;
  listWritingPatchesForSection(sectionId: string): Promise<WritingPatchRecord[]>;
  acceptWritingPatch(patchId: string): Promise<FocusedWorkspaceState>;
  rejectWritingPatch(patchId: string): Promise<WritingPatchRecord>;
  saveWritingPatchAsCandidate(patchId: string): Promise<FocusedWorkspaceState>;
  listGenerationSessions(sectionId?: string | null): Promise<GenerationSessionRecord[]>;
  listGenerationRounds(sessionId: string): Promise<GenerationRoundRecord[]>;
  getGenerationRound(roundId: string): Promise<GenerationRoundRecord | null>;
  generateWithLlm(
    payload: GenerateLlmPayload
  ): Promise<{ runId: string; content: string; canceled: boolean; sources?: RetrievedKnowledgeSource[] }>;
  cancelLlmGeneration(runId: string): Promise<void>;
  saveLlmGeneration(payload: SaveLlmGenerationPayload): Promise<FocusedWorkspaceState>;
  applySectionLlmEdit(payload: ApplySectionLlmEditPayload): Promise<FocusedWorkspaceState>;
  onLlmStream(callback: (event: LlmStreamEvent) => void): () => void;
  onKnowledgeRetrievalStream(callback: (event: KnowledgeRetrievalTraceEvent) => void): () => void;
  onKnowledgeIngestUpdated(callback: () => void): () => void;
};
