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
  metadata: Record<string, unknown>;
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

export type WorkspaceSummary = {
  path: string;
  rootNodeId: string;
};

export type RecentWorkspace = {
  path: string;
  name: string;
  openedAt: string;
};

export type ProjectGlossaryTerm = {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
  preferredUsage: string;
  avoidUsage: string;
  examples: string[];
};

export type ProjectGlossary = {
  entries: ProjectGlossaryTerm[];
  notes: string;
};

export type ProjectMotivation = {
  audience: string;
  problem: string;
  thesis: string;
  contribution: string;
  desiredReaderAction: string;
  constraints: string;
  notes: string;
};

export type ProjectFrameworkSection = {
  id: string;
  title: string;
  purpose: string;
  keyMoves: string;
  evidence: string;
};

export type ProjectFramework = {
  narrativeArc: string;
  sectionPlan: ProjectFrameworkSection[];
  notes: string;
};

export type ProjectBriefRecord = {
  glossary: ProjectGlossary;
  motivation: ProjectMotivation;
  framework: ProjectFramework;
  createdAt: string | null;
  updatedAt: string | null;
};

export type UpdateProjectBriefPayload = {
  glossary?: ProjectGlossary;
  motivation?: ProjectMotivation;
  framework?: ProjectFramework;
  focusSectionId?: string | null;
};

export type ProjectBriefSuggestionTarget = 'all' | 'glossary' | 'motivation' | 'framework';

export type SuggestProjectBriefPayload = {
  target: ProjectBriefSuggestionTarget;
  currentBrief?: ProjectBriefRecord;
};

export type ProjectBriefSuggestion = {
  target: ProjectBriefSuggestionTarget;
  glossary?: ProjectGlossary;
  motivation?: ProjectMotivation;
  framework?: ProjectFramework;
  rationale: string;
};

export type FocusedWorkspaceState = {
  workspace: WorkspaceSummary | null;
  projectBrief: ProjectBriefRecord;
  compositionTree: CompositionTreeNode[];
  focusSectionId: string | null;
  nodes: NodeRecord[];
  visibleNodes: NodeRecord[];
  contextNodes: ContentNodeRecord[];
  knowledgeItems: KnowledgeItemRecord[];
  knowledgeIngestJobs: KnowledgeIngestJobRecord[];
  nodeStats: Record<string, NodeStats>;
  edges: NodeEdgeRecord[];
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

export type LlmProviderKind = 'openai-compatible' | 'anthropic-compatible' | 'deepseek';

export type RerankProviderKind = 'siliconflow-compatible';

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
  rerankProvider?: RerankProviderKind;
  rerankBaseURL?: string;
  rerankModel?: string;
  rerankApiKey?: string;
  rerankEnabled?: boolean;
  knowledgePdfExtractionEngine?: PdfExtractionEngine;
  mineruApiKey?: string;
  mineruModelVersion?: MineruModelVersion;
  mineruLanguage?: string;
  mineruIsOcr?: boolean;
  mineruEnableTable?: boolean;
  mineruEnableFormula?: boolean;
  knowledgeRetrieval?: Partial<KnowledgeRetrievalSettings>;
  allowExternalProcessing?: boolean;
};

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentColor = 'earth' | 'forest' | 'ochre' | 'cinnabar' | 'deep-teal' | 'plum';
export type AppFontFamily = 'geist' | 'system-sans' | 'serif' | 'mono' | 'humanist-sans';

export type AppearanceSettings = {
  theme: ThemeMode;
  accentColor: AccentColor;
  fontFamily: AppFontFamily;
};

