import type {
  CreateKnowledgeItemPayload,
  CreateNodePayload,
  EdgeKind,
  FocusedWorkspaceState,
  GenerateLlmPayload,
  KnowledgeSearchPayload,
  LlmStreamEvent,
  NodeEdgeRecord,
  PublicLlmSettings,
  RecentWorkspace,
  RetrievedKnowledgeSource,
  SaveLlmGenerationPayload,
  UpdateKnowledgeItemPayload,
  UpdateLlmSettingsPayload,
  UpdateNodeLayoutPayload,
  UpdateNodePayload,
  WorkspaceSummary
} from './types.js';

export const ipcChannels = {
  createWorkspace: 'paperlab:createWorkspace',
  openWorkspace: 'paperlab:openWorkspace',
  listRecentWorkspaces: 'paperlab:listRecentWorkspaces',
  pickWorkspaceFolder: 'paperlab:pickWorkspaceFolder',
  pickNewWorkspacePath: 'paperlab:pickNewWorkspacePath',
  getState: 'paperlab:getState',
  createNode: 'paperlab:createNode',
  updateNode: 'paperlab:updateNode',
  deleteNode: 'paperlab:deleteNode',
  moveNode: 'paperlab:moveNode',
  setActiveMainNode: 'paperlab:setActiveMainNode',
  createNodeEdge: 'paperlab:createNodeEdge',
  updateNodeEdge: 'paperlab:updateNodeEdge',
  deleteNodeEdge: 'paperlab:deleteNodeEdge',
  updateNodeLayout: 'paperlab:updateNodeLayout',
  exportLatex: 'paperlab:exportLatex',
  getLlmSettings: 'paperlab:getLlmSettings',
  updateLlmSettings: 'paperlab:updateLlmSettings',
  createKnowledgeItem: 'paperlab:createKnowledgeItem',
  updateKnowledgeItem: 'paperlab:updateKnowledgeItem',
  deleteKnowledgeItem: 'paperlab:deleteKnowledgeItem',
  reindexKnowledgeItem: 'paperlab:reindexKnowledgeItem',
  searchKnowledge: 'paperlab:searchKnowledge',
  generateWithLlm: 'paperlab:generateWithLlm',
  cancelLlmGeneration: 'paperlab:cancelLlmGeneration',
  saveLlmGeneration: 'paperlab:saveLlmGeneration',
  llmStream: 'paperlab:llmStream'
} as const;

export type PaperLabIpc = {
  createWorkspace(path: string): Promise<WorkspaceSummary>;
  openWorkspace(path: string): Promise<WorkspaceSummary>;
  listRecentWorkspaces(): Promise<RecentWorkspace[]>;
  pickWorkspaceFolder(): Promise<string | null>;
  pickNewWorkspacePath(): Promise<string | null>;
  getState(focusSectionId?: string): Promise<FocusedWorkspaceState>;
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
  createKnowledgeItem(payload: CreateKnowledgeItemPayload): Promise<FocusedWorkspaceState>;
  updateKnowledgeItem(itemId: string, payload: UpdateKnowledgeItemPayload): Promise<FocusedWorkspaceState>;
  deleteKnowledgeItem(itemId: string): Promise<FocusedWorkspaceState>;
  reindexKnowledgeItem(itemId: string): Promise<FocusedWorkspaceState>;
  searchKnowledge(payload: KnowledgeSearchPayload): Promise<RetrievedKnowledgeSource[]>;
  generateWithLlm(
    payload: GenerateLlmPayload
  ): Promise<{ runId: string; content: string; canceled: boolean; sources?: RetrievedKnowledgeSource[] }>;
  cancelLlmGeneration(runId: string): Promise<void>;
  saveLlmGeneration(payload: SaveLlmGenerationPayload): Promise<FocusedWorkspaceState>;
  onLlmStream(callback: (event: LlmStreamEvent) => void): () => void;
};
