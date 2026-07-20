import { z } from 'zod'
import { editorSessionInputSchema } from './manuscript'

const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const bboxSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite()
])

export const knowledgeMappingPageInputSchema = editorSessionInputSchema
  .extend({
    knowledgeItemId: z.uuid(),
    pageIndex: z.number().int().nonnegative().max(10_000)
  })
  .strict()

export const pdfPreviewInputSchema = editorSessionInputSchema
  .extend({ knowledgeItemId: z.uuid() })
  .strict()

export const pdfPreviewResultSchema = z
  .object({
    previewId: z.uuid(),
    url: z.string().url().max(2_048),
    byteSize: z.number().int().positive()
  })
  .strict()

export const pdfPreviewReleaseInputSchema = editorSessionInputSchema
  .extend({ previewId: z.uuid() })
  .strict()

const mappingGeometrySchema = z
  .object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    origin: z.literal('top-left')
  })
  .strict()

const mappingRegionSchema = z
  .object({
    regionId: identifierSchema,
    providerBlockId: z.string().min(1).max(256).nullable(),
    normalizedBlockIds: z.array(z.string().min(1).max(100)).min(1).max(20),
    blockTypes: z.array(z.string().min(1).max(32)).min(1).max(20),
    bbox: bboxSchema.nullable(),
    pageIndex: z.number().int().nonnegative()
  })
  .strict()

const mappingCoverageSchema = z
  .object({
    regionId: identifierSchema,
    normalizedBlockIds: z.array(z.string().min(1).max(100)).min(1).max(20),
    totalCharacters: z.number().int().nonnegative(),
    coveredCharacters: z.number().int().nonnegative(),
    coverageRatio: z.number().finite().min(0).max(1),
    segments: z
      .array(
        z
          .object({
            startRatio: z.number().finite().min(0).max(1),
            endRatio: z.number().finite().min(0).max(1)
          })
          .strict()
      )
      .max(32)
  })
  .strict()

const mappingEmbeddingSchema = z
  .object({
    embeddingGenerationId: identifierSchema,
    providerId: z.string().min(1).max(128),
    modelId: z.string().min(1).max(256),
    modelRevision: z.string().min(1).max(256),
    dimension: z.number().int().positive().max(65_536),
    metric: z.enum(['cosine', 'l2']),
    normalization: z.enum(['none', 'l2']),
    norm: z.number().finite().nonnegative(),
    preview: z.array(z.number().finite()).max(16)
  })
  .strict()

const mappingChunkSchema = z
  .object({
    chunkId: identifierSchema,
    ordinal: z.number().int().nonnegative(),
    text: z.string().max(4_000),
    headingPath: z.array(z.string().max(1_000)).max(20),
    coverages: z.array(mappingCoverageSchema).max(1_000),
    embedding: mappingEmbeddingSchema.nullable()
  })
  .strict()

export const knowledgeMappingPageSchema = z
  .object({
    state: z.enum(['ready', 'indexing', 'unavailable', 'too_complex']),
    knowledgeItemId: z.uuid(),
    parseRevisionId: z.uuid().nullable(),
    pageIndex: z.number().int().nonnegative(),
    geometry: mappingGeometrySchema.nullable(),
    regions: z.array(mappingRegionSchema).max(5_000),
    chunks: z.array(mappingChunkSchema).max(5_000),
    activeIndexGenerationId: identifierSchema.nullable(),
    activeEmbeddingGenerationId: identifierSchema.nullable(),
    message: z.string().max(500).optional()
  })
  .strict()

export type KnowledgeMappingPageInput = z.infer<typeof knowledgeMappingPageInputSchema>
export type PdfPreviewInput = z.infer<typeof pdfPreviewInputSchema>
export type PdfPreviewResult = z.infer<typeof pdfPreviewResultSchema>
export type KnowledgeMappingPage = z.infer<typeof knowledgeMappingPageSchema>
