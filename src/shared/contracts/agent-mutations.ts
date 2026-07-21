import { z } from 'zod'
import { agentModelRequestIdSchema, agentRunIdSchema, agentSessionIdSchema } from './agent'
import {
  blockNoteBlockSchema,
  manuscriptBriefFieldsSchema,
  manuscriptIdSchema,
  sectionIdSchema,
  sectionRevisionIdSchema,
  sectionStatusSchema
} from './manuscript'
import { projectSessionIdSchema } from './projects'

export const AGENT_MUTATION_SCHEMA_VERSION = 1
export const AGENT_MUTATION_OPERATION_LIMIT = 50
export const AGENT_MUTATION_BLOCK_LIMIT = 100
export const AGENT_MUTATION_CITATION_LIMIT = 20
export const AGENT_MUTATION_PREVIEW_TEXT_LIMIT = 32_768

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()
const uniqueStrings = <T extends z.ZodType<string>>(schema: T, maximum: number) =>
  z
    .array(schema)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, 'Values must be unique')

export const mutationCitationIdSchema = z.string().regex(/^citation-[a-f0-9]{40}$/)
export const mutationCitationIdsSchema = uniqueStrings(
  mutationCitationIdSchema,
  AGENT_MUTATION_CITATION_LIMIT
).default([])

const briefChangesSchema = manuscriptBriefFieldsSchema
  .partial()
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, 'At least one brief field must change')

export const briefUpdateSchema = strictObject({
  schemaVersion: z.literal(AGENT_MUTATION_SCHEMA_VERSION).default(AGENT_MUTATION_SCHEMA_VERSION),
  manuscriptId: manuscriptIdSchema,
  baseBriefVersion: z.number().int().positive(),
  changes: briefChangesSchema,
  citationIds: mutationCitationIdsSchema
})

const createOutlineSectionSchema = strictObject({
  type: z.literal('createSection'),
  sectionId: z.uuid(),
  parentSectionId: sectionIdSchema.nullable(),
  position: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(500),
  objective: z.string().max(32_000).nullable(),
  status: sectionStatusSchema
})

const updateOutlineSectionSchema = strictObject({
  type: z.literal('updateSection'),
  sectionId: sectionIdSchema,
  title: z.string().trim().min(1).max(500).optional(),
  objective: z.string().max(32_000).nullable().optional(),
  status: sectionStatusSchema.optional()
}).refine(
  ({ title, objective, status }) =>
    title !== undefined || objective !== undefined || status !== undefined,
  'At least one section field must change'
)

const moveOutlineSectionSchema = strictObject({
  type: z.literal('moveSection'),
  sectionId: sectionIdSchema,
  parentSectionId: sectionIdSchema.nullable(),
  position: z.number().int().nonnegative()
})

const deleteOutlineSectionSchema = strictObject({
  type: z.literal('deleteSection'),
  sectionId: sectionIdSchema
})

export const outlineMutationOperationSchema = z.discriminatedUnion('type', [
  createOutlineSectionSchema,
  updateOutlineSectionSchema,
  moveOutlineSectionSchema,
  deleteOutlineSectionSchema
])

export const outlinePatchSchema = strictObject({
  schemaVersion: z.literal(AGENT_MUTATION_SCHEMA_VERSION).default(AGENT_MUTATION_SCHEMA_VERSION),
  manuscriptId: manuscriptIdSchema,
  baseOutlineVersion: z.number().int().positive(),
  operations: z.array(outlineMutationOperationSchema).min(1).max(AGENT_MUTATION_OPERATION_LIMIT),
  citationIds: mutationCitationIdsSchema
})

const blockUpdateSchema = strictObject({
  type: z
    .enum([
      'paragraph',
      'heading',
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'quote',
      'codeBlock',
      'table'
    ])
    .optional(),
  props: z.record(z.string().min(1).max(100), z.unknown()).optional(),
  content: z.unknown().optional(),
  children: z.array(blockNoteBlockSchema).max(AGENT_MUTATION_BLOCK_LIMIT).optional()
}).refine((update) => Object.keys(update).length > 0, 'At least one block field must change')

