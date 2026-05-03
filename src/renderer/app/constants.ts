
import type { EdgeKind, FocusedWorkspaceState } from '../../shared/types';
import type { LlmDraftState } from './types';

export const emptyState: FocusedWorkspaceState = {
  workspace: null,
  compositionTree: [],
  focusSectionId: null,
  nodes: [],
  visibleNodes: [],
  contextNodes: [],
  knowledgeItems: [],
  knowledgeIngestJobs: [],
  nodeStats: {},
  edges: [],
  nodeLayouts: []
};

export const emptyLlmDraft: LlmDraftState = {
  open: false,
  runId: null,
  targetSectionId: null,
  prompt: '',
  contextNodeIds: [],
  retrievedSources: [],
  excludedKnowledgeItemIds: [],
  excludedKnowledgeChunkIds: [],
  content: '',
  status: 'idle'
};

export const DEFAULT_NODE_WIDTH = 210;
export const DEFAULT_NODE_HEIGHT = 96;
export const DEFAULT_CONTENT_NODE_WIDTH = 280;
export const DEFAULT_CONTENT_NODE_HEIGHT = 180;
export const DEFAULT_EDGE_KIND: EdgeKind = 'related-to';
