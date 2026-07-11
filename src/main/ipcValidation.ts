import { z } from 'zod';
import { ipcChannels } from '../shared/ipc.js';

const MAX_STRING_LENGTH = 1_000_000;
const idSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid identifier.');
const nullableIdSchema = idSchema.nullable();
const shortTextSchema = z.string().max(16_384);
const markdownSchema = z.string().max(MAX_STRING_LENGTH);
const workspacePathSchema = z.string().trim().min(1).max(4_096);
const recordSchema = z.record(z.string().max(128), z.unknown());
const providerSchema = z.enum(['openai-compatible', 'anthropic-compatible', 'deepseek']);
const rerankProviderSchema = z.literal('siliconflow-compatible');

const createNodeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('section'),
    parentId: nullableIdSchema,
    title: shortTextSchema,
    intent: shortTextSchema.optional(),
    description: shortTextSchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('content'),
    parentId: idSchema,
    title: shortTextSchema,
    content: markdownSchema,
    isMain: z.boolean().optional(),
    isLlm: z.boolean().optional(),
    metadata: recordSchema.optional()
  }).strict()
]);

const updateNodeSchema = z.object({
  title: shortTextSchema.optional(),
  intent: shortTextSchema.nullable().optional(),
  description: shortTextSchema.nullable().optional(),
  activeMainNodeId: nullableIdSchema.optional(),
  markdownContent: markdownSchema.optional(),
  content: markdownSchema.optional(),
  isMain: z.boolean().optional(),
  isLlm: z.boolean().optional(),
  metadata: recordSchema.optional()
}).strict();

const generationPayloadSchema = z.object({
  sectionId: idSchema,
  focusSectionId: nullableIdSchema.optional(),
  mode: z.enum(['append', 'rewrite_section', 'rewrite_selection', 'continue']),
  prompt: shortTextSchema,
  useKnowledgeSources: z.boolean().optional(),
  knowledgeRetrievalPrompt: shortTextSchema.optional(),
  contextNodeIds: z.array(idSchema).max(32).optional(),
  retrievalMode: z.enum(['classic', 'sourcev2']).optional(),
  requireInlineCitations: z.boolean().optional(),
  targetStart: z.number().int().min(0).max(MAX_STRING_LENGTH).optional(),
  targetEnd: z.number().int().min(0).max(MAX_STRING_LENGTH).optional()
}).strict();

const piRunPayloadSchema = z.object({
  sectionId: idSchema,
  focusSectionId: nullableIdSchema.optional(),
  mode: z.enum(['rewrite_section', 'rewrite_selection', 'continue', 'append']),
  prompt: shortTextSchema.min(1),
  targetStart: z.number().int().min(0).max(MAX_STRING_LENGTH).optional(),
  targetEnd: z.number().int().min(0).max(MAX_STRING_LENGTH).optional()
}).strict();

const documentBlockKindSchema = z.enum(['paragraph', 'heading', 'quote', 'code', 'list_item', 'divider', 'image']);
const createDocumentBlockSchema = z.object({
  sectionId: idSchema,
  afterBlockId: nullableIdSchema.optional(),
  kind: documentBlockKindSchema.optional(),
  content: markdownSchema.optional(),
  attributes: recordSchema.optional()
}).strict();
const updateDocumentBlockSchema = z.object({
  kind: documentBlockKindSchema.optional(),
  content: markdownSchema.optional(),
  attributes: recordSchema.optional()
}).strict();

