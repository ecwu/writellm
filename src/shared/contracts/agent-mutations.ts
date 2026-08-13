import { z } from 'zod'
import { agentModelRequestIdSchema, agentRunIdSchema, agentSessionIdSchema } from './agent'
import {
  blockNoteBlockSchema,
  manuscriptAssetIdSchema,
  manuscriptBriefFieldsSchema,
  manuscriptIdSchema,
  sectionIdSchema,
  sectionRevisionIdSchema,
  sectionStatusSchema
} from './manuscript'
import { projectSessionIdSchema } from './projects'
import { writingTaskIdSchema, writingTaskStepIdSchema } from './writing-task'
import { resolvesReviewIssueSchema } from './review'
import { modelSubmitWritingRulesChangeArgsSchema } from './writing-rules'

export const AGENT_MUTATION_SCHEMA_VERSION = 1
export const AGENT_TOOL_CONTRACT_VERSION = 7
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

const modelBriefChangesSchema = manuscriptBriefFieldsSchema
  .omit({ extensible: true })
  .partial()
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, 'At least one brief field must change')

const resolvesReviewIssuesSchema = z.array(resolvesReviewIssueSchema).max(20).optional()

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

export const mutationProposalKindSchema = z.enum([
  'brief_update',
  'outline_patch',
  'section_patch',
  'generated_image_insert'
])

export const agentProposalToolNameSchema = z.enum([
  'submit_brief_change',
  'submit_writing_rules_change',
  'submit_outline_change',
  'submit_section_change',
  'generate_image'
])

const sectionRefSchema = z.discriminatedUnion('kind', [
  strictObject({ kind: z.literal('existing'), sectionId: sectionIdSchema }),
  strictObject({ kind: z.literal('created'), clientRef: z.string().min(1).max(256) })
])
const outlinePlacementSchema = z.discriminatedUnion('kind', [
  strictObject({ kind: z.literal('first') }),
  strictObject({ kind: z.literal('last') }),
  strictObject({ kind: z.literal('before'), anchor: sectionRefSchema }),
  strictObject({ kind: z.literal('after'), anchor: sectionRefSchema })
])

export const modelSubmitBriefChangeArgsSchema = strictObject({
  changes: modelBriefChangesSchema,
  citationIds: mutationCitationIdsSchema,
  resolvesReviewIssues: resolvesReviewIssuesSchema
})

export const modelSubmitWritingRulesChangeWithReviewArgsSchema =
  modelSubmitWritingRulesChangeArgsSchema.extend({
    citationIds: mutationCitationIdsSchema,
    resolvesReviewIssues: resolvesReviewIssuesSchema
  })

const modelOutlineOperationSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('createSection'),
    clientRef: z.string().min(1).max(256),
    parent: sectionRefSchema.nullable(),
    placement: outlinePlacementSchema,
    title: z.string().trim().min(1).max(500),
    objective: z.string().max(32_000).nullable(),
    status: sectionStatusSchema
  }),
  strictObject({
    type: z.literal('updateSection'),
    section: sectionRefSchema,
    title: z.string().trim().min(1).max(500).optional(),
    objective: z.string().max(32_000).nullable().optional(),
    status: sectionStatusSchema.optional()
  }).refine(
    ({ title, objective, status }) =>
      title !== undefined || objective !== undefined || status !== undefined,
    'At least one section field must change'
  ),
  strictObject({
    type: z.literal('moveSection'),
    section: sectionRefSchema,
    parent: sectionRefSchema.nullable(),
    placement: outlinePlacementSchema
  }),
  strictObject({ type: z.literal('deleteSection'), section: sectionRefSchema })
])

export const modelSubmitOutlineChangeArgsSchema = strictObject({
  operations: z.array(modelOutlineOperationSchema).min(1).max(AGENT_MUTATION_OPERATION_LIMIT),
  citationIds: mutationCitationIdsSchema,
  resolvesReviewIssues: resolvesReviewIssuesSchema
})

