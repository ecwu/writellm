import { z } from 'zod'
import { editorSessionInputSchema } from './manuscript'

export const SUPPORTED_KNOWLEDGE_EXTENSIONS = [
  'pdf',
  'docx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'tif',
  'tiff',
  'bmp'
] as const

export const knowledgeItemStateSchema = z.enum(['importing', 'stored', 'failed', 'cancelled'])
export const knowledgeItemSchema = z
  .object({
    knowledgeItemId: z.string().uuid(),
    originalName: z.string().min(1).max(1_024),
    displayName: z.string().min(1).max(200),
    state: knowledgeItemStateSchema,
    errorCode: z.string().max(100).nullable(),
    mimeType: z.string().max(200).nullable(),
    extension: z.string().max(20).nullable(),
    byteSize: z.number().int().nonnegative().nullable(),
    bytesCopied: z.number().int().nonnegative(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    parseState: z.string().min(1).max(100).nullable(),
    normalizationState: z.enum(['staging', 'published', 'failed']).nullable(),
    activeParseRevisionId: z.uuid().nullable(),
    activeNormalizationRunId: z.uuid().nullable(),
    blockCount: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative(),
    activatedAt: z.iso.datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()

export const knowledgeListInputSchema = editorSessionInputSchema
export const knowledgeListResultSchema = z.array(knowledgeItemSchema)
export const knowledgeIndexStatusSchema = z
  .object({
    readiness: z.enum(['preparing', 'available', 'unavailable']),
    indexed: z.boolean()
  })
  .strict()

export const knowledgeCitationCoverageFilterSchema = z.enum([
  'all',
  'cited',
  'uncited',
  'attention'
])
export const knowledgeCitationCoveragePageInputSchema = editorSessionInputSchema
  .extend({
    filter: knowledgeCitationCoverageFilterSchema.default('all'),
    query: z.string().trim().max(512).default(''),
    cursor: z.string().min(1).max(1_024).optional(),
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict()

export const knowledgeCitationCoverageSummarySchema = z
  .object({
    indexedSourceCount: z.number().int().nonnegative().max(5_000),
    citedSourceCount: z.number().int().nonnegative().max(5_000),
    uncitedSourceCount: z.number().int().nonnegative().max(5_000),
    ambiguousSourceCount: z.number().int().nonnegative().max(5_000),
    unmatchedCitationTitleCount: z.number().int().nonnegative().max(50_000),
    unmatchedCitationOccurrenceCount: z.number().int().nonnegative().max(2_500_000_000),
    attentionCount: z.number().int().nonnegative().max(55_000),
    coverageRatio: z.number().finite().min(0).max(1).nullable()
  })
  .strict()

export const knowledgeCitationCoverageSourceItemSchema = z
  .object({
    kind: z.literal('source'),
    knowledgeItemId: z.uuid(),
    displayName: z.string().min(1).max(512),
    extension: z.string().max(20).nullable(),
    status: z.enum(['cited', 'uncited', 'ambiguous']),
    citationCount: z.number().int().nonnegative().max(50_000)
  })
  .strict()
export const knowledgeCitationCoverageUnmatchedItemSchema = z
  .object({
    kind: z.literal('unmatched_citation'),
    title: z.string().min(1).max(512),
    citationCount: z.number().int().positive().max(50_000)
  })
  .strict()
export const knowledgeCitationCoverageItemSchema = z.discriminatedUnion('kind', [
  knowledgeCitationCoverageSourceItemSchema,
  knowledgeCitationCoverageUnmatchedItemSchema
])

const knowledgeCitationCoverageUnavailableSchema = z
  .object({ state: z.literal('unavailable'), reason: z.literal('index_unavailable') })
  .strict()
const knowledgeCitationCoveragePreparingSchema = z
  .object({ state: z.literal('preparing'), reason: z.literal('index_preparing') })
  .strict()
const knowledgeCitationCoverageStaleSchema = z
  .object({ state: z.literal('stale'), reason: z.literal('snapshot_changed') })
  .strict()
const knowledgeCitationCoverageReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    indexGenerationId: z.string().min(1).max(256),
    outlineVersion: z.number().int().positive(),
    summary: knowledgeCitationCoverageSummarySchema,
    items: z.array(knowledgeCitationCoverageItemSchema).max(100),
    filteredTotal: z.number().int().nonnegative().max(55_000),
    nextCursor: z.string().min(1).max(1_024).nullable()
  })
  .strict()
export const knowledgeCitationCoveragePageResultSchema = z.discriminatedUnion('state', [
  knowledgeCitationCoverageUnavailableSchema,
  knowledgeCitationCoveragePreparingSchema,
  knowledgeCitationCoverageStaleSchema,
  knowledgeCitationCoverageReadySchema
])
export const knowledgeImportPathsInputSchema = editorSessionInputSchema
  .extend({ paths: z.array(z.string().min(1).max(32_768)).min(1).max(50) })
  .strict()
export const knowledgeItemActionInputSchema = editorSessionInputSchema
  .extend({ knowledgeItemId: z.string().uuid() })
  .strict()
export const knowledgeEmbeddingRefreshInputSchema = editorSessionInputSchema
  .extend({ knowledgeItemId: z.string().uuid().optional() })
  .strict()

export const normalizedKnowledgeBlockTypeSchema = z.enum([
  'heading',
  'paragraph',
  'list',
  'table',
  'formula',
  'image',
  'caption',
  'other'
])
const normalizedAssetRefSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^images\/[A-Za-z0-9][A-Za-z0-9._-]*$/)
export const normalizedKnowledgeBlockSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^kb_[a-f0-9]{32}$/),
    ordinal: z.number().int().nonnegative(),
    type: normalizedKnowledgeBlockTypeSchema,
    text: z.string().max(2_000_000).optional(),
    markdown: z.string().max(4_000_000).optional(),
    headingPath: z.array(z.string().max(1_000)).max(20),
    page: z.number().int().nonnegative().optional(),
    bbox: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .optional(),
    sourceProviderBlockId: z.string().min(1).max(256).optional(),
    assetRefs: z.array(normalizedAssetRefSchema).max(20),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()

export const normalizedKnowledgeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    normalizerVersion: z.number().int().positive(),
    normalizationRunId: z.uuid(),
    parseRevisionId: z.uuid(),
    knowledgeItemId: z.uuid(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    blocks: z.object({
      relativePath: z.literal('blocks.jsonl'),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      count: z.number().int().nonnegative()
    }),
    document: z.object({
      relativePath: z.literal('document.md'),
      sha256: z.string().regex(/^[a-f0-9]{64}$/)
    }),
    assets: z
      .array(
        z.object({
          relativePath: normalizedAssetRefSchema,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          byteSize: z.number().int().positive(),
          mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']),
          sourceRelativePath: z.string().min(1).max(1_024)
        })
      )
      .max(5_000),
    createdAt: z.iso.datetime()
  })
  .strict()

