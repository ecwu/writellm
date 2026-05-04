
import type { Node } from '@xyflow/react';
import type { KnowledgeSourceTarget, NodeRecord, RetrievedKnowledgeSource, UpdateNodeLayoutPayload } from '../../shared/types';

export type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null;

export type ContentPreset = 'main';

export type AppPage = 'workspace' | 'knowledge';

export type ChildViewMode = 'graph' | 'list';

export type LlmDraftState = {
  open: boolean;
  runId: string | null;
  targetSectionId: string | null;
  prompt: string;
  contextNodeIds: string[];
  retrievedSources: RetrievedKnowledgeSource[];
  excludedKnowledgeItemIds: string[];
  excludedKnowledgeChunkIds: string[];
  content: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
};

export type PaperNodeData = Record<string, unknown> & {
  nodeId: string;
  canvasSectionId: string;
  kind: NodeRecord['kind'];
  eyebrow: string;
  title: string;
  meta?: string;
  content?: string;
  citationSources?: RetrievedKnowledgeSource[];
  virtual?: boolean;
  tone: 'child-container' | 'author_text' | 'llm' | 'source';
  layoutKey: string;
  onLayoutChange: (payload: UpdateNodeLayoutPayload) => void;
};

export type PaperNode = Node<PaperNodeData, 'paper'>;

export type KnowledgeNavigationTarget = KnowledgeSourceTarget | null;