const blockPreconditionSchema = strictObject({
  blockId: z.string().min(1).max(256),
  expectedBlockHash: z.string().regex(/^[a-f0-9]{64}$/u)
})
const generateImageIterationSchema = strictObject({
  sourceBlock: blockPreconditionSchema,
  disposition: z.enum(['replace', 'insert_after'])
})
export const generateImageArgsSchema = strictObject({
  sectionId: sectionIdSchema,
  anchor: blockPreconditionSchema.nullable(),
  placement: z.enum(['before', 'after', 'start', 'end']),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(16_384)
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= 16_384,
      'Image prompt exceeds 16 KiB'
    ),
  altText: z.string().trim().min(1).max(2_000),
  caption: z.string().max(2_000),
  aspectRatio: z.enum(['auto', '1:1', '16:9']),
  imageSize: z.enum(['1K', '2K']),
  iteration: generateImageIterationSchema.optional(),
  resolvesReviewIssues: resolvesReviewIssuesSchema
}).refine(
  ({ anchor, placement }) =>
    anchor === null
      ? placement === 'start' || placement === 'end'
      : placement === 'before' || placement === 'after',
  'Placement does not match the anchor'
)
const textBlockTypeSchema = z.enum([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'codeBlock'
])
const modelSectionOperationSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('replaceBlockText'),
    target: blockPreconditionSchema,
    text: z.string().max(100_000)
  }),
  strictObject({
    type: z.literal('insertTextBlocks'),
    anchor: blockPreconditionSchema.nullable(),
    placement: z.enum(['before', 'after', 'start', 'end']),
    blocks: z
      .array(
        strictObject({
          clientRef: z.string().min(1).max(256).optional(),
          blockType: textBlockTypeSchema.default('paragraph'),
          text: z.string().max(100_000)
        })
      )
      .min(1)
      .max(AGENT_MUTATION_BLOCK_LIMIT)
  }),
  strictObject({
    type: z.literal('insertRichBlock'),
    anchor: blockPreconditionSchema.nullable(),
    placement: z.enum(['before', 'after', 'start', 'end']),
    block: strictObject({
      clientRef: z.string().min(1).max(256).optional(),
      blockType: z.enum(['mermaid', 'math']),
      source: z.string().min(1).max(64_000),
      caption: z.string().max(2_000).default(''),
      textAlignment: z.enum(['left', 'center', 'right', 'justify']).default('center'),
      previewWidth: z.number().int().min(64).max(8_192).default(720)
    })
  }),
  strictObject({
    type: z.literal('removeBlocks'),
    targets: z.array(blockPreconditionSchema).min(1).max(AGENT_MUTATION_BLOCK_LIMIT)
  }),
  strictObject({
    type: z.literal('moveBlocks'),
    targets: z.array(blockPreconditionSchema).min(1).max(AGENT_MUTATION_BLOCK_LIMIT),
    anchor: blockPreconditionSchema,
    placement: z.enum(['before', 'after'])
  }),
  strictObject({
    type: z.literal('replaceCanonicalBlock'),
    target: blockPreconditionSchema,
    block: blockNoteBlockSchema
  })
])

export const modelSubmitSectionChangeArgsSchema = strictObject({
  sectionId: sectionIdSchema,
  operations: z.array(modelSectionOperationSchema).min(1).max(AGENT_MUTATION_OPERATION_LIMIT),
  citationIds: mutationCitationIdsSchema,
  resolvesReviewIssues: resolvesReviewIssuesSchema
})

