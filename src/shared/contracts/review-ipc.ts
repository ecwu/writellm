import { z } from 'zod'
import { projectSessionIdSchema } from './projects'
import {
  listReviewIssuesArgsSchema,
  reviewIssueEventSchema,
  reviewIssueRecordSchema,
  reviewIssueUserOperationSchema
} from './review'
import { modelWritingRuleOperationSchema } from './writing-rules'

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const listReviewIssuesIpcInputSchema = listReviewIssuesArgsSchema.extend({
  projectSessionId: projectSessionIdSchema
})

export const reviewIssueEventsInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  issueId: z.uuid()
})

export const reviewIssueEventsResultSchema = z.array(reviewIssueEventSchema).max(1_000)

export const updateReviewIssueIpcInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  operation: reviewIssueUserOperationSchema
})

export const updateReviewIssueIpcResultSchema = reviewIssueRecordSchema

export const updateWritingRulesIpcInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  baseBriefVersion: z.number().int().positive(),
  operations: z.array(modelWritingRuleOperationSchema).min(1).max(50)
})

export type ListReviewIssuesIpcInput = z.input<typeof listReviewIssuesIpcInputSchema>
export type ReviewIssueEventsInput = z.input<typeof reviewIssueEventsInputSchema>
export type UpdateReviewIssueIpcInput = z.input<typeof updateReviewIssueIpcInputSchema>
export type UpdateWritingRulesIpcInput = z.input<typeof updateWritingRulesIpcInputSchema>