const llmSettingsSchema = z.object({
  provider: providerSchema,
  baseURL: z.string().trim().min(1).max(2_048),
  model: z.string().trim().min(1).max(512),
  apiKey: z.string().max(16_384).optional(),
  embeddingProvider: providerSchema.optional(),
  embeddingBaseURL: z.string().trim().max(2_048).optional(),
  embeddingModel: z.string().trim().max(512).optional(),
  embeddingApiKey: z.string().max(16_384).optional(),
  visionProvider: providerSchema.optional(),
  visionBaseURL: z.string().trim().max(2_048).optional(),
  visionModel: z.string().trim().max(512).optional(),
  visionApiKey: z.string().max(16_384).optional(),
  rerankProvider: rerankProviderSchema.optional(),
  rerankBaseURL: z.string().trim().max(2_048).optional(),
  rerankModel: z.string().trim().max(512).optional(),
  rerankApiKey: z.string().max(16_384).optional(),
  rerankEnabled: z.boolean().optional(),
  knowledgePdfExtractionEngine: z.enum(['pdfjs', 'mineru']).optional(),
  mineruApiKey: z.string().max(16_384).optional(),
  mineruModelVersion: z.enum(['pipeline', 'vlm']).optional(),
  mineruLanguage: z.string().trim().max(32).optional(),
  mineruIsOcr: z.boolean().optional(),
  mineruEnableTable: z.boolean().optional(),
  mineruEnableFormula: z.boolean().optional(),
  allowExternalProcessing: z.boolean().optional(),
  knowledgeRetrieval: z.object({
    maxRetrievedChunks: z.number().finite().optional(),
    maxCandidateChunks: z.number().finite().optional(),
    rerankTopN: z.number().finite().optional(),
    adjacentChunkRadius: z.number().finite().optional(),
    maxChunksPerItem: z.number().finite().optional(),
    chunkTargetChars: z.number().finite().optional(),
    chunkOverlapChars: z.number().finite().optional(),
    embeddingBatchSize: z.number().finite().optional()
  }).strict().optional()
}).strict();

const knowledgeSearchSchema = z.object({
  query: shortTextSchema,
  sectionId: idSchema.optional(),
  focusSectionId: nullableIdSchema.optional(),
  contextNodeIds: z.array(idSchema).max(32).optional(),
  excludedItemIds: z.array(idSchema).max(256).optional(),
  excludedChunkIds: z.array(idSchema).max(1_024).optional(),
  maxChunks: z.number().int().min(1).max(80).optional(),
  retrievalMode: z.enum(['classic', 'sourcev2']).optional(),
  runId: idSchema.optional()
}).strict();

