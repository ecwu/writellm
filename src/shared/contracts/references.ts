import { z } from 'zod'
import { editorSessionInputSchema } from './manuscript'

export const CITATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u
export const REFERENCE_CSL_MAX_BYTES = 1024 * 1024
export const BIBLIOGRAPHY_SOURCE_MAX_BYTES = 20 * 1024 * 1024
export const BIBLIOGRAPHY_SOURCE_MAX_ITEMS = 10_000

export const citationKeySchema = z.string().regex(CITATION_KEY_PATTERN)
export const referenceSourceFormatSchema = z.enum(['better-csl-json', 'bibtex'])
export const referenceSyncStatusSchema = z.enum([
  'unbound',
  'synced',
  'changed',
  'relink_required',
  'source_unavailable'
])

export const cslCreatorSchema = z
  .object({
    given: z.string().max(1024).optional(),
    family: z.string().max(1024).optional(),
    literal: z.string().max(2048).optional()
  })
  .passthrough()
  .refine(
    (creator) =>
      creator.given !== undefined || creator.family !== undefined || creator.literal !== undefined
  )

export const cslItemSchema = z
  .object({
    id: z.string().min(1).max(1024),
    'citation-key': z.string().min(1).max(1024).optional(),
    type: z.string().min(1).max(100),
    title: z.string().min(1).max(4096),
    'container-title': z
      .union([z.string().max(2048), z.array(z.string().max(2048)).max(4)])
      .optional(),
    author: z.array(cslCreatorSchema).max(500).optional(),
    editor: z.array(cslCreatorSchema).max(500).optional(),
    translator: z.array(cslCreatorSchema).max(500).optional(),
    'container-author': z.array(cslCreatorSchema).max(500).optional(),
    issued: z
      .object({
        'date-parts': z.array(z.array(z.union([z.number(), z.string()])).max(3)).max(4)
      })
      .passthrough()
      .optional(),
    DOI: z.string().max(512).optional(),
    ISBN: z.union([z.string().max(256), z.array(z.string().max(256)).max(20)]).optional(),
    URL: z.string().max(4096).optional(),
    file: z.string().max(32_768).optional()
  })
  .passthrough()

export const referenceCreatorSchema = z
  .object({
    role: z.enum(['author', 'editor', 'translator', 'container-author']),
    ordinal: z.number().int().nonnegative().max(499),
    given: z.string().max(1024).nullable(),
    family: z.string().max(1024).nullable(),
    literal: z.string().max(2048).nullable()
  })
  .strict()

export const referenceItemSchema = z
  .object({
    referenceId: z.uuid(),
    citationKey: citationKeySchema,
    cslType: z.string().min(1).max(100),
    title: z.string().min(1).max(4096),
    containerTitle: z.string().max(2048).nullable(),
    issuedYear: z.number().int().min(-9999).max(9999).nullable(),
    doi: z.string().max(512).nullable(),
    isbn: z.string().max(256).nullable(),
    url: z.string().max(4096).nullable(),
    csl: cslItemSchema,
    creators: z.array(referenceCreatorSchema).max(2000),
    metadataCompleteness: z.enum(['complete', 'partial', 'incomplete']),
    syncStatus: referenceSyncStatusSchema,
    evidenceAvailable: z.boolean(),
    knowledgeItemIds: z.array(z.uuid()).max(100),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict()

export const referenceListInputSchema = editorSessionInputSchema
  .extend({ query: z.string().trim().max(512).default('') })
  .strict()
export const referenceListResultSchema = z.array(referenceItemSchema).max(10_000)

export const bibliographyConnectorSchema = z
  .object({
    connectorId: z.uuid(),
    sourceName: z.string().min(1).max(1024),
    sourceFormat: referenceSourceFormatSchema,
    state: z.enum(['ready', 'refreshing', 'error', 'disconnected']),
    lastSnapshotSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    lastErrorCode: z.string().max(100).nullable(),
    lastRefreshedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime()
  })
  .strict()

export const bibliographyImportIssueSchema = z
  .object({
    index: z.number().int().nonnegative(),
    upstreamKey: z.string().max(1024).nullable(),
    code: z.enum(['invalid_item', 'duplicate_upstream_key', 'item_too_large']),
    message: z.string().min(1).max(500)
  })
  .strict()

export const bibliographyImportCandidateSchema = z
  .object({
    candidateId: z.string().regex(/^[a-f0-9]{64}$/u),
    upstreamKey: z.string().min(1).max(1024),
    proposedCitationKey: citationKeySchema,
    title: z.string().min(1).max(4096),
    authors: z.array(z.string().max(2048)).max(500),
    containerTitle: z.string().max(2048).nullable(),
    issuedYear: z.number().int().min(-9999).max(9999).nullable(),
    alreadyImportedReferenceId: z.uuid().nullable(),
    attachmentCount: z.number().int().nonnegative().max(100)
  })
  .strict()

export const bibliographySnapshotSchema = z
  .object({
    connector: bibliographyConnectorSchema,
    candidates: z.array(bibliographyImportCandidateSchema).max(BIBLIOGRAPHY_SOURCE_MAX_ITEMS),
    issues: z.array(bibliographyImportIssueSchema).max(BIBLIOGRAPHY_SOURCE_MAX_ITEMS),
    validItemCount: z.number().int().nonnegative().max(BIBLIOGRAPHY_SOURCE_MAX_ITEMS),
    skippedItemCount: z.number().int().nonnegative().max(BIBLIOGRAPHY_SOURCE_MAX_ITEMS)
  })
  .strict()
export const bibliographySnapshotResultSchema = bibliographySnapshotSchema.nullable()

export const bibliographyChooseInputSchema = editorSessionInputSchema
export const bibliographySnapshotInputSchema = editorSessionInputSchema
export const bibliographyPrepareImportInputSchema = editorSessionInputSchema
  .extend({
    connectorId: z.uuid(),
    candidateIds: z
      .array(z.string().regex(/^[a-f0-9]{64}$/u))
      .min(1)
      .max(500),
    includePdf: z.boolean().default(true)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.includePdf && value.candidateIds.length > 50) {
      context.addIssue({
        code: 'too_big',
        maximum: 50,
        origin: 'array',
        path: ['candidateIds'],
        message: 'PDF import review is limited to 50 references'
      })
    }
  })

export const bibliographyImportAttachmentSchema = z
  .object({
    attachmentId: z.uuid(),
    candidateId: z.string().regex(/^[a-f0-9]{64}$/u),
    fileName: z.string().min(1).max(1024),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024)
  })
  .strict()

