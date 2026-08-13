import { z } from 'zod'
import {
  blockNoteDocumentSchema,
  contentHashSchema,
  manuscriptAssetIdSchema,
  manuscriptAssetMimeTypeSchema,
  manuscriptAssetUrlSchema,
  sectionIdSchema,
  sectionRevisionIdSchema
} from './manuscript'

export const MANUSCRIPT_IMPORT_PLAN_VERSION = 1
export const MAX_MANUSCRIPT_IMPORT_SOURCE_BYTES = 8 * 1024 * 1024
export const MAX_MANUSCRIPT_IMPORT_CAPTURE_BYTES = 100 * 1024 * 1024
export const MAX_MANUSCRIPT_IMPORT_SECTIONS = 256
export const MAX_MANUSCRIPT_IMPORT_ASSETS = 100

const sourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const importPlanIdSchema = z.uuid()
const proposedSectionIdSchema = z.uuid()

export const manuscriptImportPlanRequestSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    activeSectionId: sectionIdSchema,
    selection: z.enum(['file', 'directory']).optional()
  })
  .strict()

const importFindingSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(2_000),
    sourceLocation: z.string().min(1).max(500).nullable()
  })
  .strict()

export const manuscriptImportPlanSchema = z
  .object({
    version: z.literal(MANUSCRIPT_IMPORT_PLAN_VERSION),
    planId: importPlanIdSchema,
    expiresAt: z.iso.datetime(),
    source: z
      .object({
        displayName: z.string().min(1).max(500),
        format: z.enum(['markdown', 'latex', 'latex-project']),
        byteSize: z.number().int().nonnegative().max(MAX_MANUSCRIPT_IMPORT_CAPTURE_BYTES),
        sha256: sourceHashSchema
      })
      .strict(),
    base: z
      .object({
        manuscriptId: z.string().min(1).max(256),
        briefVersion: z.number().int().positive(),
        outlineVersion: z.number().int().positive(),
        activeSectionId: sectionIdSchema,
        activeRevisionId: sectionRevisionIdSchema,
        activeContentHash: contentHashSchema
      })
      .strict(),
    proposedBrief: z.object({ title: z.string().trim().min(1).max(500).nullable() }).strict(),
    sections: z
      .array(
        z
          .object({
            proposedSectionId: proposedSectionIdSchema,
            title: z.string().trim().min(1).max(500),
            outlineLevel: z.number().int().min(1).max(64),
            document: blockNoteDocumentSchema,
            blockCount: z.number().int().nonnegative(),
            previewText: z.string().max(20_000)
          })
          .strict()
      )
      .max(MAX_MANUSCRIPT_IMPORT_SECTIONS),
    assets: z
      .array(
        z
          .object({
            assetId: manuscriptAssetIdSchema,
            logicalUrl: manuscriptAssetUrlSchema,
            displayName: z.string().min(1).max(500),
            mimeType: manuscriptAssetMimeTypeSchema,
            byteSize: z
              .number()
              .int()
              .positive()
              .max(20 * 1024 * 1024),
            sha256: sourceHashSchema
          })
          .strict()
      )
      .max(MAX_MANUSCRIPT_IMPORT_ASSETS),
    warnings: z.array(importFindingSchema).max(1_000),
    unsupported: z.array(importFindingSchema).max(1_000),
    losses: z.array(importFindingSchema).max(1_000),
    noOp: z.boolean()
  })
  .strict()

export const manuscriptImportPlanResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('ready'), plan: manuscriptImportPlanSchema }).strict()
])

export const manuscriptImportApplyInputSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    planId: importPlanIdSchema,
    mode: z.enum(['create_sections', 'replace_active_section'])
  })
  .strict()

export const manuscriptImportApplyResultSchema = z
  .object({
    status: z.literal('applied'),
    mode: z.enum(['create_sections', 'replace_active_section']),
    sourceHash: sourceHashSchema,
    createdSectionIds: z.array(sectionIdSchema).max(MAX_MANUSCRIPT_IMPORT_SECTIONS),
    affectedRevisionIds: z.array(sectionRevisionIdSchema).max(MAX_MANUSCRIPT_IMPORT_SECTIONS),
    materializationPending: z.boolean()
  })
  .strict()

export const manuscriptImportCancelInputSchema = z
  .object({ projectSessionId: z.string().min(1).max(256), planId: importPlanIdSchema })
  .strict()

export const manuscriptImportCancelResultSchema = z
  .object({ status: z.enum(['cancelled', 'not_found']) })
  .strict()

export type ManuscriptImportPlan = z.infer<typeof manuscriptImportPlanSchema>
export type ManuscriptImportPlanResult = z.infer<typeof manuscriptImportPlanResultSchema>
export type ManuscriptImportApplyInput = z.infer<typeof manuscriptImportApplyInputSchema>
export type ManuscriptImportApplyResult = z.infer<typeof manuscriptImportApplyResultSchema>
export type ManuscriptImportCancelResult = z.infer<typeof manuscriptImportCancelResultSchema>