export const PARSED_KNOWLEDGE_BLOCK_PAGE_LIMIT = 100
export const PARSED_KNOWLEDGE_PAGE_MAX_BYTES = 4 * 1024 * 1024
export const PARSED_KNOWLEDGE_MARKDOWN_MAX_BYTES = 4 * 1024 * 1024

const parsedKnowledgeActiveMetadataSchema = z
  .object({
    parseRevisionId: z.uuid(),
    normalizationRunId: z.uuid(),
    normalizerVersion: z.number().int().positive(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    remoteTaskId: z.string().min(1).max(256),
    providerId: z.literal('mineru'),
    modelVersion: z.enum(['pipeline', 'vlm', 'MinerU-HTML']),
    blockCount: z.number().int().nonnegative().max(20_000),
    documentByteSize: z
      .number()
      .int()
      .nonnegative()
      .max(20 * 1024 * 1024),
    activatedAt: z.iso.datetime()
  })
  .strict()

export const parsedKnowledgeMetadataSchema = z
  .object({
    knowledgeItemId: z.uuid(),
    parseState: z.string().min(1).max(100).nullable(),
    normalizationState: z.enum(['staging', 'published', 'failed']).nullable(),
    active: parsedKnowledgeActiveMetadataSchema.nullable()
  })
  .strict()

export const parsedKnowledgeBlockPageInputSchema = knowledgeItemActionInputSchema
  .extend({
    parseRevisionId: z.uuid(),
    cursor: z
      .number()
      .int()
      .nonnegative()
      .max(200 * 1024 * 1024)
      .default(0),
    limit: z
      .number()
      .int()
      .min(1)
      .max(PARSED_KNOWLEDGE_BLOCK_PAGE_LIMIT)
      .default(PARSED_KNOWLEDGE_BLOCK_PAGE_LIMIT)
  })
  .strict()

export const parsedKnowledgeBlockPageSchema = z
  .object({
    parseRevisionId: z.uuid(),
    blocks: z.array(normalizedKnowledgeBlockSchema).max(PARSED_KNOWLEDGE_BLOCK_PAGE_LIMIT),
    nextCursor: z
      .number()
      .int()
      .nonnegative()
      .max(200 * 1024 * 1024),
    hasMore: z.boolean(),
    returnedBytes: z.number().int().nonnegative().max(PARSED_KNOWLEDGE_PAGE_MAX_BYTES)
  })
  .strict()

export const parsedKnowledgeMarkdownInputSchema = knowledgeItemActionInputSchema
  .extend({ parseRevisionId: z.uuid() })
  .strict()

export const parsedKnowledgeMarkdownSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ready'),
      parseRevisionId: z.uuid(),
      byteSize: z.number().int().nonnegative().max(PARSED_KNOWLEDGE_MARKDOWN_MAX_BYTES),
      markdown: z.string().max(PARSED_KNOWLEDGE_MARKDOWN_MAX_BYTES)
    })
    .strict(),
  z
    .object({
      state: z.literal('too_large'),
      parseRevisionId: z.uuid(),
      byteSize: z
        .number()
        .int()
        .positive()
        .max(20 * 1024 * 1024)
    })
    .strict()
])