export const bibliographyImportTargetSchema = z
  .object({
    referenceId: z.uuid(),
    citationKey: citationKeySchema,
    title: z.string().min(1).max(4096),
    kind: z.enum(['complete_incomplete', 'relink']),
    knowledgeItemIds: z.array(z.uuid()).max(100)
  })
  .strict()

export const bibliographyImportPlanItemSchema = bibliographyImportCandidateSchema
  .extend({
    pdfStatus: z.enum(['available', 'unavailable', 'not_requested']),
    attachments: z.array(bibliographyImportAttachmentSchema).max(20)
  })
  .strict()

export const bibliographyImportPlanSchema = z
  .object({
    previewId: z.uuid(),
    includePdf: z.boolean(),
    items: z.array(bibliographyImportPlanItemSchema).min(1).max(500),
    eligibleTargets: z.array(bibliographyImportTargetSchema).max(10_000),
    expiresAt: z.iso.datetime()
  })
  .strict()

export const bibliographyConfirmImportSelectionSchema = z
  .object({
    candidateId: z.string().regex(/^[a-f0-9]{64}$/u),
    targetReferenceId: z.uuid().nullable(),
    primaryAttachmentId: z.uuid().nullable(),
    supplementAttachmentIds: z.array(z.uuid()).max(49)
  })
  .strict()
  .refine(
    (value) =>
      value.primaryAttachmentId === null ||
      !value.supplementAttachmentIds.includes(value.primaryAttachmentId),
    { message: 'The primary attachment cannot also be supplemental' }
  )
  .refine(
    (value) => value.primaryAttachmentId !== null || value.supplementAttachmentIds.length === 0,
    { message: 'Supplemental attachments require a primary attachment' }
  )

export const bibliographyConfirmImportInputSchema = editorSessionInputSchema
  .extend({
    previewId: z.uuid(),
    selections: z.array(bibliographyConfirmImportSelectionSchema).min(1).max(50)
  })
  .strict()
  .superRefine((value, context) => {
    const candidateIds = new Set<string>()
    const targetIds = new Set<string>()
    let attachmentCount = 0
    for (const [index, selection] of value.selections.entries()) {
      if (candidateIds.has(selection.candidateId)) {
        context.addIssue({
          code: 'custom',
          path: ['selections', index, 'candidateId'],
          message: 'Each candidate may be confirmed only once'
        })
      }
      candidateIds.add(selection.candidateId)
      if (selection.targetReferenceId !== null) {
        if (targetIds.has(selection.targetReferenceId)) {
          context.addIssue({
            code: 'custom',
            path: ['selections', index, 'targetReferenceId'],
            message: 'Each existing Reference may be selected only once'
          })
        }
        targetIds.add(selection.targetReferenceId)
      }
      attachmentCount +=
        selection.supplementAttachmentIds.length + (selection.primaryAttachmentId === null ? 0 : 1)
    }
    if (attachmentCount > 50) {
      context.addIssue({
        code: 'custom',
        path: ['selections'],
        message: 'At most 50 PDF attachments may be imported at once'
      })
    }
  })

