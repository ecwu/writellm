export type NodeKind = 'section' | 'content';

export type EdgeKind = 'informs' | 'generates' | 'revises' | 'related-to' | 'cites';

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
  markdownPath: string;
  markdownContent: string;
  markdownHash: string;
  citationSources: RetrievedKnowledgeSource[];
};

export type ContentNodeRecord = BaseNodeRecord & {
  kind: 'content';
  parentId: string;
  content: string;
  isMain: boolean;
  isLlm: boolean;
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

export type RecentWorkspace = {
  path: string;
  name: string;
  openedAt: string;
};

export type FocusedWorkspaceState = {
  workspace: WorkspaceSummary | null;
  compositionTree: CompositionTreeNode[];
  focusSectionId: string | null;
  nodes: NodeRecord[];
  visibleNodes: NodeRecord[];
  contextNodes: ContentNodeRecord[];
  knowledgeItems: KnowledgeItemRecord[];
  knowledgeIngestJobs: KnowledgeIngestJobRecord[];
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
  metadata?: Record<string, unknown>;
};

export type CreateNodePayload = CreateSectionNodePayload | CreateContentNodePayload;

export type UpdateSectionNodePayload = {
  title?: string;
  intent?: string | null;
  activeMainNodeId?: string | null;
  markdownContent?: string;
};

export type UpdateContentNodePayload = {
  title?: string;
  content?: string;
  isMain?: boolean;
  isLlm?: boolean;
  metadata?: Record<string, unknown>;
};

export type UpdateNodePayload = UpdateSectionNodePayload | UpdateContentNodePayload;

export type UpdateNodeLayoutPayload = Omit<CanvasNodeLayout, 'updatedAt'>;

export type LlmProviderKind = 'openai-compatible' | 'anthropic-compatible';

export type UpdateLlmSettingsPayload = {
  provider: LlmProviderKind;
  baseURL: string;
  model: string;
  apiKey?: string;
  embeddingProvider?: LlmProviderKind;
  embeddingBaseURL?: string;
  embeddingModel?: string;
  embeddingApiKey?: string;
  visionProvider?: LlmProviderKind;
  visionBaseURL?: string;
  visionModel?: string;
  visionApiKey?: string;
  knowledgePdfExtractionEngine?: PdfExtractionEngine;
  mineruApiKey?: string;
  mineruModelVersion?: MineruModelVersion;
  mineruLanguage?: string;
  mineruIsOcr?: boolean;
  mineruEnableTable?: boolean;
  mineruEnableFormula?: boolean;
};

export type ThemeMode = 'light' | 'dark';

export type AppearanceSettings = {
  theme: ThemeMode;
};

export type UpdateAppearanceSettingsPayload = {
  theme: ThemeMode;
};

export type ModelEndpointSettings = {
  provider: LlmProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
};

export type PublicModelEndpointSettings = Omit<ModelEndpointSettings, 'apiKey'> & {
  hasApiKey: boolean;
};

export type PdfExtractionEngine = 'pdfjs' | 'mineru';

export type MineruModelVersion = 'pipeline' | 'vlm';

export type MineruSettings = {
  apiKey: string;
  modelVersion: MineruModelVersion;
  language: string;
  isOcr: boolean;
  enableTable: boolean;
  enableFormula: boolean;
};

export type PublicMineruSettings = Omit<MineruSettings, 'apiKey'> & {
  hasApiKey: boolean;
};

export type KnowledgeSettings = {
  pdfExtractionEngine: PdfExtractionEngine;
  mineru: MineruSettings;
};

export type PublicKnowledgeSettings = {
  pdfExtractionEngine: PdfExtractionEngine;
  mineru: PublicMineruSettings;
};

export type ModelSettingsProfile = {
  chat: ModelEndpointSettings;
  embedding: ModelEndpointSettings;
  vision: ModelEndpointSettings;
};

export type PublicModelSettingsProfile = {
  chat: PublicModelEndpointSettings;
  embedding: PublicModelEndpointSettings;
  vision: PublicModelEndpointSettings;
};

export type LlmSettings = ModelSettingsProfile & {
  appearance: AppearanceSettings;
  knowledge: KnowledgeSettings;
};

export type PublicLlmSettings = PublicModelSettingsProfile & {
  appearance: AppearanceSettings;
  knowledge: PublicKnowledgeSettings;
};

export type KnowledgeIndexStatus = 'pending' | 'indexed' | 'error';

export type KnowledgeItemRecord = {
  id: string;
  publicRef: string;
  title: string;
  content: string;
  sourceType: 'text' | 'file';
  indexStatus: KnowledgeIndexStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeIngestStatus = 'queued' | 'uploading' | 'extracting' | 'downloading' | 'indexing' | 'indexed' | 'error';

export type KnowledgeIngestJobRecord = {
  id: string;
  filePath: string;
  fileName: string;
  fileExt: string;
  fileSize: number;
  knowledgeItemId: string | null;
  status: KnowledgeIngestStatus;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type KnowledgeChunkRecord = {
  id: string;
  publicRef: string;
  itemId: string;
  itemPublicRef: string;
  itemTitle: string;
  itemDescription?: string;
  chunkIndex: number;
  content: string;
  embeddingModel: string | null;
  score?: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeCitationRecord = {
  id: string;
  generationNodeId: string;
  publicRef: string;
  knowledgeItemId: string;
  knowledgeChunkId: string;
  label: string;
  snippet: string;
  score: number | null;
  createdAt: string;
};

export type RetrievedKnowledgeSource = {
  label: string;
  publicRef: string;
  itemId: string;
  itemPublicRef: string;
  itemTitle: string;
  itemDescription?: string;
  chunkId: string;
  chunkIndex: number;
  snippet: string;
  score: number;
};

export type KnowledgeSourceTarget = {
  publicRef: string;
  itemId: string;
  itemPublicRef: string;
  itemTitle: string;
  itemDescription?: string;
  chunkId: string;
  chunkIndex: number;
  snippet: string;
};

export type ResolveKnowledgeCitationPayload = {
  publicRef?: string;
  chunkId?: string;
};

export type GitStatusRecord = {
  branch: string | null;
  dirty: boolean;
  entries: Array<{
    path: string;
    status: string;
  }>;
};

export type GitHistoryRecord = {
  hash: string;
  shortHash: string;
  subject: string;
  authorDate: string;
};

export type CreateKnowledgeItemPayload = {
  title: string;
  content: string;
};

export type EnqueueKnowledgeFilesPayload = {
  filePaths: string[];
};

export type UpdateKnowledgeItemPayload = {
  title?: string;
  content?: string;
};

export type KnowledgeSearchPayload = {
  query: string;
  excludedItemIds?: string[];
  excludedChunkIds?: string[];
  maxChunks?: number;
};

export type KnowledgeChunkingDebugConfig = {
  targetChars: number;
  overlapChars: number;
  embeddingBatchSize: number;
};

export type KnowledgeChunkDebugRecord = {
  id: string;
  publicRef: string;
  chunkIndex: number;
  content: string;
  contentLength: number;
  embeddingModel: string | null;
  embeddingDimensions: number;
  embeddingPreview: number[];
  embeddingNorm: number | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeItemDebugRecord = {
  itemId: string;
  publicRef: string;
  title: string;
  sourceType: KnowledgeItemRecord['sourceType'];
  indexStatus: KnowledgeIndexStatus;
  contentLength: number;
  chunkCount: number;
  chunks: KnowledgeChunkDebugRecord[];
};

export type KnowledgeDebugDetails = {
  chunking: KnowledgeChunkingDebugConfig;
  items: KnowledgeItemDebugRecord[];
  generatedAt: string;
};

export type GenerateLlmPayload = {
  runId: string;
  sectionId: string;
  focusSectionId?: string | null;
  prompt: string;
  contextNodeIds?: string[];
  excludedKnowledgeItemIds?: string[];
  excludedKnowledgeChunkIds?: string[];
  maxKnowledgeChunks?: number;
  requireInlineCitations?: boolean;
  systemPrompt?: string;
};

export type SaveLlmGenerationPayload = {
  sectionId: string;
  focusSectionId?: string | null;
  prompt: string;
  content: string;
  contextNodeIds?: string[];
  retrievedSources?: RetrievedKnowledgeSource[];
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
      sources?: RetrievedKnowledgeSource[];
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
