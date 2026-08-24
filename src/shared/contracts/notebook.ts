import { z } from 'zod'
import { agentModelSelectionSchema, agentThinkingLevelSchema } from './providers'
import { projectSessionIdSchema, projectSessionInputSchema } from './projects'
import { citationIdSchema } from './search'

export const NOTEBOOK_MAX_SOURCES = 50
export const NOTEBOOK_MAX_MESSAGES = 200
export const NOTEBOOK_MAX_CHAT_BYTES = 2 * 1024 * 1024
export const NOTEBOOK_MAX_QUESTION_BYTES = 16 * 1024
export const NOTEBOOK_MAX_CITATIONS = 12
export const NOTEBOOK_MAX_EVIDENCE_BYTES = 64 * 1024

const boundedQuestionSchema = z
  .string()
  .trim()
  .min(1)
  .max(NOTEBOOK_MAX_QUESTION_BYTES)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= NOTEBOOK_MAX_QUESTION_BYTES,
    'Notebook question exceeds 16 KiB'
  )

export const notebookSourceScopeSchema = z
  .object({
    mode: z.enum(['all', 'selected']),
    knowledgeItemIds: z.array(z.uuid()).max(NOTEBOOK_MAX_SOURCES)
  })
  .strict()
  .superRefine((scope, context) => {
    if (scope.mode === 'all' && scope.knowledgeItemIds.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeItemIds'],
        message: 'All-source scope does not accept explicit source IDs'
      })
    }
    if (new Set(scope.knowledgeItemIds).size !== scope.knowledgeItemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeItemIds'],
        message: 'Notebook source IDs must be unique'
      })
    }
  })
export type NotebookSourceScope = z.infer<typeof notebookSourceScopeSchema>

export const notebookChatCitationSchema = z
  .object({
    ordinal: z.number().int().min(1).max(NOTEBOOK_MAX_CITATIONS),
    citationId: citationIdSchema,
    knowledgeItemId: z.uuid(),
    title: z.string().min(1).max(512),
    page: z.number().int().nonnegative().nullable(),
    headingPath: z.array(z.string().max(1_000)).max(20)
  })
  .strict()
export type NotebookChatCitation = z.infer<typeof notebookChatCitationSchema>

const notebookUserMessageSchema = z
  .object({
    messageId: z.uuid(),
    role: z.literal('user'),
    content: boundedQuestionSchema,
    contextEpoch: z.number().int().nonnegative(),
    createdAt: z.iso.datetime()
  })
  .strict()

const notebookAssistantMessageSchema = z
  .object({
    messageId: z.uuid(),
    role: z.literal('assistant'),
    content: z.string().max(NOTEBOOK_MAX_CHAT_BYTES),
    status: z.enum(['streaming', 'complete', 'stopped', 'failed']),
    citations: z.array(notebookChatCitationSchema).max(NOTEBOOK_MAX_CITATIONS),
    contextEpoch: z.number().int().nonnegative(),
    createdAt: z.iso.datetime()
  })
  .strict()
  .superRefine((message, context) => {
    const ordinals = new Set<number>()
    for (const citation of message.citations) {
      if (ordinals.has(citation.ordinal)) {
        context.addIssue({
          code: 'custom',
          path: ['citations'],
          message: 'Notebook citation ordinals must be unique'
        })
        return
      }
      ordinals.add(citation.ordinal)
    }
  })

const notebookSourceBoundaryMessageSchema = z
  .object({
    messageId: z.uuid(),
    role: z.literal('source_boundary'),
    content: z.literal('Sources changed'),
    contextEpoch: z.number().int().nonnegative(),
    createdAt: z.iso.datetime()
  })
  .strict()

export const notebookChatMessageSchema = z.discriminatedUnion('role', [
  notebookUserMessageSchema,
  notebookAssistantMessageSchema,
  notebookSourceBoundaryMessageSchema
])
export type NotebookChatMessage = z.infer<typeof notebookChatMessageSchema>

export const notebookChatSnapshotSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    revision: z.number().int().nonnegative(),
    phase: z.enum(['idle', 'thinking', 'retrieving', 'generating', 'stopping']),
    activeTurnId: z.uuid().nullable(),
    sourceScope: notebookSourceScopeSchema,
    sourceReadiness: z.enum(['preparing', 'ready', 'unavailable']),
    availableKnowledgeItemIds: z.array(z.uuid()).max(NOTEBOOK_MAX_SOURCES),
    modelSelection: agentModelSelectionSchema.nullable(),
    thinkingLevel: agentThinkingLevelSchema,
    contextEpoch: z.number().int().nonnegative(),
    messages: z.array(notebookChatMessageSchema).max(NOTEBOOK_MAX_MESSAGES),
    lastError: z.string().min(1).max(1_000).nullable()
  })
  .strict()
  .superRefine((snapshot, context) => {
    if ((snapshot.phase === 'idle') !== (snapshot.activeTurnId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['activeTurnId'],
        message: 'Notebook active turn does not match its phase'
      })
    }
    const bytes = new TextEncoder().encode(
      snapshot.messages.map((message) => message.content).join('')
    ).byteLength
    if (bytes > NOTEBOOK_MAX_CHAT_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['messages'],
        message: 'Notebook chat exceeds 2 MiB'
      })
    }
  })
export type NotebookChatSnapshot = z.infer<typeof notebookChatSnapshotSchema>

export const notebookChatSnapshotInputSchema = projectSessionInputSchema
export const notebookChatStartTurnInputSchema = projectSessionInputSchema
  .extend({ content: boundedQuestionSchema })
  .strict()
export const notebookChatStopTurnInputSchema = projectSessionInputSchema
export const notebookChatClearInputSchema = projectSessionInputSchema
export const notebookChatSetSourcesInputSchema = projectSessionInputSchema
  .extend({ sourceScope: notebookSourceScopeSchema })
  .strict()
export const notebookChatSetModelInputSchema = projectSessionInputSchema
  .extend({ modelSelection: agentModelSelectionSchema })
  .strict()
export const notebookChatSetThinkingLevelInputSchema = projectSessionInputSchema
  .extend({ level: agentThinkingLevelSchema })
  .strict()
export const notebookChatSubscribeInputSchema = projectSessionInputSchema
export const notebookChatUnsubscribeInputSchema = projectSessionInputSchema

export const notebookChatStartTurnResultSchema = z
  .object({ turnId: z.uuid(), snapshot: notebookChatSnapshotSchema })
  .strict()
export type NotebookChatStartTurnResult = z.infer<typeof notebookChatStartTurnResultSchema>

export const notebookChatCommandResultSchema = notebookChatSnapshotSchema

export const notebookChatSubscribeResultSchema = z
  .object({ snapshot: notebookChatSnapshotSchema })
  .strict()

const notebookChatSnapshotEventSchema = z
  .object({
    kind: z.literal('snapshot'),
    projectSessionId: projectSessionIdSchema,
    revision: z.number().int().nonnegative(),
    snapshot: notebookChatSnapshotSchema
  })
  .strict()

const notebookChatDeltaEventSchema = z
  .object({
    kind: z.literal('delta'),
    projectSessionId: projectSessionIdSchema,
    revision: z.number().int().nonnegative(),
    turnId: z.uuid(),
    messageId: z.uuid(),
    delta: z.string().min(1).max(65_536)
  })
  .strict()

export const notebookChatEventSchema = z.discriminatedUnion('kind', [
  notebookChatSnapshotEventSchema,
  notebookChatDeltaEventSchema
])
export type NotebookChatEvent = z.infer<typeof notebookChatEventSchema>
