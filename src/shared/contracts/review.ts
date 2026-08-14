import { z } from 'zod'
import { agentRunIdSchema, agentSessionIdSchema } from './agent'

// Kept local to avoid a runtime cycle when mutation proposal contracts embed
// review issue resolution links.
const mutationProposalIdSchema = z.uuid()

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const reviewPrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])
export const reviewIssueCategorySchema = z.enum([
  'integrity',
  'structure',
  'citation',
  'evidence',
  'consistency',
  'terminology',
  'translation',
  'audience',
  'style',
  'objective',
  'other'
])
export const reviewIssueStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'dismissed'])
export const reviewIssueEventTypeSchema = z.enum([
  'created',
  'refreshed',
  'claimed',
  'reassigned',
  'released',
  'resolved',
  'reopened',
  'dismissed',
  'priority_changed',
  'proposal_linked'
])

export const reviewIssueAnchorSchema = strictObject({
  sectionId: z.uuid(),
  revisionId: z.uuid(),
  blockId: z.string().min(1).max(256).nullable()
})

export const reviewIssueRecordSchema = strictObject({
  issueId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  priority: reviewPrioritySchema,
  category: reviewIssueCategorySchema,
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(8_192),
  evidence: z.string().max(8_192),
  citationIds: z.array(z.string().regex(/^citation-[a-f0-9]{40}$/u)).max(10),
  sourceKind: z.enum(['deterministic', 'semantic']),
  checkId: z.string().min(1).max(128).nullable(),
  anchor: reviewIssueAnchorSchema.nullable(),
  anchorStatus: z.enum(['current', 'orphaned', 'manuscript']),
  sourceAgentSessionId: agentSessionIdSchema.nullable(),
  sourceAgentRunId: agentRunIdSchema.nullable(),
  status: reviewIssueStatusSchema,
  assignedAgentSessionId: agentSessionIdSchema.nullable(),
  version: z.number().int().positive(),
  resolvedByProposalId: mutationProposalIdSchema.nullable(),
  resolutionSummary: z.string().max(4_096).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  dismissedAt: z.iso.datetime().nullable()
})

export const reviewIssueEventSchema = strictObject({
  eventId: z.uuid(),
  issueId: z.uuid(),
  eventType: reviewIssueEventTypeSchema,
  fromStatus: reviewIssueStatusSchema.nullable(),
  toStatus: reviewIssueStatusSchema,
  actorKind: z.enum(['agent', 'user', 'system']),
  actorAgentSessionId: agentSessionIdSchema.nullable(),
  actorAgentRunId: agentRunIdSchema.nullable(),
  proposalId: mutationProposalIdSchema.nullable(),
  summary: z.string().max(4_096).nullable(),
  occurredAt: z.iso.datetime()
})

export const listReviewIssuesArgsSchema = strictObject({
  statuses: z.array(reviewIssueStatusSchema).max(4).default([]),
  priorities: z.array(reviewPrioritySchema).max(4).default([]),
  categories: z.array(reviewIssueCategorySchema).max(11).default([]),
  sectionId: z
    .uuid()
    .optional()
    .describe('Copy an exact sectionId from get_writing_context or read_outline.'),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Copy list_review_issues.nextCursor exactly; omit to restart.'),
  limit: z.number().int().min(1).max(100).default(50)
})