export const parsedKnowledgeAssetInputSchema = knowledgeItemActionInputSchema
  .extend({ assetRef: normalizedAssetRefSchema, parseRevisionId: z.uuid() })
  .strict()
export const parsedKnowledgeAssetSchema = z
  .object({
    mimeType: z.string().min(1).max(100),
    dataBase64: z.string().max(16_000_000)
  })
  .strict()

export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>
export type KnowledgeIndexStatus = z.infer<typeof knowledgeIndexStatusSchema>
export type KnowledgeCitationCoverageFilter = z.infer<typeof knowledgeCitationCoverageFilterSchema>
export type KnowledgeCitationCoveragePageInput = z.input<
  typeof knowledgeCitationCoveragePageInputSchema
>
export type KnowledgeCitationCoveragePageResult = z.infer<
  typeof knowledgeCitationCoveragePageResultSchema
>
export type KnowledgeCitationCoverageItem = z.infer<typeof knowledgeCitationCoverageItemSchema>
export type KnowledgeImportPathsInput = z.infer<typeof knowledgeImportPathsInputSchema>
export type KnowledgeItemActionInput = z.infer<typeof knowledgeItemActionInputSchema>
export type KnowledgeEmbeddingRefreshInput = z.infer<typeof knowledgeEmbeddingRefreshInputSchema>
export type NormalizedKnowledgeBlock = z.infer<typeof normalizedKnowledgeBlockSchema>
export type NormalizedKnowledgeManifest = z.infer<typeof normalizedKnowledgeManifestSchema>
export type ParsedKnowledgeMetadata = z.infer<typeof parsedKnowledgeMetadataSchema>
export type ParsedKnowledgeBlockPage = z.infer<typeof parsedKnowledgeBlockPageSchema>
export type ParsedKnowledgeMarkdown = z.infer<typeof parsedKnowledgeMarkdownSchema>
