import type {
  CreateArtifactPayload,
  CreateContainerPayload,
  CreateReviewCommentPayload,
  EdgeKind,
  FocusedWorkspaceState,
  GenerateLlmPayload,
  LlmStreamEvent,
  ProcessEdgeRecord,
  PublicLlmSettings,
  ReviewCommentRecord,
  SaveLlmGenerationPayload,
  TextRange,
  UpdateCanvasNodeLayoutPayload,
  UpdateLlmSettingsPayload,
  WorkspaceSummary
} from './types.js';

export const ipcChannels = {
  createWorkspace: 'paperlab:createWorkspace',
  openWorkspace: 'paperlab:openWorkspace',
  getState: 'paperlab:getState',
  createContainer: 'paperlab:createContainer',
  updateContainer: 'paperlab:updateContainer',
  deleteContainer: 'paperlab:deleteContainer',
  moveContainer: 'paperlab:moveContainer',
  createSourceNote: 'paperlab:createSourceNote',
  createAuthorText: 'paperlab:createAuthorText',
  deleteArtifact: 'paperlab:deleteArtifact',
  updateArtifactContent: 'paperlab:updateArtifactContent',
  updateAuthorTextContent: 'paperlab:updateAuthorTextContent',
  setActiveAuthorText: 'paperlab:setActiveAuthorText',
  createReviewComment: 'paperlab:createReviewComment',
  updateReviewCommentStatus: 'paperlab:updateReviewCommentStatus',
  createProcessEdge: 'paperlab:createProcessEdge',
  updateProcessEdge: 'paperlab:updateProcessEdge',
  updateCanvasNodeLayout: 'paperlab:updateCanvasNodeLayout',
  exportLatex: 'paperlab:exportLatex',
  getLlmSettings: 'paperlab:getLlmSettings',
  updateLlmSettings: 'paperlab:updateLlmSettings',
  generateWithLlm: 'paperlab:generateWithLlm',
  cancelLlmGeneration: 'paperlab:cancelLlmGeneration',
  saveLlmGeneration: 'paperlab:saveLlmGeneration',
  llmStream: 'paperlab:llmStream'
} as const;

export type PaperLabIpc = {
  createWorkspace(path: string): Promise<WorkspaceSummary>;
  openWorkspace(path: string): Promise<WorkspaceSummary>;
  getState(focusContainerId?: string): Promise<FocusedWorkspaceState>;
  createContainer(
    parentId: string | null,
    payload: CreateContainerPayload
  ): Promise<FocusedWorkspaceState>;
  updateContainer(
    containerId: string,
    payload: Partial<CreateContainerPayload>
  ): Promise<FocusedWorkspaceState>;
  deleteContainer(containerId: string): Promise<FocusedWorkspaceState>;
  moveContainer(
    containerId: string,
    newParentId: string | null,
    index: number
  ): Promise<FocusedWorkspaceState>;
  createSourceNote(
    containerId: string,
    payload: CreateArtifactPayload
  ): Promise<FocusedWorkspaceState>;
  createAuthorText(
    containerId: string,
    content: string,
    createdFromArtifactId?: string
  ): Promise<FocusedWorkspaceState>;
  deleteArtifact(artifactId: string): Promise<FocusedWorkspaceState>;
  updateArtifactContent(
    artifactId: string,
    content: string
  ): Promise<FocusedWorkspaceState>;
  updateAuthorTextContent(
    authorTextId: string,
    content: string
  ): Promise<FocusedWorkspaceState>;
  setActiveAuthorText(
    containerId: string,
    authorTextId: string
  ): Promise<FocusedWorkspaceState>;
  createReviewComment(
    authorTextId: string,
    range: TextRange,
    payload: CreateReviewCommentPayload
  ): Promise<FocusedWorkspaceState>;
  updateReviewCommentStatus(
    commentId: string,
    status: ReviewCommentRecord['status']
  ): Promise<FocusedWorkspaceState>;
  createProcessEdge(
    fromArtifactId: string,
    toArtifactId: string,
    relationType: EdgeKind
  ): Promise<ProcessEdgeRecord>;
  updateProcessEdge(edgeId: string, relationType: EdgeKind): Promise<FocusedWorkspaceState>;
  updateCanvasNodeLayout(payload: UpdateCanvasNodeLayoutPayload): Promise<FocusedWorkspaceState>;
  exportLatex(rootContainerId: string): Promise<{ path: string }>;
  getLlmSettings(): Promise<PublicLlmSettings>;
  updateLlmSettings(payload: UpdateLlmSettingsPayload): Promise<PublicLlmSettings>;
  generateWithLlm(payload: GenerateLlmPayload): Promise<{ runId: string; content: string; canceled: boolean }>;
  cancelLlmGeneration(runId: string): Promise<void>;
  saveLlmGeneration(payload: SaveLlmGenerationPayload): Promise<FocusedWorkspaceState>;
  onLlmStream(callback: (event: LlmStreamEvent) => void): () => void;
};