export type UpdateAppearanceSettingsPayload = {
  theme: ThemeMode;
  accentColor: AccentColor;
  fontFamily: AppFontFamily;
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

export type RerankEndpointSettings = {
  provider: RerankProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
  enabled: boolean;
};

export type PublicRerankEndpointSettings = Omit<RerankEndpointSettings, 'apiKey'> & {
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

export type KnowledgeRetrievalSettings = {
  maxRetrievedChunks: number;
  maxCandidateChunks: number;
  rerankTopN: number;
  adjacentChunkRadius: number;
  maxChunksPerItem: number;
  chunkTargetChars: number;
  chunkOverlapChars: number;
  embeddingBatchSize: number;
};

export type KnowledgeSettings = {
  pdfExtractionEngine: PdfExtractionEngine;
  mineru: MineruSettings;
  retrieval: KnowledgeRetrievalSettings;
};

export type PublicKnowledgeSettings = {
  pdfExtractionEngine: PdfExtractionEngine;
  mineru: PublicMineruSettings;
  retrieval: KnowledgeRetrievalSettings;
};

export type ModelSettingsProfile = {
  chat: ModelEndpointSettings;
  embedding: ModelEndpointSettings;
  rerank: RerankEndpointSettings;
  vision: ModelEndpointSettings;
};

export type PublicModelSettingsProfile = {
  chat: PublicModelEndpointSettings;
  embedding: PublicModelEndpointSettings;
  rerank: PublicRerankEndpointSettings;
  vision: PublicModelEndpointSettings;
};

export type LlmSettings = ModelSettingsProfile & {
  appearance: AppearanceSettings;
  knowledge: KnowledgeSettings;
  outboundData: OutboundDataPolicy;
};

export type PublicLlmSettings = PublicModelSettingsProfile & {
  appearance: AppearanceSettings;
  knowledge: PublicKnowledgeSettings;
  outboundData: OutboundDataPolicy;
};

export type OutboundDataPolicy = {
  externalProcessingEnabled: boolean;
  consentedAt: string | null;
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
  retrievalMethod?: 'vector' | 'fts' | 'hybrid' | 'reranked';
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeRetrievalMode = 'classic' | 'sourcev2';

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

export type SectionCitationUsage = {
  sectionId: string;
  sectionTitle: string;
  citationCount: number;
  sources: Array<{
    publicRef: string;
    itemId: string | null;
    itemTitle: string | null;
    mentions: number;
  }>;
};

export type KnowledgeCitationCoverage = {
  itemId: string;
  itemPublicRef: string;
  itemTitle: string;
  indexStatus: KnowledgeIndexStatus;
  representativePublicRef: string | null;
  citationCount: number;
  sectionIds: string[];
};

export type CitationCoverageReport = {
  sections: SectionCitationUsage[];
  sources: KnowledgeCitationCoverage[];
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
  retrievalMethod?: 'vector' | 'fts' | 'hybrid' | 'reranked';
  rerankScore?: number;
  retrievalReason?: string;
  sourceV2Round?: number;
  sourceV2Reason?: string;
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

export type LlmOperationStatus = 'current' | 'edited' | 'stale' | 'superseded';

export type LlmOperationType =
  | 'generate_append'
  | 'rewrite_section'
  | 'rewrite_selection'
  | 'restyle_selection'
  | 'expand_selection'
  | 'continue_at_cursor'
  | 'custom_edit';

export type LlmOperationTarget = {
  kind: 'section_append' | 'section_rewrite' | 'selection' | 'insertion';
  selectionStart?: number;
  selectionEnd?: number;
  selectedText?: string;
  prefixContext?: string;
  suffixContext?: string;
};

export type LlmOperationRecord = {
  operationId: string;
  type: LlmOperationType;
  status: LlmOperationStatus;
  createdAt: string;
  appliedAt: string;
  sectionId: string;
  sectionPath: string;
  beforeCommit: string | null;
  afterCommit: string | null;
  beforeSectionHash: string;
  afterSectionHash: string;
  userPrompt: string;
  resolvedPrompt: string;
  systemPrompt: string;
  model: {
    provider: LlmProviderKind;
    baseURL: string;
    model: string;
  };
  target: LlmOperationTarget;
  beforeText: string;
  afterText: string;
  outputHash: string;
  retainedCoverage: number;
  contextNodeIds: string[];
  retrievedSources: RetrievedKnowledgeSource[];
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

export type SectionHistoryDetail = {
  sectionId: string;
  selectedCommit: GitHistoryRecord;
  parentCommit: GitHistoryRecord | null;
  beforeMarkdown: string;
  afterMarkdown: string;
  unifiedDiff: string;
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
  sectionId?: string;
  focusSectionId?: string | null;
  contextNodeIds?: string[];
  excludedItemIds?: string[];
  excludedChunkIds?: string[];
  maxChunks?: number;
  retrievalMode?: KnowledgeRetrievalMode;
  runId?: string;
};

export type KnowledgeRetrievalTraceEvent =
  | {
      type: 'query_plan';
      runId: string;
      queries: string[];
    }
  | {
      type: 'started';
      runId: string;
      query: string;
      maxRounds: number;
    }
  | {
      type: 'round_started';
      runId: string;
      round: number;
      queries: string[];
    }
  | {
      type: 'round_candidates';
      runId: string;
      round: number;
      sources: RetrievedKnowledgeSource[];
    }
  | {
      type: 'round_evaluating';
      runId: string;
      round: number;
      candidateCount: number;
    }
  | {
      type: 'round_evaluation';
      runId: string;
      round: number;
      decision: 'continue' | 'stop';
      reason: string;
      selectedChunkIds: string[];
      missingEvidence: string[];
      nextQueries: string[];
    }
  | {
      type: 'done';
      runId: string;
      sources: RetrievedKnowledgeSource[];
      stopReason: string;
    }
  | {
      type: 'error';
      runId: string;
      message: string;
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

export type GenerationMode = 'append' | 'rewrite_section' | 'rewrite_selection' | 'continue';
export type GenerationOutputMode = 'patchProposal';

export type GenerationRoundStatus =
  | 'pending'
  | 'retrieving'
  | 'processing'
  | 'done'
  | 'canceled'
  | 'error'
  | 'patch_created'
  | 'patch_accepted'
  | 'patch_rejected'
  | 'saved_as_candidate';

export type GenerationSessionRecord = {
  id: string;
  sectionId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerationRoundRecord = {
  id: string;
  sessionId: string;
  status: GenerationRoundStatus;
  mode: GenerationMode;
  outputMode: GenerationOutputMode;
  prompt: string;
  resolvedPrompt: string | null;
  systemPrompt: string | null;
  content: string | null;
  retrievedSources: RetrievedKnowledgeSource[];
  retrievalTrace: KnowledgeRetrievalTraceEvent[];
  modelProvider: string | null;
  modelName: string | null;
  errorMessage: string | null;
  patchId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  adoptedAt: string | null;
};

export type WritingPatchStatus =
  | 'proposed'
  | 'parse_failed'
  | 'validated'
  | 'validation_failed'
  | 'needs_review'
  | 'blocked'
  | 'accepted'
  | 'rejected'
  | 'saved_as_candidate'
  | 'applied'
  | 'rolled_back';

export type WritingPatchKind =
  | 'replace_selection'
  | 'insert_at_cursor'
  | 'create_content_candidate'
  | 'replace_section';

export type PatchRiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export type PatchOrigin = {
  source: 'llm' | 'user' | 'system' | 'import' | 'workflow';
  generationSessionId?: string;
  generationRoundId?: string;
  revisionTaskId?: string;
  actionId?: string;
  model?: {
    provider: string;
    modelName: string;
    endpointType?: 'openai-compatible' | 'anthropic-compatible' | 'deepseek' | 'local' | 'unknown';
  };
  promptHash?: string;
  contextPackId?: string;
  contextHash?: string;
  createdAt: string;
};

export type TextRangeTarget = {
  type: 'text_range';
  startOffset: number;
  endOffset: number;
  selectedText: string;
};

export type InsertionTarget = {
  type: 'insertion';
  mode: 'cursor' | 'section_end' | 'after_selection';
  offset: number;
  insertionAffinity?: 'before' | 'after';
};

export type SectionTarget = {
  type: 'section';
  sectionHash: string;
};

export type PatchTarget = {
  workspaceId: string;
  sectionId: string;
  contentNodeId?: string;
  targetMode: 'active_content' | 'specific_content_node' | 'section_markdown_file' | 'new_content_node';
  location: TextRangeTarget | InsertionTarget | SectionTarget;
};

export type PatchAnchors = {
  baseSectionHash: string;
  baseContentHash?: string;
  beforeText?: string;
  beforeTextHash?: string;
  prefixContext?: string;
  suffixContext?: string;
  anchorStrategy: 'hash_and_range' | 'section_replace' | 'candidate_only';
};

export type ReplaceOperation = {
  type: 'replace';
  before: string;
  after: string;
  preserveTrailingNewline?: boolean;
};

export type InsertOperation = {
  type: 'insert';
  text: string;
  position: 'before' | 'after' | 'at';
};

export type CreateCandidateOperation = {
  type: 'create_candidate';
  candidateTitle?: string;
  content: string;
  relationToSource?: 'generates' | 'revises' | 'informs' | 'related-to';
};

export type PatchOperation = ReplaceOperation | InsertOperation | CreateCandidateOperation;

export type PatchConstraint = {
  type:
    | 'preserve_claims'
    | 'preserve_citations'
    | 'preserve_numbers'
    | 'preserve_length'
    | 'no_new_claims'
    | 'no_new_citations'
    | 'style_only'
    | 'target_word_count'
    | 'terminology';
  value?: string | number | boolean | string[];
};

export type ClaimChange = {
  claimText: string;
  changeType: 'preserved' | 'added' | 'removed' | 'weakened' | 'strengthened' | 'rephrased' | 'unknown';
  before?: string;
  after?: string;
  requiresReview: boolean;
};

export type CitationChange = {
  citation: string;
  changeType: 'preserved' | 'added' | 'removed' | 'moved' | 'modified' | 'unknown';
  requiresReview: boolean;
};

export type PatchMetadata = {
  title?: string;
  userGoal?: string;
  actionType?: 'draft' | 'revise' | 'compress' | 'expand' | 'polish' | 'translate' | 'restructure' | 'manual';
  rationale?: string;
  expectedEffect?: string;
  constraints?: PatchConstraint[];
  changedClaims?: ClaimChange[];
  preservedClaims?: string[];
  affectedCitations?: CitationChange[];
  riskLevel?: PatchRiskLevel;
  tags?: string[];
  warnings?: string[];
  rawProposal?: string;
  provenance?: {
    generationRoundId?: string;
    piRunId?: string;
    retrievedChunkIds?: string[];
    evidencePublicRefs?: string[];
    citationMarkers?: string[];
  };
};

export type PatchValidationCode =
  | 'TARGET_SECTION_NOT_FOUND'
  | 'TARGET_CONTENT_NOT_FOUND'
  | 'BASE_SECTION_HASH_MISMATCH'
  | 'BEFORE_TEXT_HASH_MISMATCH'
  | 'RANGE_OUT_OF_BOUNDS'
  | 'SELECTED_TEXT_MISMATCH'
  | 'EMPTY_AFTER_TEXT'
  | 'SUSPICIOUSLY_SHORT_OUTPUT'
  | 'SUSPICIOUSLY_LONG_OUTPUT'
  | 'CITATION_REMOVED'
  | 'CITATION_MODIFIED'
  | 'UNRESOLVED_CITATION'
  | 'NUMBER_CHANGED'
  | 'NUMERIC_CLAIM_ADDED'
  | 'MARKDOWN_BROKEN'
  | 'LATEX_BROKEN'
  | 'CLAIM_STRENGTH_INCREASED'
  | 'OUTPUT_PARSE_FAILED'
  | 'UNSUPPORTED_PATCH_KIND'
  | 'UNKNOWN_RISK';

export type PatchValidationIssue = {
  code: PatchValidationCode;
  severity: 'info' | 'warning' | 'error' | 'blocking';
  message: string;
  target?: {
    sectionId?: string;
    range?: {
      startOffset: number;
      endOffset: number;
    };
  };
  suggestion?: string;
};

export type PatchCheckResult = {
  checkKind: 'anchor' | 'length' | 'citation' | 'number' | 'markdown' | 'latex' | 'claim' | 'custom';
  passed: boolean;
  severity: 'info' | 'warning' | 'error' | 'blocking';
  message: string;
  details?: unknown;
};

export type PatchValidationResult = {
  ok: boolean;
  riskLevel: PatchRiskLevel;
  status: 'valid' | 'valid_with_warnings' | 'blocked';
  errors: PatchValidationIssue[];
  warnings: PatchValidationIssue[];
  checks: PatchCheckResult[];
  validatedAt: string;
};

export type PatchDiff = {
  diffKind: 'inline' | 'unified' | 'side_by_side';
  before: string;
  after: string;
  unifiedDiff?: string;
  stats: {
    charsAdded: number;
    charsRemoved: number;
    wordsAdded: number;
    wordsRemoved: number;
    citationsAdded: number;
    citationsRemoved: number;
    numbersChanged: number;
  };
};

export type PatchReview = {
  decision: 'pending' | 'accepted' | 'rejected' | 'saved_as_candidate' | 'needs_revision';
  reviewedBy?: 'user' | 'system';
  reviewedAt?: string;
  userNote?: string;
  selectedWarningsAccepted?: string[];
};

export type PatchApplicationResult = {
  patchId?: string;
  generationSessionId?: string;
  generationRoundId?: string;
  applied: boolean;
  appliedAt?: string;
  appliedBy?: 'user' | 'system';
  sectionId: string;
  contentNodeId?: string;
  previousSectionHash: string;
  newSectionHash?: string;
  previousContentHash?: string;
  newContentHash?: string;
  gitCommitHash?: string;
  gitStatus?: 'created' | 'failed' | 'skipped';
  gitError?: string;
  createdContentNodeId?: string;
  errors?: PatchValidationIssue[];
};

export type WritingPatch = {
  id: string;
  kind: WritingPatchKind;
  status: WritingPatchStatus;
  origin: PatchOrigin;
  target: PatchTarget;
  anchors: PatchAnchors;
  operation: PatchOperation;
  metadata: PatchMetadata;
  validation?: PatchValidationResult;
  diff?: PatchDiff;
  review?: PatchReview;
  application?: PatchApplicationResult;
};

export type WritingPatchRecord = {
  id: string;
  status: WritingPatchStatus;
  kind: WritingPatchKind;
  sectionId: string;
  contentNodeId: string | null;
  generationSessionId: string | null;
  generationRoundId: string | null;
  riskLevel: PatchRiskLevel | null;
  patch: WritingPatch;
  createdAt: string;
  updatedAt: string;
};

export type LlmPatchProposal = {
  afterText: string;
  rationale: string;
  warnings?: string[];
  changedClaims?: ClaimChange[];
  preservedClaims?: string[];
  affectedCitations?: CitationChange[];
};

export type CreatePatchFromGenerationRoundPayload = {
  roundId: string;
};

export type AcceptWritingPatchPayload = {
  patchId: string;
  confirmHighRisk?: boolean;
};

export type CreateGenerationTaskPayload = {
  sectionId: string;
  focusSectionId?: string | null;
  mode: GenerationMode;
  prompt: string;
  useKnowledgeSources?: boolean;
  knowledgeRetrievalPrompt?: string;
  contextNodeIds?: string[];
  retrievalMode?: KnowledgeRetrievalMode;
  requireInlineCitations?: boolean;
  targetStart?: number;
  targetEnd?: number;
};

export type CreateGenerationTaskResult = {
  roundId: string;
  sessionId: string;
  status: GenerationRoundStatus;
  patchId?: string;
};

export type AdoptGenerationPayload = {
  roundId: string;
};

export type SectionLlmEditMode = 'rewrite_section' | 'rewrite_selection' | 'continue_at_cursor';

export type PiWritingMode = 'rewrite_section' | 'rewrite_selection' | 'continue' | 'append';

export type StartPiRunPayload = {
  sectionId: string;
  focusSectionId?: string | null;
  mode: PiWritingMode;
  prompt: string;
  targetStart?: number;
  targetEnd?: number;
};

export type PiRunStatus = 'running' | 'succeeded' | 'failed' | 'canceled' | 'timed_out' | 'budget_exhausted';

export type PiRunFailureCategory =
  | 'tool_policy_denied'
  | 'embedding_configuration'
  | 'embedding_timeout'
  | 'embedding_transport'
  | 'local_search_failure'
  | 'rerank_timeout'
  | 'rerank_transport'
  | 'retrieval_timeout'
  | 'canceled'
  | 'tool_budget_exhausted'
  | 'scope_denied'
  | 'patch_proposal_denied'
  | 'tool_execution_failed'
  | 'run_timeout'
  | 'turn_budget_exhausted'
  | 'agent_failure';

export type PiRunEvent = {
  runId: string;
  sequence: number;
  timestamp: string;
  origin: 'pi' | 'writellm';
  type:
    | 'run_started'
    | 'agent_start'
    | 'agent_end'
    | 'turn_start'
    | 'turn_end'
    | 'message_start'
    | 'message_delta'
    | 'message_end'
    | 'tool_execution_start'
    | 'tool_execution_end'
    | 'run_terminal';
  data?: Record<string, unknown>;
};

export type PiRunSummary = {
  runId: string;
  workspacePath: string;
  sectionId: string;
  status: 'running';
  startedAt: string;
  turnCount: number;
};

export type PiRunTerminalResult = Omit<PiRunSummary, 'status' | 'turnCount'> & {
  status: Exclude<PiRunStatus, 'running'>;
  completedAt: string;
  turnCount: number;
  failure?: {
    category: PiRunFailureCategory;
    retryable: boolean;
    cause: string;
  };
};

export type GenerationEvent =
  | {
      type: 'round_created';
      roundId: string;
      sessionId: string;
      status: GenerationRoundStatus;
    }
  | {
      type: 'round_status';
      roundId: string;
      status: GenerationRoundStatus;
    }
  | {
      type: 'round_done';
      roundId: string;
      status: GenerationRoundStatus;
    }
  | {
      type: 'round_error';
      roundId: string;
      errorMessage: string;
    }
  | {
      type: 'patch_created';
      roundId: string;
      patchId: string;
      status: GenerationRoundStatus;
    }
  | {
      type: 'retrieval_trace';
      roundId: string;
      event: KnowledgeRetrievalTraceEvent;
    }
  | {
      type: 'stream_delta';
      roundId: string;
      text: string;
    };
