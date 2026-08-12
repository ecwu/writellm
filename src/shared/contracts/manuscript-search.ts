import { z } from 'zod'
import {
  contentHashSchema,
  sectionIdSchema,
  sectionRevisionIdSchema,
  sectionStatusSchema
} from './manuscript'

export const MANUSCRIPT_SEARCH_DEFAULT_PAGE_SIZE = 25
export const MANUSCRIPT_SEARCH_MAX_PAGE_SIZE = 50
export const MANUSCRIPT_SEARCH_MAX_RESULTS = 2_000

const wellFormedUtf16 = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

export const manuscriptSearchQuerySchema = z
  .string()
  .min(1)
  .max(512)
  .refine(wellFormedUtf16, 'Search query must contain well-formed UTF-16')

const utf16RangeSchema = z
  .object({ from: z.number().int().nonnegative(), to: z.number().int().positive() })
  .strict()
  .refine(({ from, to }) => from < to, 'Search range must be non-empty')

const inlineTextSegmentSchema = z
  .object({
    inlineIndex: z.number().int().nonnegative().max(10_000),
    linkTextIndex: z.number().int().nonnegative().max(10_000).optional(),
    range: utf16RangeSchema
  })
  .strict()

export const manuscriptSearchTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['section_title', 'section_objective']),
      sectionId: sectionIdSchema,
      range: utf16RangeSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('block_inline'),
      sectionId: sectionIdSchema,
      revisionId: sectionRevisionIdSchema,
      blockId: z.string().min(1).max(256),
      segments: z.array(inlineTextSegmentSchema).min(1).max(100),
      flatRange: utf16RangeSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('table_cell'),
      sectionId: sectionIdSchema,
      revisionId: sectionRevisionIdSchema,
      blockId: z.string().min(1).max(256),
      rowIndex: z.number().int().nonnegative().max(1_000),
      cellIndex: z.number().int().nonnegative().max(1_000),
      segments: z.array(inlineTextSegmentSchema).min(1).max(100),
      flatRange: utf16RangeSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('block_caption'),
      sectionId: sectionIdSchema,
      revisionId: sectionRevisionIdSchema,
      blockId: z.string().min(1).max(256),
      property: z.literal('caption'),
      range: utf16RangeSchema
    })
    .strict()
])

export const manuscriptSearchScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manuscript') }).strict(),
  z
    .object({ type: z.literal('sections'), sectionIds: z.array(sectionIdSchema).min(1).max(1_000) })
    .strict(),
  z.object({ type: z.literal('subtree'), rootSectionId: sectionIdSchema }).strict()
])

export const manuscriptSearchInputSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    query: manuscriptSearchQuerySchema,
    caseSensitive: z.boolean().default(false),
    scope: manuscriptSearchScopeSchema.default({ type: 'manuscript' }),
    statuses: z.array(sectionStatusSchema).max(3).default([]),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MANUSCRIPT_SEARCH_MAX_PAGE_SIZE)
      .default(MANUSCRIPT_SEARCH_DEFAULT_PAGE_SIZE)
  })
  .strict()

export const manuscriptSearchHitSchema = z
  .object({
    matchId: contentHashSchema,
    sourceSliceHash: contentHashSchema,
    sectionTitle: z.string().min(1).max(500),
    sectionStatus: sectionStatusSchema,
    headingPath: z.array(z.string().min(1).max(500)).max(64),
    excerpt: z.string().max(900),
    excerptMatch: utf16RangeSchema,
    target: manuscriptSearchTargetSchema
  })
  .strict()

export const manuscriptSearchResultSchema = z
  .object({
    snapshotFingerprint: contentHashSchema,
    hits: z.array(manuscriptSearchHitSchema).max(MANUSCRIPT_SEARCH_MAX_PAGE_SIZE),
    nextCursor: z.string().max(2_048).nullable(),
    complete: z.boolean(),
    incompleteReason: z.enum(['result_limit', 'scan_budget']).nullable(),
    scannedSections: z.number().int().nonnegative().max(1_000),
    scannedSurfaces: z.number().int().nonnegative(),
    scannedBytes: z.number().int().nonnegative(),
    slowPathSurfaces: z.number().int().nonnegative(),
    resultCount: z.number().int().nonnegative().max(MANUSCRIPT_SEARCH_MAX_RESULTS)
  })
  .strict()
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 512 * 1024,
    'Search result exceeds the IPC byte budget'
  )

export const manuscriptSearchNavigationInputSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    query: manuscriptSearchQuerySchema,
    caseSensitive: z.boolean(),
    matchId: contentHashSchema,
    sourceSliceHash: contentHashSchema,
    target: manuscriptSearchTargetSchema
  })
  .strict()

export const manuscriptSearchNavigationResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('valid'),
      sectionId: sectionIdSchema,
      revisionId: sectionRevisionIdSchema.nullable(),
      target: manuscriptSearchTargetSchema
    })
    .strict(),
  z.object({ status: z.literal('stale') }).strict()
])

export type ManuscriptSearchInput = z.input<typeof manuscriptSearchInputSchema>
export type ParsedManuscriptSearchInput = z.output<typeof manuscriptSearchInputSchema>
export type ManuscriptSearchHit = z.infer<typeof manuscriptSearchHitSchema>
export type ManuscriptSearchResult = z.infer<typeof manuscriptSearchResultSchema>
export type ManuscriptSearchTargetContract = z.infer<typeof manuscriptSearchTargetSchema>
export type ManuscriptSearchNavigationInput = z.infer<typeof manuscriptSearchNavigationInputSchema>
export type ManuscriptSearchNavigationResult = z.infer<
  typeof manuscriptSearchNavigationResultSchema
>
