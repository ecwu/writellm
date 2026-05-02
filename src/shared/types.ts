export type NodeKind = 'section' | 'content';

export type EdgeKind = 'informs' | 'generates' | 'revises' | 'related-to';

export type BaseNodeRecord = {
  id: string;
  kind: NodeKind;
  parentId: string | null;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SectionNodeRecord = BaseNodeRecord & {
  kind: 'section';
  intent: string | null;
  activeMainNodeId: string | null;
};

export type ContentNodeRecord = BaseNodeRecord & {
  kind: 'content';
  parentId: string;
  content: string;
  isMain: boolean;
  isLlm: boolean;
  isArtifact: boolean;
  metadata: Record<string, unknown>;
};

export type NodeRecord = SectionNodeRecord | ContentNodeRecord;

export type CompositionTreeNode = SectionNodeRecord & {
  children: CompositionTreeNode[];
};

export type NodeStats = {
  sectionCount: number;
  contentCount: number;
  mainContentCount: number;
  artifactCount: number;
  llmCount: number;
};

export type NodeEdgeRecord = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: EdgeKind;
  createdBy: 'user' | 'llm' | 'system';
  createdAt: string;
};

export type CanvasNodeLayout = {
  canvasSectionId: string;
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  updatedAt: string;
};

export type WorkspaceSummary = {
  path: string;
  rootNodeId: string;
};

export type FocusedWorkspaceState = {
  workspace: WorkspaceSummary | null;
  compositionTree: CompositionTreeNode[];
  focusSectionId: string | null;
  nodes: NodeRecord[];
  visibleNodes: NodeRecord[];
  contextNodes: ContentNodeRecord[];
  nodeStats: Record<string, NodeStats>;
  edges: NodeEdgeRecord[];
  nodeLayouts: CanvasNodeLayout[];
};

export type CreateSectionNodePayload = {
  kind: 'section';
  parentId: string | null;
  title: string;
  intent?: string;
};

export type CreateContentNodePayload = {
  kind: 'content';
  parentId: string;
  title: string;
  content: string;
  isMain?: boolean;
  isLlm?: boolean;
  isArtifact?: boolean;
  metadata?: Record<string, unknown>;
};

export type CreateNodePayload = CreateSectionNodePayload | CreateContentNodePayload;

export type UpdateSectionNodePayload = {
  title?: string;
  intent?: string | null;
  activeMainNodeId?: string | null;
};

export type UpdateContentNodePayload = {
  title?: string;
  content?: string;
  isMain?: boolean;
  isLlm?: boolean;
  isArtifact?: boolean;
  metadata?: Record<string, unknown>;
};

export type UpdateNodePayload = UpdateSectionNodePayload | UpdateContentNodePayload;

export type UpdateNodeLayoutPayload = Omit<CanvasNodeLayout, 'updatedAt'>;

export type LlmProviderKind = 'openai-compatible' | 'anthropic-compatible';

export type LlmSettings = {
  provider: LlmProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
};

export type PublicLlmSettings = Omit<LlmSettings, 'apiKey'> & {
  hasApiKey: boolean;
};

export type UpdateLlmSettingsPayload = {
  provider: LlmProviderKind;
  baseURL: string;
  model: string;
  apiKey?: string;
};

export type GenerateLlmPayload = {
  runId: string;
  sectionId: string;
  focusSectionId?: string | null;
  prompt: string;
  contextNodeIds?: string[];
  systemPrompt?: string;
};

export type SaveLlmGenerationPayload = {
  sectionId: string;
  focusSectionId?: string | null;
  prompt: string;
  content: string;
  contextNodeIds?: string[];
  contextRelationType?: EdgeKind;
};

export type LlmStreamEvent =
  | {
      type: 'started';
      runId: string;
      sectionId: string;
    }
  | {
      type: 'chunk';
      runId: string;
      content: string;
    }
  | {
      type: 'done';
      runId: string;
      content: string;
    }
  | {
      type: 'canceled';
      runId: string;
    }
  | {
      type: 'error';
      runId: string;
      message: string;
    };
