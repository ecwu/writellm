import { z } from 'zod'
import {
  manuscriptAssetIdSchema,
  manuscriptAssetMimeTypeSchema,
  manuscriptAssetUrlSchema,
  sectionIdSchema,
  sectionRevisionIdSchema
} from './manuscript'
import { projectSessionIdSchema } from './projects'

export const manuscriptAssetUsageFilterSchema = z.enum(['all', 'used', 'unused'])
export const manuscriptAssetSourceFilterSchema = z.enum(['all', 'generated', 'uploaded'])
export const manuscriptAssetAvailabilitySchema = z.enum(['available', 'missing', 'changed'])
export const manuscriptAssetProtectionReasonSchema = z.enum([
  'current_revision',
  'retained_history',
  'retained_proposal',
  'candidate_lineage'
])

export const manuscriptAssetVariantReferenceSchema = z
  .object({
    variantId: z.uuid(),
    assetId: manuscriptAssetIdSchema,
    disposition: z.enum(['replace', 'insert_after']),
    generationProposalId: z.uuid(),
    modelRequestId: z.uuid(),
    agentRunId: z.uuid(),
    agentToolCallId: z.string().min(1).max(256),
    sectionProposalId: z.uuid().nullable(),
    createdAt: z.iso.datetime()
  })
  .strict()

export const manuscriptAssetWorkspaceInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    usage: manuscriptAssetUsageFilterSchema.default('all'),
    source: manuscriptAssetSourceFilterSchema.default('all'),
    sectionId: sectionIdSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(40)
  })
  .strict()

export const manuscriptAssetCurrentReferenceSchema = z
  .object({
    sectionId: sectionIdSchema,
    sectionRevisionId: sectionRevisionIdSchema,
    sectionTitle: z.string().min(1).max(500),
    blockId: z.string().min(1).max(256),
    figureId: z.string().min(1).max(600).nullable()
  })
  .strict()

export const manuscriptAssetGenerationLineageSchema = z
  .object({
    modelRequestId: z.uuid().nullable(),
    agentRunId: z.uuid().nullable(),
    agentToolCallId: z.string().min(1).max(256).nullable(),
    aspectRatio: z.enum(['auto', '1:1', '16:9']).nullable(),
    requestedImageSize: z.enum(['1K', '2K']).nullable(),
    effectiveImageSize: z.enum(['1K', '2K']).nullable()
  })
  .strict()

export const manuscriptAssetWorkspaceItemSchema = z
  .object({
    assetId: manuscriptAssetIdSchema,
    logicalUrl: manuscriptAssetUrlSchema,
    mimeType: manuscriptAssetMimeTypeSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    width: z.number().int().positive().max(8_192).nullable(),
    height: z.number().int().positive().max(8_192).nullable(),
    sourceType: z.enum(['upload', 'generated']),
    originalName: z.string().max(500).nullable(),
    createdAt: z.iso.datetime(),
    availability: manuscriptAssetAvailabilitySchema,
    currentReferences: z.array(manuscriptAssetCurrentReferenceSchema).max(200),
    currentReferenceCount: z.number().int().nonnegative(),
    historicalReferenceCount: z.number().int().nonnegative(),
    proposalReferenceCount: z.number().int().nonnegative(),
    protectionReasons: z.array(manuscriptAssetProtectionReasonSchema).max(3),
    canDelete: z.boolean(),
    generation: manuscriptAssetGenerationLineageSchema.nullable(),
    parents: z.array(manuscriptAssetVariantReferenceSchema).max(50).default([]),
    candidates: z.array(manuscriptAssetVariantReferenceSchema).max(50).default([])
  })
  .strict()

export const manuscriptAssetWorkspacePageSchema = z
  .object({
    items: z.array(manuscriptAssetWorkspaceItemSchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable(),
    filteredTotal: z.number().int().nonnegative(),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        used: z.number().int().nonnegative(),
        unused: z.number().int().nonnegative(),
        generated: z.number().int().nonnegative(),
        uploaded: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict()

export const deleteManuscriptAssetInputSchema = z
  .object({ projectSessionId: projectSessionIdSchema, assetId: manuscriptAssetIdSchema })
  .strict()

export const deleteManuscriptAssetResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('deleted'), assetId: manuscriptAssetIdSchema }).strict(),
  z
    .object({
      outcome: z.literal('protected'),
      assetId: manuscriptAssetIdSchema,
      reasons: z.array(manuscriptAssetProtectionReasonSchema).min(1).max(4)
    })
    .strict(),
  z.object({ outcome: z.literal('pending'), assetId: manuscriptAssetIdSchema }).strict()
])

export type ManuscriptAssetWorkspaceInput = z.infer<typeof manuscriptAssetWorkspaceInputSchema>
export type ManuscriptAssetWorkspaceItem = z.infer<typeof manuscriptAssetWorkspaceItemSchema>
export type ManuscriptAssetWorkspacePage = z.infer<typeof manuscriptAssetWorkspacePageSchema>
export type DeleteManuscriptAssetResult = z.infer<typeof deleteManuscriptAssetResultSchema>
export type ManuscriptAssetUsageFilter = z.infer<typeof manuscriptAssetUsageFilterSchema>
export type ManuscriptAssetSourceFilter = z.infer<typeof manuscriptAssetSourceFilterSchema>