const insertBlocksSchema = strictObject({
  type: z.literal('insertBlocks'),
  anchorBlockId: z.string().min(1).max(256).nullable(),
  placement: z.enum(['before', 'after', 'start', 'end']),
  blocks: z.array(blockNoteBlockSchema).min(1).max(AGENT_MUTATION_BLOCK_LIMIT)
}).refine(
  ({ anchorBlockId, placement }) =>
    anchorBlockId === null
      ? placement === 'start' || placement === 'end'
      : placement === 'before' || placement === 'after',
  'Placement does not match the anchor'
)

const updateBlockSchema = strictObject({
  type: z.literal('updateBlock'),
  blockId: z.string().min(1).max(256),
  update: blockUpdateSchema
})

const removeBlocksSchema = strictObject({
  type: z.literal('removeBlocks'),
  blockIds: uniqueStrings(z.string().min(1).max(256), AGENT_MUTATION_BLOCK_LIMIT).min(1)
})

const replaceBlocksSchema = strictObject({
  type: z.literal('replaceBlocks'),
  blockIds: uniqueStrings(z.string().min(1).max(256), AGENT_MUTATION_BLOCK_LIMIT).min(1),
  blocks: z.array(blockNoteBlockSchema).max(AGENT_MUTATION_BLOCK_LIMIT)
})

const moveBlocksSchema = strictObject({
  type: z.literal('moveBlocks'),
  blockIds: uniqueStrings(z.string().min(1).max(256), AGENT_MUTATION_BLOCK_LIMIT).min(1),
  anchorBlockId: z.string().min(1).max(256),
  placement: z.enum(['before', 'after'])
})

export const blockMutationOperationSchema = z.discriminatedUnion('type', [
  insertBlocksSchema,
  updateBlockSchema,
  removeBlocksSchema,
  replaceBlocksSchema,
  moveBlocksSchema
])

export const sectionPatchSchema = strictObject({
  schemaVersion: z.literal(AGENT_MUTATION_SCHEMA_VERSION).default(AGENT_MUTATION_SCHEMA_VERSION),
  sectionId: sectionIdSchema,
  baseRevisionId: sectionRevisionIdSchema,
  operations: z.array(blockMutationOperationSchema).min(1).max(AGENT_MUTATION_OPERATION_LIMIT),
  citationIds: mutationCitationIdsSchema
})

export const mutationProposalKindSchema = z.enum(['brief_update', 'outline_patch', 'section_patch'])

export const agentProposalToolNameSchema = z.enum([
  'propose_brief_update',
  'propose_outline_patch',
  'propose_section_patch'
])

export const mutationCitedSourceSchema = strictObject({
  citationId: mutationCitationIdSchema,
  knowledgeItemId: z.uuid(),
  parseRevisionId: z.uuid(),
  chunkId: z.string().regex(/^chunk-[a-f0-9]{40}$/),
  sourceBlockIds: z.array(z.string().min(1).max(100)).max(1_000)
})

export const mutationPreviewSchema = strictObject({
  summary: z.string().min(1).max(2_000),
  affectedSectionIds: uniqueStrings(sectionIdSchema, AGENT_MUTATION_OPERATION_LIMIT),
  beforeText: z.string().max(AGENT_MUTATION_PREVIEW_TEXT_LIMIT),
  afterText: z.string().max(AGENT_MUTATION_PREVIEW_TEXT_LIMIT),
  beforeTextTruncated: z.boolean(),
  afterTextTruncated: z.boolean(),
  citedSources: z.array(mutationCitedSourceSchema).max(AGENT_MUTATION_CITATION_LIMIT)
})

export const mutationProposalToolResultSchema = strictObject({
  proposalId: z.uuid(),
  kind: mutationProposalKindSchema,
  status: z.literal('pending'),
  preview: mutationPreviewSchema
})

