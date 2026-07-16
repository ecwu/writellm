import { z } from 'zod'
import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from './knowledge'
import { projectSessionInputSchema } from './projects'

export const citationIdSchema = z.string().regex(/^citation-[a-f0-9]{40}$/)

export const knowledgeSearchFiltersSchema = z
  .object({
    knowledgeItemIds: z.array(z.uuid()).max(50).default([]),
    fileExtensions: z.array(z.enum(SUPPORTED_KNOWLEDGE_EXTENSIONS)).max(20).default([]),
    parseRevisionIds: z.array(z.uuid()).max(50).default([]),
    pageFrom: z.number().int().nonnegative().optional(),
    pageTo: z.number().int().nonnegative().optional(),
    heading: z.string().trim().min(1).max(500).optional()
  })
  .strict()
  .refine(
    (filters) =>
      filters.pageFrom === undefined ||
      filters.pageTo === undefined ||
      filters.pageFrom <= filters.pageTo,
    'Page range is invalid'
  )
export type KnowledgeSearchFilters = z.infer<typeof knowledgeSearchFiltersSchema>

export const knowledgeSearchInputSchema = projectSessionInputSchema
  .extend({
    query: z.string().trim().min(1).max(2_000),
    filters: knowledgeSearchFiltersSchema.default({
      knowledgeItemIds: [],
      fileExtensions: [],
      parseRevisionIds: []
    }),
    limits: z
      .object({
        fts: z.number().int().min(1).max(200).default(100),
        vector: z.number().int().min(1).max(200).default(100),
        fused: z.number().int().min(1).max(200).default(50),
        results: z.number().int().min(1).max(50).default(20)
      })
      .strict()
      .default({ fts: 100, vector: 100, fused: 50, results: 20 }),
    rerank: z.boolean().default(true)
  })
  .strict()
export type KnowledgeSearchInput = z.infer<typeof knowledgeSearchInputSchema>

const searchDebugSchema = z
  .object({
    ftsRank: z.number().int().positive().nullable(),
    vectorRank: z.number().int().positive().nullable(),
    rrfScore: z.number().finite().nonnegative(),
    rerankScore: z.number().finite().nullable()
  })
  .strict()

export const knowledgeSearchHitSchema = z
  .object({
    citationId: citationIdSchema,
    knowledgeItemId: z.uuid(),
    parseRevisionId: z.uuid(),
    chunkId: z.string().regex(/^chunk-[a-f0-9]{40}$/),
    title: z.string().min(1).max(512),
    snippet: z.string().max(1_200),
    score: z.number().finite().nonnegative(),
    page: z.number().int().nonnegative().optional(),
    headingPath: z.array(z.string().max(1_000)).max(20),
    sourceBlockIds: z.array(z.string().min(1).max(100)).max(1_000),
    assetRefs: z.array(z.string().min(1).max(1_024)).max(2_000),
    debug: searchDebugSchema
  })
  .strict()
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>

export const knowledgeSearchResultSchema = z
  .object({
    mode: z.enum(['none', 'fts', 'hybrid']),
    rerankStatus: z.enum(['disabled', 'not-configured', 'applied', 'unavailable']),
    hits: z.array(knowledgeSearchHitSchema).max(50)
  })
  .strict()
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>

export const citationExpansionInputSchema = projectSessionInputSchema
  .extend({ citationIds: z.array(citationIdSchema).min(1).max(20) })
  .strict()

export const citationSourceSchema = z
  .object({
    blockId: z.string().min(1).max(100),
    blockType: z.string().min(1).max(100),
    page: z.number().int().nonnegative().nullable(),
    bbox: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .nullable(),
    assetRefs: z.array(z.string().min(1).max(1_024)).max(20),
    providerBlockId: z.string().min(1).max(256).nullable(),
    segmentStart: z.number().int().nonnegative(),
    segmentEnd: z.number().int().nonnegative()
  })
  .strict()

export const expandedCitationSchema = knowledgeSearchHitSchema
  .omit({ snippet: true, score: true, debug: true })
  .extend({
    text: z.string().max(131_072),
    sources: z.array(citationSourceSchema).max(1_000)
  })
  .strict()

export const citationExpansionResultSchema = z.array(expandedCitationSchema).max(20)
export type ExpandedCitation = z.infer<typeof expandedCitationSchema>
