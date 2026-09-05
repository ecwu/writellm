import { z } from 'zod'
import { agentRunIdSchema, agentSessionIdSchema } from './agent'
import { contentHashSchema, sectionIdSchema, sectionRevisionIdSchema } from './manuscript'
import { projectSessionIdSchema } from './projects'

export const COMMENT_TEXT_MAX_BYTES = 64 * 1024
export const COMMENT_QUOTE_MAX_LENGTH = 32_768
export const COMMENT_PAGE_MAX = 100

export const commentThreadIdSchema = z.uuid()
export const commentMessageIdSchema = z.uuid()
export const commentOperationIdSchema = z.string().min(1).max(256)
export const commentStatusSchema = z.enum(['open', 'resolved'])
export const commentAnchorStatusSchema = z.enum(['attached', 'orphaned'])
export const commentAuthorSchema = z.enum(['author', 'agent'])

const boundedText = z
  .string()
  .trim()
  .min(1)
  .max(COMMENT_TEXT_MAX_BYTES)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= COMMENT_TEXT_MAX_BYTES,
    'Text is too large'
  )

export const commentAnchorSegmentSchema = z
  .object({
    blockId: z.string().min(1).max(256),
    from: z.number().int().nonnegative(),
    to: z.number().int().positive()
  })
  .strict()
  .refine(({ from, to }) => from < to, 'Anchor segment must be non-empty')

export const commentAnchorSchema = z
  .object({
    status: commentAnchorStatusSchema,
    quote: z.string().min(1).max(COMMENT_QUOTE_MAX_LENGTH),
    createdRevisionId: sectionRevisionIdSchema,
    currentRevisionId: sectionRevisionIdSchema,
    segments: z.array(commentAnchorSegmentSchema).min(1).max(100)
  })
  .strict()

export const commentMessageSchema = z
  .object({
    messageId: commentMessageIdSchema,
    author: commentAuthorSchema,
    body: boundedText,
    agentSessionId: agentSessionIdSchema.nullable(),
    agentRunId: agentRunIdSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict()

export const commentEventSchema = z
  .object({
    eventId: z.string(),
    type: z.string(),
    actor: z.enum(['author', 'agent', 'system']),
    agentSessionId: z.string().nullable(),
    agentRunId: z.string().nullable(),
    proposalId: z.string().nullable(),
    sectionRevisionId: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: z.iso.datetime()
  })
  .strict()
export const commentActivitySchema = z
  .object({
    agentSessionId: z.string(),
    agentRunId: z.string().nullable(),
    status: z.string(),
    proposalId: z.string().nullable()
  })
  .strict()

export const commentThreadSchema = z
  .object({
    threadId: commentThreadIdSchema,
    sectionId: sectionIdSchema,
    sectionTitle: z.string().min(1).max(500),
    status: commentStatusSchema,
    version: z.number().int().positive(),
    anchor: commentAnchorSchema,
    messages: z.array(commentMessageSchema).max(1_000),
    events: z.array(commentEventSchema).max(500).default([]),
    activity: commentActivitySchema.nullable().default(null),
    resolvedBy: commentAuthorSchema.nullable(),
    resolutionNote: z.string().max(COMMENT_TEXT_MAX_BYTES).nullable(),
    resolvedRevisionId: sectionRevisionIdSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable()
  })
  .strict()

export const commentThreadSummarySchema = commentThreadSchema
  .omit({ messages: true, events: true })
  .extend({
    messageCount: z.number().int().nonnegative(),
    latestMessagePreview: z.string().max(500)
  })

export const listCommentsInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    status: z.enum(['open', 'resolved', 'all']).default('open'),
    sectionId: sectionIdSchema.optional(),
    query: z.string().trim().max(512).default(''),
    cursor: z.string().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(COMMENT_PAGE_MAX).default(50)
  })
  .strict()

export const listCommentsResultSchema = z
  .object({
    threads: z.array(commentThreadSummarySchema).max(COMMENT_PAGE_MAX),
    nextCursor: z.string().min(1).max(256).nullable()
  })
  .strict()

export const readCommentInputSchema = z
  .object({ projectSessionId: projectSessionIdSchema, threadId: commentThreadIdSchema })
  .strict()

export const createCommentInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    sectionId: sectionIdSchema,
    revisionId: sectionRevisionIdSchema,
    contentHash: contentHashSchema,
    quote: z.string().min(1).max(COMMENT_QUOTE_MAX_LENGTH),
    segments: z.array(commentAnchorSegmentSchema).min(1).max(100),
    body: boundedText
  })
  .strict()

export const replyCommentInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    threadId: commentThreadIdSchema,
    expectedVersion: z.number().int().positive(),
    body: boundedText,
    operationId: commentOperationIdSchema.optional()
  })
  .strict()

export const editCommentInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    threadId: commentThreadIdSchema,
    messageId: commentMessageIdSchema,
    expectedVersion: z.number().int().positive(),
    body: boundedText
  })
  .strict()

export const changeCommentStatusInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    threadId: commentThreadIdSchema,
    expectedVersion: z.number().int().positive(),
    resolutionNote: boundedText.optional()
  })
  .strict()

export const deleteCommentInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    threadId: commentThreadIdSchema,
    expectedVersion: z.number().int().positive()
  })
  .strict()

export const reanchorCommentInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    threadId: commentThreadIdSchema,
    expectedVersion: z.number().int().positive(),
    revisionId: sectionRevisionIdSchema,
    contentHash: contentHashSchema,
    quote: z.string().min(1).max(COMMENT_QUOTE_MAX_LENGTH),
    segments: z.array(commentAnchorSegmentSchema).min(1).max(100)
  })
  .strict()

export const delegateCommentsInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    threadIds: z
      .array(commentThreadIdSchema)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    agentSessionId: agentSessionIdSchema
  })
  .strict()

export const delegateCommentsResultSchema = z
  .object({
    orderedThreadIds: z.array(commentThreadIdSchema).min(1).max(100),
    prompt: z.string().min(1).max(32_768)
  })
  .strict()

export type CommentAnchorSegment = z.infer<typeof commentAnchorSegmentSchema>
export type CommentThread = z.infer<typeof commentThreadSchema>
export type CommentThreadSummary = z.infer<typeof commentThreadSummarySchema>
export type ListCommentsInput = z.infer<typeof listCommentsInputSchema>
export type ListCommentsResult = z.infer<typeof listCommentsResultSchema>
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>
export type ReplyCommentInput = z.infer<typeof replyCommentInputSchema>
export type EditCommentInput = z.infer<typeof editCommentInputSchema>
export type ChangeCommentStatusInput = z.infer<typeof changeCommentStatusInputSchema>
export type DeleteCommentInput = z.infer<typeof deleteCommentInputSchema>
export type ReanchorCommentInput = z.infer<typeof reanchorCommentInputSchema>
export type DelegateCommentsInput = z.infer<typeof delegateCommentsInputSchema>
export type DelegateCommentsResult = z.infer<typeof delegateCommentsResultSchema>