export function validateIpcArguments(channel: string, args: unknown[]): unknown[] {
  assertTransportValues(args);
  switch (channel) {
    case ipcChannels.createWorkspace:
    case ipcChannels.openWorkspace:
      return [workspacePathSchema.parse(args[0])];
    case ipcChannels.getState:
      return [nullableIdSchema.optional().parse(args[0])];
    case ipcChannels.updateSectionMarkdown:
      return [idSchema.parse(args[0]), markdownSchema.parse(args[1])];
    case ipcChannels.createDocumentBlock:
      return [createDocumentBlockSchema.parse(args[0])];
    case ipcChannels.updateDocumentBlock:
      return [idSchema.parse(args[0]), updateDocumentBlockSchema.parse(args[1])];
    case ipcChannels.deleteDocumentBlock:
      return [idSchema.parse(args[0])];
    case ipcChannels.createGitCheckpoint:
      return [shortTextSchema.optional().parse(args[0])];
    case ipcChannels.listGitHistory:
      return [nullableIdSchema.optional().parse(args[0])];
    case ipcChannels.getSectionHistoryDetail:
    case ipcChannels.restoreSectionVersion:
      return [idSchema.parse(args[0]), z.string().trim().min(7).max(128).regex(/^[0-9a-f]+$/i).parse(args[1])];
    case ipcChannels.createNode:
      return [createNodeSchema.parse(args[0])];
    case ipcChannels.updateNode:
      return [idSchema.parse(args[0]), updateNodeSchema.parse(args[1])];
    case ipcChannels.deleteNode:
    case ipcChannels.reindexKnowledgeItem:
    case ipcChannels.getWritingPatch:
    case ipcChannels.rejectWritingPatch:
    case ipcChannels.saveWritingPatchAsCandidate:
    case ipcChannels.cancelGenerationTask:
    case ipcChannels.discardGenerationTask:
    case ipcChannels.retryGenerationTask:
    case ipcChannels.getGenerationRound:
    case ipcChannels.cancelPiRun:
      return [idSchema.parse(args[0])];
    case ipcChannels.setActiveMainNode:
      return [idSchema.parse(args[0]), nullableIdSchema.parse(args[1])];
    case ipcChannels.moveNode:
      return [idSchema.parse(args[0]), nullableIdSchema.parse(args[1]), z.number().int().min(0).max(1_000_000).parse(args[2])];
    case ipcChannels.createNodeEdge:
      return [idSchema.parse(args[0]), idSchema.parse(args[1]), z.enum(['informs', 'generates', 'revises', 'related-to', 'cites']).parse(args[2])];
    case ipcChannels.updateNodeEdge:
      return [idSchema.parse(args[0]), z.enum(['informs', 'generates', 'revises', 'related-to', 'cites']).parse(args[1]), nullableIdSchema.optional().parse(args[2])];
    case ipcChannels.deleteNodeEdge:
      return [idSchema.parse(args[0]), nullableIdSchema.optional().parse(args[1])];
    case ipcChannels.updateLlmSettings:
      return [llmSettingsSchema.parse(args[0])];
    case ipcChannels.updateProjectBrief:
      return [z.object({
        glossary: recordSchema.optional(),
        motivation: recordSchema.optional(),
        framework: recordSchema.optional(),
        focusSectionId: nullableIdSchema.optional()
      }).strict().parse(args[0])];
    case ipcChannels.suggestProjectBrief:
      return [z.object({
        target: z.enum(['all', 'glossary', 'motivation', 'framework']),
        currentBrief: recordSchema.optional()
      }).strict().parse(args[0])];
    case ipcChannels.updateAppearanceSettings:
      return [z.object({
        theme: z.enum(['system', 'light', 'dark']),
        accentColor: z.enum(['earth', 'forest', 'ochre', 'cinnabar', 'deep-teal', 'plum']),
        fontFamily: z.enum(['geist', 'system-sans', 'serif', 'mono', 'humanist-sans'])
      }).strict().parse(args[0])];
    case ipcChannels.createKnowledgeItem:
      return [z.object({ title: shortTextSchema, content: markdownSchema }).strict().parse(args[0])];
    case ipcChannels.enqueueKnowledgeFiles:
      return [z.object({ filePaths: z.array(workspacePathSchema).min(1).max(100) }).strict().parse(args[0])];
    case ipcChannels.retryKnowledgeIngestJob:
    case ipcChannels.deleteKnowledgeIngestJob:
      return [z.string().trim().min(1).max(32).regex(/^\d+$/).parse(args[0])];
    case ipcChannels.updateKnowledgeItem:
      return [idSchema.parse(args[0]), z.object({ title: shortTextSchema.optional(), content: markdownSchema.optional() }).strict().parse(args[1])];
    case ipcChannels.deleteKnowledgeItem:
      return [idSchema.parse(args[0])];
    case ipcChannels.searchKnowledge:
      return [knowledgeSearchSchema.parse(args[0])];
    case ipcChannels.resolveKnowledgeCitation:
      return [z.object({ publicRef: z.string().trim().max(512).optional(), chunkId: idSchema.optional() }).strict().refine((value) => Boolean(value.publicRef || value.chunkId), 'A citation reference is required.').parse(args[0])];
    case ipcChannels.getWorkspaceAssetDataUrl:
      return [z.string().trim().min(1).max(1_024).parse(args[0])];
    case ipcChannels.exportLatex:
      return [idSchema.parse(args[0])];
    case ipcChannels.createGenerationTask:
      return [generationPayloadSchema.parse(args[0])];
    case ipcChannels.startPiRun:
      return [piRunPayloadSchema.parse(args[0])];
    case ipcChannels.adoptGenerationTask:
    case ipcChannels.createPatchFromGenerationRound:
      return [z.object({ roundId: idSchema }).strict().parse(args[0])];
    case ipcChannels.acceptWritingPatch:
      return [z.object({ patchId: idSchema, confirmHighRisk: z.boolean().optional() }).strict().parse(args[0])];
    case ipcChannels.listWritingPatchesForSection:
    case ipcChannels.listGenerationRounds:
      return [idSchema.parse(args[0])];
    case ipcChannels.listGenerationSessions:
      return [nullableIdSchema.optional().parse(args[0])];
    default:
      return args;
  }
}

function assertTransportValues(value: unknown, depth = 0): void {
  if (depth > 12) {
    throw new Error('IPC payload nesting is too deep.');
  }
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw new Error('IPC string payload is too large.');
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) {
      throw new Error('IPC array payload is too large.');
    }
    value.forEach((entry) => assertTransportValues(entry, depth + 1));
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('IPC payload must contain plain data only.');
  }
  Object.values(value as Record<string, unknown>).forEach((entry) => assertTransportValues(entry, depth + 1));
}
