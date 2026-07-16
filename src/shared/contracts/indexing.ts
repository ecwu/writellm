import { z } from 'zod'
import { citationIdSchema, citationSourceSchema, knowledgeSearchFiltersSchema } from './search'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const internalPathSchema = z.string().min(1).max(32_768)

export const INDEX_SCHEMA_VERSION = 4
export const INDEX_CHUNKER_VERSION = 1

export const indexSourceSchema = z
  .object({
    knowledgeItemId: z.uuid(),
    displayName: z.string().min(1).max(512),
    extension: z
      .string()
      .max(20)
      .regex(/^[a-z0-9]+$/)
      .nullable(),
    parseRevisionId: z.uuid(),
    normalizationRunId: z.uuid(),
    normalizationRoot: internalPathSchema,
    manifestSha256: sha256Schema
  })
  .strict()
export type IndexSource = z.infer<typeof indexSourceSchema>

export const vectorGenerationContractSchema = z
  .object({
    embeddingGenerationId: identifierSchema,
    indexGenerationId: identifierSchema,
    providerId: z.string().min(1).max(128),
    modelId: z.string().min(1).max(256),
    modelRevision: z.string().min(1).max(256),
    dimension: z.number().int().positive().max(65_536),
    metric: z.enum(['cosine', 'l2']),
    normalization: z.enum(['none', 'l2']),
    chunkerVersion: z.literal(INDEX_CHUNKER_VERSION),
    contractSha256: sha256Schema,
    contentFingerprint: sha256Schema
  })
  .strict()
export type VectorGenerationContract = z.infer<typeof vectorGenerationContractSchema>

const embeddingValueSchema = z
  .object({
    chunkId: identifierSchema,
    contentSha256: sha256Schema,
    vector: z.array(z.number().finite()).min(1).max(65_536)
  })
  .strict()

export const indexCandidateSchema = z
  .object({
    citationId: citationIdSchema,
    chunkId: identifierSchema,
    knowledgeItemId: z.uuid(),
    parseRevisionId: z.uuid(),
    title: z.string().min(1).max(512),
    extension: z.string().max(20).nullable(),
    text: z.string().max(4_000),
    page: z.number().int().nonnegative().optional(),
    headingPath: z.array(z.string().max(1_000)).max(20),
    sourceBlockIds: z.array(z.string().min(1).max(100)).max(1_000),
    assetRefs: z.array(z.string().min(1).max(1_024)).max(2_000),
    sources: z.array(citationSourceSchema).max(1_000)
  })
  .strict()
export type IndexCandidate = z.infer<typeof indexCandidateSchema>

export const indexUtilityInitSchema = z
  .object({
    type: z.literal('initialize'),
    requestId: z.uuid(),
    projectId: z.uuid(),
    projectSessionId: z.uuid(),
    indexPath: internalPathSchema,
    extensionPath: internalPathSchema
  })
  .strict()

const indexUtilityRequestBodySchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('build'),
      requestId: z.uuid(),
      generationId: identifierSchema,
      chunkerVersion: z.literal(INDEX_CHUNKER_VERSION),
      sources: z.array(indexSourceSchema).max(5_000)
    })
    .strict(),
  z
    .object({
      operation: z.literal('activate'),
      requestId: z.uuid(),
      generationId: identifierSchema
    })
    .strict(),
  z.object({ operation: z.literal('inspect'), requestId: z.uuid() }).strict(),
  z.object({ operation: z.literal('retrieval-state'), requestId: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal('fts-candidates'),
      requestId: z.uuid(),
      query: z.string().trim().min(1).max(2_000),
      limit: z.number().int().min(1).max(1_000),
      filters: knowledgeSearchFiltersSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('hydrate-candidates'),
      requestId: z.uuid(),
      chunkIds: z.array(identifierSchema).max(1_000),
      filters: knowledgeSearchFiltersSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('expand-citations'),
      requestId: z.uuid(),
      citationIds: z.array(citationIdSchema).min(1).max(20)
    })
    .strict(),
  z
    .object({
      operation: z.literal('embedding-inputs'),
      requestId: z.uuid(),
      indexGenerationId: identifierSchema,
      contractSha256: sha256Schema,
      dimension: z.number().int().positive().max(65_536),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(256)
    })
    .strict(),
  z
    .object({
      operation: z.literal('begin-vectors'),
      requestId: z.uuid(),
      contract: vectorGenerationContractSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('upsert-vectors'),
      requestId: z.uuid(),
      embeddingGenerationId: identifierSchema,
      values: z.array(embeddingValueSchema).min(1).max(256)
    })
    .strict(),
  z
    .object({
      operation: z.literal('activate-vectors'),
      requestId: z.uuid(),
      embeddingGenerationId: identifierSchema,
      contractSha256: sha256Schema
    })
    .strict(),
  z
    .object({
      operation: z.literal('query-vectors'),
      requestId: z.uuid(),
      embeddingGenerationId: identifierSchema,
      vector: z.array(z.number().finite()).min(1).max(65_536),
      limit: z.number().int().min(1).max(1_000),
      filters: knowledgeSearchFiltersSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal('delete-vectors'),
      requestId: z.uuid(),
      embeddingGenerationId: identifierSchema
    })
    .strict(),
  z.object({ operation: z.literal('close'), requestId: z.uuid() }).strict()
])
export type IndexUtilityRequestBody = z.infer<typeof indexUtilityRequestBodySchema>
export const indexUtilityRequestSchema = indexUtilityRequestBodySchema.and(
  z.object({ projectSessionId: z.uuid() }).strict()
)
export type IndexUtilityRequest = z.infer<typeof indexUtilityRequestSchema>

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(INDEX_SCHEMA_VERSION),
    activeGenerationId: identifierSchema.nullable(),
    generationCount: z.number().int().nonnegative(),
    chunkCount: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
    activeSourceSetSha256: sha256Schema.nullable()
  })
  .strict()