export const mutationCitedSourceSchema = strictObject({
  evidenceSchemaVersion: z.literal(2).optional(),
  citationId: mutationCitationIdSchema,
  knowledgeItemId: z.uuid(),
  parseRevisionId: z.uuid(),
  chunkId: z.string().regex(/^chunk-[a-f0-9]{40}$/),
  sourceBlockIds: z.array(z.string().min(1).max(100)).max(1_000),
  excerpt: z.string().max(8_192).optional(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  retrievedAt: z.iso.datetime().optional()
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
  preview: mutationPreviewSchema,
  createdSectionRefs: z.record(z.string().min(1).max(256), z.uuid()).optional(),
  createdBlockRefs: z.record(z.string().min(1).max(256), z.string().min(1).max(256)).optional()
})

export const mutationProposalOutcomeSchema = strictObject({
  outcome: z.enum(['pending_review', 'applied', 'rejected', 'conflict', 'already_satisfied']),
  proposalId: z.uuid(),
  effectiveProposalId: z.uuid(),
  kind: mutationProposalKindSchema,
  message: z.string().min(1).max(4_096).nullable()
})

export const submitChangeResultSchema = strictObject({
  proposal: strictObject({
    proposalId: z.uuid(),
    kind: mutationProposalKindSchema,
    status: z.enum([
      'pending',
      'generating',
      'approved',
      'rejected',
      'applied',
      'failed',
      'undone',
      'superseded',
      'conflicted',
      'satisfied'
    ])
  }),
  application: strictObject({
    status: z.enum(['not_applied', 'applied', 'conflict', 'no_change']),
    resultingBriefVersion: z.number().int().positive().optional(),
    resultingOutlineVersion: z.number().int().positive().optional(),
    resultingRevisionId: z.uuid().optional(),
    createdSectionRefs: z.record(z.string().min(1).max(256), z.uuid()).optional(),
    createdBlockRefs: z.record(z.string().min(1).max(256), z.string().min(1).max(256)).optional()
  }),
  continuation: z.enum(['continue', 'pause_for_review', 'finish']),
  warnings: z
    .array(strictObject({ code: z.string().min(1).max(100), message: z.string().max(1_000) }))
    .max(20)
})

const proposalProvenanceSchema = strictObject({
  modelRequestId: agentModelRequestIdSchema,
  citedSources: z.array(mutationCitedSourceSchema).max(AGENT_MUTATION_CITATION_LIMIT),
  resolvesReviewIssues: z.array(resolvesReviewIssueSchema).max(20).optional(),
  createdSectionRefs: z.record(z.string().min(1).max(256), z.uuid()).optional(),
  createdBlockRefs: z.record(z.string().min(1).max(256), z.string().min(1).max(256)).optional()
})

const generatedImageMutationSchema = strictObject({
  schemaVersion: z.literal(1),
  sectionId: sectionIdSchema,
  baseRevisionId: sectionRevisionIdSchema,
  anchor: blockPreconditionSchema.nullable(),
  placement: z.enum(['before', 'after', 'start', 'end']),
  prompt: z.string().min(1).max(16_384),
  altText: z.string().min(1).max(2_000),
  caption: z.string().max(2_000),
  aspectRatio: z.enum(['auto', '1:1', '16:9']),
  imageSize: z.enum(['1K', '2K']),
  iteration: strictObject({
    sourceBlock: blockPreconditionSchema,
    disposition: z.enum(['replace', 'insert_after']),
    parentAssetId: manuscriptAssetIdSchema
  })
    .nullable()
    .default(null),
  assetId: z.uuid().nullable(),
  imageModelRequestId: z.uuid().nullable()
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
  }),
  strictObject({
    schemaVersion: z.literal(AGENT_MUTATION_SCHEMA_VERSION),
    kind: z.literal('generated_image_insert'),
    mutation: generatedImageMutationSchema,
    preview: mutationPreviewSchema,
    provenance: proposalProvenanceSchema
  })
])

export const mutationProposalStatusSchema = z.enum([
  'pending',
  'generating',
  'approved',
  'rejected',
  'applied',
  'failed',
  'undone',
  'superseded',
  'conflicted',
  'satisfied'
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
  replacesProposalId: z.uuid().nullable(),
  rejectedReason: z.string().max(4_096).nullable(),
  writingTaskId: writingTaskIdSchema.nullable().default(null),
  writingTaskStepId: writingTaskStepIdSchema.nullable().default(null),
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
  reason: z.string().trim().min(1).max(4_096),
  continueRequested: z.boolean().default(false)
})
export const undoMutationProposalInputSchema = strictObject(proposalActionBase)
export const cancelImageGenerationInputSchema = strictObject(proposalActionBase)
export const cancelImageGenerationResultSchema = strictObject({ cancelled: z.boolean() })

