export type NodeKind =
  | 'container'
  | 'author_text'
  | 'generation_candidate'
  | 'revision_candidate'
  | 'review_comment'
  | 'source_note';

export type EdgeKind =
  | 'informs'
  | 'generates'
  | 'reviews'
  | 'revises'
  | 'addresses'
  | 'related-to';

export type AuthorTextLifecycleStatus = 'draft' | 'active' | 'archived';

export type ReviewStatus =
  | 'not_reviewed'
  | 'review_passed'
  | 'review_warnings'
  | 'review_stale';

export type ReviewCommentSource = 'manual' | 'llm';

export type ReviewCommentStatus = 'open' | 'addressed' | 'wont_fix';

export type ReviewCommentSeverity = 'note' | 'minor' | 'major';

export type ContainerRecord = {
  id: string;
  title: string;
  intent: string | null;
  parentId: string | null;
  activeAuthorTextId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContainerTreeNode = ContainerRecord & {
  children: ContainerTreeNode[];
};

export type ArtifactRecord = {
  id: string;
  kind: Exclude<NodeKind, 'container'>;
  containerId: string | null;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AuthorTextRecord = {
  artifactId: string;
  containerId: string;
  content: string;
  lifecycleStatus: AuthorTextLifecycleStatus;
  reviewStatus: ReviewStatus;
  createdFromArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewCommentRecord = {
  id: string;
  artifactId: string;
  targetAuthorTextId: string;
  startOffset: number | null;
  endOffset: number | null;
  quotedText: string | null;
  prefixText: string | null;
  suffixText: string | null;
  source: ReviewCommentSource;
  reviewerLabel: string | null;
  content: string;
  status: ReviewCommentStatus;
  severity: ReviewCommentSeverity | null;
  createdAt: string;
  updatedAt: string;
};

export type ProcessEdgeRecord = {
  id: string;
  fromArtifactId: string;
  toArtifactId: string;
  relationType: EdgeKind;
  createdBy: 'user' | 'llm' | 'system';
  createdAt: string;
};

export type WorkspaceSummary = {
  path: string;
  rootContainerId: string;
};

export type FocusedWorkspaceState = {
  workspace: WorkspaceSummary | null;
  compositionTree: ContainerTreeNode[];
  focusContainerId: string | null;
  containers: ContainerRecord[];
  artifacts: ArtifactRecord[];
  authorTexts: AuthorTextRecord[];
  reviewComments: ReviewCommentRecord[];
  edges: ProcessEdgeRecord[];
};

export type CreateContainerPayload = {
  title: string;
  intent?: string;
};

export type CreateArtifactPayload = {
  title?: string;
  content: string;
};

export type CreateReviewCommentPayload = {
  source: ReviewCommentSource;
  reviewerLabel?: string;
  content: string;
  severity?: ReviewCommentSeverity;
};

export type TextRange = {
  startOffset?: number;
  endOffset?: number;
};

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
  containerId: string;
  prompt: string;
  systemPrompt?: string;
};

export type SaveLlmGenerationPayload = {
  containerId: string;
  prompt: string;
  content: string;
};

export type LlmStreamEvent =
  | {
      type: 'started';
      runId: string;
      containerId: string;
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
