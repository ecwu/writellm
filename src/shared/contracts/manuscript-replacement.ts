import { z } from 'zod'
import { sectionIdSchema, sectionRevisionIdSchema, sectionStatusSchema } from './manuscript'
import { manuscriptSearchQuerySchema, manuscriptSearchScopeSchema } from './manuscript-search'

export const MANUSCRIPT_REPLACEMENT_MAX_CANDIDATES = 2_000
export const MANUSCRIPT_REPLACEMENT_MAX_SELECTIONS = 500
export const MANUSCRIPT_REPLACEMENT_MAX_SECTIONS = 100
export const MANUSCRIPT_REPLACEMENT_MAX_PAGE_SIZE = 50

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

export const manuscriptReplacementTextSchema = z
  .string()
  .max(4_096)
  .refine(wellFormedUtf16, 'Replacement must contain well-formed UTF-16')
  .refine((value) => !/[\r\n\0]/u.test(value), 'Replacement must be a single line')

export const manuscriptReplacementSkipReasonSchema = z.enum([
  'section_metadata',
  'readable_citation',
  'link_text',
  'code_block',
  'inline_code',
  'structured_overlap',
  'unchanged'
])

export const manuscriptReplacementPlanInputSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    query: manuscriptSearchQuerySchema,
    caseSensitive: z.boolean().default(false),
    scope: manuscriptSearchScopeSchema.default({ type: 'manuscript' }),
    statuses: z.array(sectionStatusSchema).max(3).default([]),
    replacement: manuscriptReplacementTextSchema
  })
  .strict()

export const manuscriptReplacementCandidateSchema = z
  .object({
    candidateId: z.string().uuid(),
    sectionId: sectionIdSchema,
    sectionTitle: z.string().min(1).max(500),
    sectionStatus: sectionStatusSchema,
    headingPath: z.array(z.string().min(1).max(500)).max(64),
    targetKind: z.enum([
      'section_title',
      'section_objective',
      'block_inline',
      'table_cell',
      'block_caption'
    ]),
    beforePreview: z.string().max(900),
    afterPreview: z.string().max(900),
    eligible: z.boolean(),
    skipReason: manuscriptReplacementSkipReasonSchema.nullable()
  })
  .strict()
  .refine((value) => value.eligible === (value.skipReason === null), {
    message: 'Replacement eligibility is inconsistent'
  })

const readyPlanSchema = z
  .object({
    status: z.literal('ready'),
    planId: z.string().uuid(),
    expiresAt: z.string().datetime(),
    candidateCount: z.number().int().nonnegative().max(MANUSCRIPT_REPLACEMENT_MAX_CANDIDATES),
    eligibleCount: z.number().int().nonnegative().max(MANUSCRIPT_REPLACEMENT_MAX_CANDIDATES),
    skippedCount: z.number().int().nonnegative().max(MANUSCRIPT_REPLACEMENT_MAX_CANDIDATES),
    sectionCount: z.number().int().nonnegative().max(1_000),
    candidates: z
      .array(manuscriptReplacementCandidateSchema)
      .max(MANUSCRIPT_REPLACEMENT_MAX_PAGE_SIZE),
    nextCursor: z.string().min(1).max(2_048).nullable()
  })
  .strict()
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 512 * 1024,
    'Replacement plan page exceeds the IPC byte budget'
  )

const unavailablePlanSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.enum(['result_limit', 'scan_budget', 'plan_size'])
  })
  .strict()

export const manuscriptReplacementPlanResultSchema = z.discriminatedUnion('status', [
  readyPlanSchema,
  unavailablePlanSchema
])

export const manuscriptReplacementPageInputSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    planId: z.string().uuid(),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(MANUSCRIPT_REPLACEMENT_MAX_PAGE_SIZE).default(25)
  })
  .strict()

export const manuscriptReplacementPageResultSchema = z.discriminatedUnion('status', [
  readyPlanSchema,
  z.object({ status: z.literal('invalid_plan') }).strict(),
  z.object({ status: z.literal('expired_plan') }).strict()
])

export const manuscriptReplacementDismissInputSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    planId: z.string().uuid()
  })
  .strict()