export const bibliographyImportOutcomeSchema = z
  .object({
    candidateId: z.string().regex(/^[a-f0-9]{64}$/u),
    referenceId: z.uuid().nullable(),
    state: z.enum(['complete', 'citation_only', 'partial', 'failed']),
    errorCode: z
      .enum([
        'pdf_already_linked',
        'attachment_unavailable',
        'target_unavailable',
        'candidate_stale',
        'import_failed'
      ])
      .nullable(),
    importedKnowledgeItemIds: z.array(z.uuid()).max(50)
  })
  .strict()

export const bibliographyConfirmImportResultSchema = z
  .object({
    references: referenceListResultSchema,
    outcomes: z.array(bibliographyImportOutcomeSchema).min(1).max(50)
  })
  .strict()

export const referenceSettingsSchema = z
  .object({
    styleId: z.string().min(1).max(256),
    locale: z.string().min(2).max(35),
    customStyleSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
  })
  .strict()
export const referenceSettingsInputSchema = editorSessionInputSchema
  .extend({
    styleId: z.enum(['apa', 'ieee', 'vancouver']),
    locale: z.string().min(2).max(35)
  })
  .strict()
export const referenceCustomStyleInputSchema = editorSessionInputSchema
export const formattedReferenceSnapshotInputSchema = editorSessionInputSchema
export const bibliographyExportInputSchema = editorSessionInputSchema
  .extend({
    format: z.enum(['bibtex', 'csl-json']),
    scope: z.enum(['cited-only', 'all-project'])
  })
  .strict()
export const bibliographyExportResultSchema = z
  .object({
    exported: z.boolean(),
    exportedCount: z.number().int().nonnegative().max(10_000),
    lossCount: z.number().int().nonnegative().max(10_000)
  })
  .strict()
export const legacyCitationConversionPlanInputSchema = editorSessionInputSchema
export const legacyCitationConversionPlanSchema = z
  .object({
    planId: z.uuid(),
    replacements: z
      .array(
        z
          .object({
            title: z.string().min(1).max(512),
            citationKey: citationKeySchema,
            occurrenceCount: z.number().int().positive().max(50_000)
          })
          .strict()
      )
      .max(10_000),
    ambiguousTitles: z.array(z.string().min(1).max(512)).max(10_000),
    unmatchedTitles: z.array(z.string().min(1).max(512)).max(10_000)
  })
  .strict()
export const legacyCitationConversionApplyInputSchema = editorSessionInputSchema
  .extend({ planId: z.uuid() })
  .strict()
export const legacyCitationConversionApplyResultSchema = z
  .object({ sectionsChanged: z.number().int().nonnegative().max(10_000) })
  .strict()
export const formattedReferenceSnapshotSchema = z
  .object({
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    styleId: z.string().min(1).max(256),
    locale: z.string().min(2).max(35),
    citations: z
      .array(
        z
          .object({
            clusterId: z.string().min(1).max(256),
            raw: z.string().min(1).max(8192),
            formatted: z.string().max(64_000)
          })
          .strict()
      )
      .max(50_000),
    bibliography: z
      .array(
        z.object({ citationKey: citationKeySchema, formatted: z.string().max(256_000) }).strict()
      )
      .max(10_000)
  })
  .strict()

export type CslItem = z.infer<typeof cslItemSchema>
export type ReferenceItem = z.infer<typeof referenceItemSchema>
export type BibliographyConnector = z.infer<typeof bibliographyConnectorSchema>
export type BibliographySnapshot = z.infer<typeof bibliographySnapshotSchema>
export type BibliographyImportPlan = z.infer<typeof bibliographyImportPlanSchema>
export type BibliographyImportTarget = z.infer<typeof bibliographyImportTargetSchema>
export type BibliographyConfirmImportSelection = z.infer<
  typeof bibliographyConfirmImportSelectionSchema
>
export type BibliographyImportOutcome = z.infer<typeof bibliographyImportOutcomeSchema>
export type ReferenceSettings = z.infer<typeof referenceSettingsSchema>
export type FormattedReferenceSnapshot = z.infer<typeof formattedReferenceSnapshotSchema>
export type LegacyCitationConversionPlan = z.infer<typeof legacyCitationConversionPlanSchema>