export const mutationSectionChangedSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  proposalId: z.uuid(),
  sectionId: sectionIdSchema,
  sectionRevisionId: sectionRevisionIdSchema,
  reason: z.enum(['applied', 'undone'])
})

export const mutationProposalChangedSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  proposalId: z.uuid(),
  kind: mutationProposalKindSchema,
  status: mutationProposalStatusSchema,
  sectionChanged: mutationSectionChangedSchema.nullable()
})

export const mutationProposalActionResultSchema = strictObject({
  proposal: mutationProposalRecordSchema,
  sectionChanged: mutationSectionChangedSchema.nullable(),
  warnings: z.array(z.string().min(1).max(1_000)).max(20).default([])
})

const mutationProposalConflictSchema = strictObject({
  code: z.enum([
    'target_missing',
    'target_changed',
    'structure_changed',
    'id_collision',
    'base_unavailable',
    'invalid_result'
  ]),
  message: z.string().min(1).max(4_096)
})

export const approveMutationProposalResultSchema = z.discriminatedUnion('outcome', [
  strictObject({
    outcome: z.literal('applied'),
    proposal: mutationProposalRecordSchema,
    sectionChanged: mutationSectionChangedSchema.nullable(),
    warnings: z.array(z.string().min(1).max(1_000)).max(20).default([])
  }),
  strictObject({
    outcome: z.literal('refresh_required'),
    previousProposal: mutationProposalRecordSchema,
    proposal: mutationProposalRecordSchema,
    sectionChanged: z.null(),
    warnings: z.array(z.string().min(1).max(1_000)).max(20).default([])
  }),
  strictObject({
    outcome: z.literal('conflict'),
    proposal: mutationProposalRecordSchema,
    conflict: mutationProposalConflictSchema,
    sectionChanged: z.null(),
    warnings: z.array(z.string().min(1).max(1_000)).max(20).default([])
  }),
  strictObject({
    outcome: z.literal('already_satisfied'),
    proposal: mutationProposalRecordSchema,
    sectionChanged: z.null(),
    warnings: z.array(z.string().min(1).max(1_000)).max(20).default([])
  })
])

export const mutationSubscriptionInputSchema = strictObject({
  projectSessionId: projectSessionIdSchema,
  subscriptionId: z.uuid()
})

export type BriefUpdate = z.infer<typeof briefUpdateSchema>
export type OutlinePatch = z.infer<typeof outlinePatchSchema>
export type OutlineMutationOperation = z.infer<typeof outlineMutationOperationSchema>
export type SectionPatch = z.infer<typeof sectionPatchSchema>
export type GenerateImageArgs = z.infer<typeof generateImageArgsSchema>
export type BlockMutationOperation = z.infer<typeof blockMutationOperationSchema>
export type MutationProposalKind = z.infer<typeof mutationProposalKindSchema>
export type AgentProposalToolName = z.infer<typeof agentProposalToolNameSchema>
export type MutationCitedSource = z.infer<typeof mutationCitedSourceSchema>
export type MutationPreview = z.infer<typeof mutationPreviewSchema>
export type MutationProposalToolResult = z.infer<typeof mutationProposalToolResultSchema>
export type MutationProposalOutcome = z.infer<typeof mutationProposalOutcomeSchema>
export type SubmitChangeResult = z.infer<typeof submitChangeResultSchema>
export type PersistedMutationProposalPayload = z.infer<
  typeof persistedMutationProposalPayloadSchema
>
export type MutationProposalRecord = z.infer<typeof mutationProposalRecordSchema>
export type MutationSectionChanged = z.infer<typeof mutationSectionChangedSchema>
export type MutationProposalChanged = z.infer<typeof mutationProposalChangedSchema>
export type MutationProposalActionResult = z.infer<typeof mutationProposalActionResultSchema>
export type ApproveMutationProposalResult = z.infer<typeof approveMutationProposalResultSchema>