export type IndexSnapshot = z.infer<typeof snapshotSchema>

const diagnosticSchema = z
  .object({
    name: z.string().min(1).max(200),
    message: z.string().min(1).max(500),
    stack: z.string().max(32_768).optional()
  })
  .strict()

const indexUtilityResponseBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), requestId: z.uuid(), snapshot: snapshotSchema }).strict(),
  z
    .object({
      type: z.literal('built'),
      requestId: z.uuid(),
      generationId: identifierSchema,
      sourceSetSha256: sha256Schema,
      chunkSetSha256: sha256Schema,
      chunkCount: z.number().int().nonnegative(),
      sourceCount: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({
      type: z.literal('activated'),
      requestId: z.uuid(),
      generationId: identifierSchema,
      snapshot: snapshotSchema
    })
    .strict(),
  z.object({ type: z.literal('snapshot'), requestId: z.uuid(), snapshot: snapshotSchema }).strict(),
  z
    .object({
      type: z.literal('retrieval-state'),
      requestId: z.uuid(),
      activeIndexGenerationId: identifierSchema.nullable(),
      activeEmbeddingContract: vectorGenerationContractSchema.nullable()
    })
    .strict(),
  z
    .object({
      type: z.literal('fts-candidates'),
      requestId: z.uuid(),
      values: z
        .array(
          z
            .object({
              chunkId: identifierSchema,
              rank: z.number().finite(),
              strategy: z.enum(['unicode61', 'trigram'])
            })
            .strict()
        )
        .max(1_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('hydrated-candidates'),
      requestId: z.uuid(),
      values: z.array(indexCandidateSchema).max(1_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('expanded-citations'),
      requestId: z.uuid(),
      values: z.array(indexCandidateSchema).max(20)
    })
    .strict(),
  z
    .object({
      type: z.literal('embedding-inputs'),
      requestId: z.uuid(),
      values: z
        .array(
          z
            .object({
              chunkId: identifierSchema,
              text: z.string().max(131_072),
              contentSha256: sha256Schema,
              cachedVector: z.array(z.number().finite()).max(65_536).optional()
            })
            .strict()
        )
        .max(256),
      total: z.number().int().nonnegative()
    })
    .strict(),
  z
    .object({ type: z.literal('vectors-begun'), requestId: z.uuid(), alreadyActive: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal('vectors-upserted'),
      requestId: z.uuid(),
      count: z.number().int().positive()
    })
    .strict(),
  z.object({ type: z.literal('vectors-activated'), requestId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('vector-candidates'),
      requestId: z.uuid(),
      values: z
        .array(z.object({ chunkId: identifierSchema, distance: z.number().finite() }).strict())
        .max(1_000)
    })
    .strict(),
  z.object({ type: z.literal('vectors-deleted'), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal('closed'), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal('error'), requestId: z.uuid(), error: diagnosticSchema }).strict()
])
export type IndexUtilityResponseBody = z.infer<typeof indexUtilityResponseBodySchema>
export const indexUtilityResponseSchema = indexUtilityResponseBodySchema.and(
  z.object({ projectSessionId: z.uuid() }).strict()
)
export type IndexUtilityResponse = z.infer<typeof indexUtilityResponseSchema>