const proposalProvenanceSchema = strictObject({
  modelRequestId: agentModelRequestIdSchema,
  citedSources: z.array(mutationCitedSourceSchema).max(AGENT_MUTATION_CITATION_LIMIT)
})

export const persistedMutationProposalPayloadSchema = z.discriminatedUnion('kind', [
  strictObject({
    schemaVersion: z.literal(AGENT_MUTATION_SCHEMA_VERSION),
    kind: z.literal('brief_update'),
    mutation: briefUpdateSchema,
    preview: mutationPreviewSchema,
    provenance: proposalProvenanceSchema
  }),
  strictObject({
    schemaVersion: z.literal(AGENT_MUTATION_SCHEMA_VERSION),
    kind: z.literal('outline_patch'),
    mutation: outlinePatchSchema,
    preview: mutationPreviewSchema,
    provenance: proposalProvenanceSchema
  }),
  strictObject({
    schemaVersion: z.literal(AGENT_MUTATION_SCHEMA_VERSION),
    kind: z.literal('section_patch'),
    mutation: sectionPatchSchema,
    preview: mutationPreviewSchema,
    provenance: proposalProvenanceSchema
  })
])

export const mutationProposalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'applied',
  'failed',
  'undone'
])

export const mutationProposalRecordSchema = strictObject({
  proposalId: z.uuid(),
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  agentToolCallId: z.string().min(1).max(256),
  kind: mutationProposalKindSchema,
  payload: persistedMutationProposalPayloadSchema,
  status: mutationProposalStatusSchema,
  decisionAt: z.iso.datetime().nullable(),
  appliedRevisionId: sectionRevisionIdSchema.nullable(),
  appliedBriefVersion: z.number().int().positive().nullable(),
  appliedOutlineVersion: z.number().int().positive().nullable(),
  undoRevisionId: sectionRevisionIdSchema.nullable(),
  rejectedReason: z.string().max(4_096).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

const proposalActionBase = {
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  proposalId: z.uuid()
}

export const approveMutationProposalInputSchema = strictObject(proposalActionBase)
export const rejectMutationProposalInputSchema = strictObject({
  ...proposalActionBase,
  reason: z.string().trim().min(1).max(4_096)
})
export const undoMutationProposalInputSchema = strictObject(proposalActionBase)

export const mutationSectionChangedSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  proposalId: z.uuid(),
  sectionId: sectionIdSchema,
  sectionRevisionId: sectionRevisionIdSchema,
  reason: z.enum(['applied', 'undone'])
})

export const mutationProposalActionResultSchema = strictObject({
  proposal: mutationProposalRecordSchema,
  sectionChanged: mutationSectionChangedSchema.nullable()
})

export const mutationSubscriptionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  subscriptionId: z.uuid()
})

export type BriefUpdate = z.infer<typeof briefUpdateSchema>
export type OutlinePatch = z.infer<typeof outlinePatchSchema>
export type OutlineMutationOperation = z.infer<typeof outlineMutationOperationSchema>
export type SectionPatch = z.infer<typeof sectionPatchSchema>
export type BlockMutationOperation = z.infer<typeof blockMutationOperationSchema>
export type MutationProposalKind = z.infer<typeof mutationProposalKindSchema>
export type AgentProposalToolName = z.infer<typeof agentProposalToolNameSchema>
export type MutationCitedSource = z.infer<typeof mutationCitedSourceSchema>
export type MutationPreview = z.infer<typeof mutationPreviewSchema>
export type MutationProposalToolResult = z.infer<typeof mutationProposalToolResultSchema>
export type PersistedMutationProposalPayload = z.infer<
  typeof persistedMutationProposalPayloadSchema
>
export type MutationProposalRecord = z.infer<typeof mutationProposalRecordSchema>
export type MutationSectionChanged = z.infer<typeof mutationSectionChangedSchema>
export type MutationProposalActionResult = z.infer<typeof mutationProposalActionResultSchema>