export const manuscriptReplacementApplyInputSchema = manuscriptReplacementDismissInputSchema
  .extend({
    candidateIds: z.array(z.string().uuid()).min(1).max(MANUSCRIPT_REPLACEMENT_MAX_SELECTIONS),
    commandId: z.string().uuid(),
    createCheckpoint: z.boolean().default(false)
  })
  .strict()
  .refine((value) => new Set(value.candidateIds).size === value.candidateIds.length, {
    message: 'Replacement candidates must be unique'
  })

const affectedSectionSchema = z
  .object({
    sectionId: sectionIdSchema,
    sectionRevisionId: sectionRevisionIdSchema,
    undoCapability: z.string().uuid(),
    undoExpiresAt: z.string().datetime()
  })
  .strict()

const appliedReceiptFields = {
  commandId: z.string().uuid(),
  selectedCount: z.number().int().positive().max(MANUSCRIPT_REPLACEMENT_MAX_SELECTIONS),
  affectedSections: z.array(affectedSectionSchema).min(1).max(MANUSCRIPT_REPLACEMENT_MAX_SECTIONS),
  pendingRepairSectionIds: z.array(sectionIdSchema).max(MANUSCRIPT_REPLACEMENT_MAX_SECTIONS),
  checkpointCreated: z.boolean()
}

export const manuscriptReplacementApplyResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), ...appliedReceiptFields }).strict(),
  z.object({ status: z.literal('already_applied'), ...appliedReceiptFields }).strict(),
  z.object({ status: z.literal('conflict') }).strict(),
  z.object({ status: z.literal('invalid_plan') }).strict(),
  z.object({ status: z.literal('expired_plan') }).strict()
])

export const manuscriptReplacementUndoInputSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    undoCapability: z.string().uuid()
  })
  .strict()

export const manuscriptReplacementUndoResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('undone'),
      sectionId: sectionIdSchema,
      sectionRevisionId: sectionRevisionIdSchema,
      materializationPending: z.boolean()
    })
    .strict(),
  z.object({ status: z.literal('already_undone') }).strict(),
  z.object({ status: z.literal('stale') }).strict(),
  z.object({ status: z.literal('invalid_capability') }).strict(),
  z.object({ status: z.literal('expired_capability') }).strict()
])

export const manuscriptReplacementChangedEventSchema = z
  .object({
    projectSessionId: z.string().min(1).max(256),
    reason: z.enum(['replacement', 'undo']),
    sections: z
      .array(
        z
          .object({ sectionId: sectionIdSchema, sectionRevisionId: sectionRevisionIdSchema })
          .strict()
      )
      .min(1)
      .max(MANUSCRIPT_REPLACEMENT_MAX_SECTIONS)
  })
  .strict()

export const manuscriptReplacementSubscriptionInputSchema = z
  .object({ projectSessionId: z.string().min(1).max(256), subscriptionId: z.string().uuid() })
  .strict()

export type ManuscriptReplacementPlanInput = z.output<typeof manuscriptReplacementPlanInputSchema>
export type ManuscriptReplacementCandidate = z.infer<typeof manuscriptReplacementCandidateSchema>
export type ManuscriptReplacementPlanResult = z.infer<typeof manuscriptReplacementPlanResultSchema>
export type ManuscriptReplacementPageInput = z.output<typeof manuscriptReplacementPageInputSchema>
export type ManuscriptReplacementPageResult = z.infer<typeof manuscriptReplacementPageResultSchema>
export type ManuscriptReplacementApplyInput = z.output<typeof manuscriptReplacementApplyInputSchema>
export type ManuscriptReplacementApplyResult = z.infer<
  typeof manuscriptReplacementApplyResultSchema
>
export type ManuscriptReplacementUndoResult = z.infer<typeof manuscriptReplacementUndoResultSchema>
export type ManuscriptReplacementChangedEvent = z.infer<
  typeof manuscriptReplacementChangedEventSchema
>
export type ManuscriptReplacementSkipReason = z.infer<typeof manuscriptReplacementSkipReasonSchema>