export const listReviewIssuesResultSchema = strictObject({
  issues: z.array(reviewIssueRecordSchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable(),
  total: z.number().int().nonnegative()
})

const reviewIssueCandidateSchema = strictObject({
  existingIssueId: z
    .uuid()
    .optional()
    .describe('Copy list_review_issues.issues[].issueId when refreshing an issue.'),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Copy list_review_issues.issues[].version for existingIssueId.'),
  priority: reviewPrioritySchema,
  category: reviewIssueCategorySchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(8_192),
  evidence: z.string().max(8_192),
  citationIds: z
    .array(z.string().regex(/^citation-[a-f0-9]{40}$/u))
    .max(10)
    .default([]),
  sourceKind: z.enum(['deterministic', 'semantic']),
  checkId: z.string().min(1).max(128).nullable().default(null),
  anchor: reviewIssueAnchorSchema.nullable().default(null)
}).refine(
  (value) => (value.existingIssueId === undefined) === (value.expectedVersion === undefined),
  {
    message:
      'Expected existingIssueId and expectedVersion together, received only one. Call list_review_issues, copy both fields, and retry record_review_issues once.'
  }
)

export const recordReviewIssuesArgsSchema = strictObject({
  issues: z.array(reviewIssueCandidateSchema).min(1).max(50)
})

export const recordReviewIssuesResultSchema = strictObject({
  issues: z.array(reviewIssueRecordSchema).max(50),
  created: z.number().int().nonnegative(),
  refreshed: z.number().int().nonnegative(),
  deduplicated: z.number().int().nonnegative(),
  truncated: z.boolean()
})

export const reviewIssueUpdateOperationSchema = z.discriminatedUnion('action', [
  strictObject({
    action: z.literal('claim'),
    issueId: z.uuid().describe('Copy list_review_issues.issues[].issueId.'),
    expectedVersion: z
      .number()
      .int()
      .positive()
      .describe('Copy list_review_issues.issues[].version for issueId.')
  }),
  strictObject({
    action: z.literal('release'),
    issueId: z.uuid().describe('Copy list_review_issues.issues[].issueId.'),
    expectedVersion: z
      .number()
      .int()
      .positive()
      .describe('Copy list_review_issues.issues[].version for issueId.')
  }),
  strictObject({
    action: z.literal('resolve'),
    issueId: z.uuid().describe('Copy list_review_issues.issues[].issueId.'),
    expectedVersion: z
      .number()
      .int()
      .positive()
      .describe('Copy list_review_issues.issues[].version for issueId.'),
    reason: z.string().trim().min(1).max(4_096)
  }),
  strictObject({
    action: z.literal('reopen'),
    issueId: z.uuid().describe('Copy list_review_issues.issues[].issueId.'),
    expectedVersion: z
      .number()
      .int()
      .positive()
      .describe('Copy list_review_issues.issues[].version for issueId.')
  })
])

export const updateReviewIssuesArgsSchema = strictObject({
  operations: z.array(reviewIssueUpdateOperationSchema).min(1).max(20)
})

export const updateReviewIssuesResultSchema = strictObject({
  issues: z.array(reviewIssueRecordSchema).max(20)
})

export const reviewIssueUserOperationSchema = z.discriminatedUnion('action', [
  strictObject({
    action: z.literal('setPriority'),
    issueId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    priority: reviewPrioritySchema
  }),
  strictObject({
    action: z.literal('dismiss'),
    issueId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(4_096)
  }),
  strictObject({
    action: z.literal('reopen'),
    issueId: z.uuid(),
    expectedVersion: z.number().int().positive()
  }),
  strictObject({
    action: z.literal('release'),
    issueId: z.uuid(),
    expectedVersion: z.number().int().positive()
  })
])

export const resolvesReviewIssueSchema = strictObject({
  issueId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  resolutionSummary: z.string().trim().min(1).max(4_096)
})

export type ReviewPriority = z.infer<typeof reviewPrioritySchema>
export type ReviewIssueCategory = z.infer<typeof reviewIssueCategorySchema>
export type ReviewIssueStatus = z.infer<typeof reviewIssueStatusSchema>
export type ReviewIssueRecord = z.infer<typeof reviewIssueRecordSchema>
export type ReviewIssueEvent = z.infer<typeof reviewIssueEventSchema>
export type ReviewIssueUpdateOperation = z.infer<typeof reviewIssueUpdateOperationSchema>
export type ReviewIssueUserOperation = z.infer<typeof reviewIssueUserOperationSchema>
export type ResolvesReviewIssue = z.infer<typeof resolvesReviewIssueSchema>
export type ListReviewIssuesResult = z.infer<typeof listReviewIssuesResultSchema>
export type RecordReviewIssuesResult = z.infer<typeof recordReviewIssuesResultSchema>
export type UpdateReviewIssuesResult = z.infer<typeof updateReviewIssuesResultSchema>
