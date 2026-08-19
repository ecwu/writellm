import { z } from 'zod'
import {
  AGENT_TOOL_CONTRACT_VERSION,
  type agentProposalToolNameSchema,
  generateImageArgsSchema,
  modelSubmitBriefChangeArgsSchema,
  modelSubmitOutlineChangeArgsSchema,
  modelSubmitSectionChangeArgsSchema,
  modelSubmitWritingRulesChangeWithReviewArgsSchema,
  mutationProposalRecordSchema,
  submitChangeResultSchema
} from './agent-mutations'
import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from './knowledge'
import { projectSessionIdSchema } from './projects'
import { agentModelRequestIdSchema, agentRunIdSchema, agentSessionIdSchema } from './agent'
import { SKILL_MAX_PROGRESSIVE_REFERENCE_BYTES } from './skills'
import {
  listReviewIssuesArgsSchema,
  listReviewIssuesResultSchema,
  recordReviewIssuesArgsSchema,
  recordReviewIssuesResultSchema,
  reviewIssueCategorySchema,
  reviewPrioritySchema,
  updateReviewIssuesArgsSchema,
  updateReviewIssuesResultSchema
} from './review'
import {
  createWritingTaskArgsSchema,
  createWritingTaskResultSchema,
  getWritingTaskArgsSchema,
  getWritingTaskResultSchema,
  updateWritingTaskArgsSchema,
  updateWritingTaskResultSchema
} from './writing-task'

export const AGENT_TOOL_ARGUMENT_BYTES = 65_536
export const AGENT_TOOL_RESULT_BYTES = 262_144
export const AGENT_SECTION_PAGE_LIMIT = 50
export const AGENT_KNOWLEDGE_RESULT_LIMIT = 20
export const AGENT_CITATION_RESULT_LIMIT = 10
export const AGENT_TOOL_RESULT_SCHEMA_VERSION = 2

export const toolResultMetaSchema = z
  .object({
    contractVersion: z.union([
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8)
    ]),
    toolName: z.string().min(1).max(256),
    toolCallId: z.string().min(1).max(256),
    modelRequestId: agentModelRequestIdSchema
  })
  .strict()

export const agentReadToolNameSchema = z.enum([
  'get_writing_context',
  'read_outline',
  'read_section',
  'search_manuscript',
  'search_knowledge',
  'read_citations',
  'check_draft'
])

export const agentToolNameSchema = z.enum([
  'get_writing_context',
  'read_outline',
  'read_section',
  'search_manuscript',
  'search_knowledge',
  'read_citations',
  'read_writing_skill',
  'inspect_change',
  'check_draft',
  'list_review_issues',
  'record_review_issues',
  'update_review_issues',
  'get_writing_task',
  'create_writing_task',
  'update_writing_task',
  'submit_brief_change',
  'submit_writing_rules_change',
  'submit_outline_change',
  'submit_section_change',
  'generate_image'
])

export const legacyAgentToolNameSchema = z.enum([
  'propose_brief_update',
  'propose_outline_patch',
  'propose_section_patch'
])

export const persistedAgentToolNameSchema = z.union([
  agentToolNameSchema,
  legacyAgentToolNameSchema
])

export const AGENT_TOOL_DESCRIPTORS = {
  get_writing_context: descriptor('parallel', 'manuscript', 5_000, false),
  read_outline: descriptor('parallel', 'outline', 5_000, false),
  read_section: descriptor('parallel', 'section', 5_000, false),
  search_manuscript: descriptor('parallel', 'manuscript', 5_000, false),
  search_knowledge: descriptor('parallel', 'knowledge', 30_000, true),
  read_citations: descriptor('parallel', 'knowledge', 10_000, false),
  read_writing_skill: descriptor('parallel', 'skill', 5_000, false),
  inspect_change: descriptor('parallel', 'proposal', 5_000, false),
  check_draft: descriptor('parallel', 'manuscript', 30_000, true),
  list_review_issues: descriptor('parallel', 'review', 5_000, false),
  record_review_issues: fixtureMutationDescriptor(10_000),
  update_review_issues: fixtureMutationDescriptor(10_000),
  get_writing_task: descriptor('parallel', 'task', 5_000, false),
  create_writing_task: fixtureMutationDescriptor(10_000, 'task'),
  update_writing_task: fixtureMutationDescriptor(10_000, 'task'),
  submit_brief_change: descriptor('sequential', 'brief', 10_000, true),
  submit_writing_rules_change: descriptor('sequential', 'brief', 10_000, true),
  submit_outline_change: descriptor('sequential', 'outline', 10_000, true),
  submit_section_change: descriptor('sequential', 'section', 10_000, true),
  generate_image: {
    contractVersion: AGENT_TOOL_CONTRACT_VERSION as 8,
    effects: ['proposal', 'mutation'],
    executionMode: 'sequential',
    consistency: 'snapshot',
    lockScope: 'section',
    deadlineMs: 300_000,
    supportsProgress: true,
    maxOutputBytes: AGENT_TOOL_RESULT_BYTES
  }
} as const satisfies Record<
  z.infer<typeof agentToolNameSchema>,
  {
    contractVersion: 2 | 3 | 4 | 5 | 6 | 7 | 8
    effects: readonly ('read' | 'proposal' | 'mutation')[]
    executionMode: 'parallel' | 'sequential'
    consistency: 'snapshot'
    lockScope:
      | 'manuscript'
      | 'brief'
      | 'outline'
      | 'section'
      | 'knowledge'
      | 'proposal'
      | 'skill'
      | 'review'
      | 'task'
    deadlineMs: number
    supportsProgress: boolean
    maxOutputBytes: number
  }
>

function descriptor(
  executionMode: 'parallel' | 'sequential',
  lockScope:
    | 'manuscript'
    | 'brief'
    | 'outline'
    | 'section'
    | 'knowledge'
    | 'proposal'
    | 'skill'
    | 'review'
    | 'task',
  deadlineMs: number,
  supportsProgress: boolean
) {
  return {
    contractVersion: AGENT_TOOL_CONTRACT_VERSION as 8,
    effects:
      executionMode === 'parallel' ? (['read'] as const) : (['proposal', 'mutation'] as const),
    executionMode,
    consistency: 'snapshot' as const,
    lockScope,
    deadlineMs,
    supportsProgress,
    maxOutputBytes: AGENT_TOOL_RESULT_BYTES
  }
}

function fixtureMutationDescriptor(deadlineMs: number, lockScope: 'review' | 'task' = 'review') {
  return {
    contractVersion: AGENT_TOOL_CONTRACT_VERSION as 8,
    effects: ['mutation'] as const,
    executionMode: 'sequential' as const,
    consistency: 'snapshot' as const,
    lockScope,
    deadlineMs,
    supportsProgress: false,
    maxOutputBytes: AGENT_TOOL_RESULT_BYTES
  }
}

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const readWritingSkillArgsSchema = strictObject({
  uri: z
    .string()
    .min(1)
    .max(2_048)
    .startsWith('writellm://skills/')
    .describe('Copy the exact writellm:// URI from the run Skill snapshot or prior Skill result.')
})

const writingSkillReferenceDescriptorSchema = strictObject({
  skillId: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  relativePath: z.string().min(1).max(1_024),
  uri: z.string().min(1).max(2_048).startsWith('writellm://skills/'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().positive().max(SKILL_MAX_PROGRESSIVE_REFERENCE_BYTES)
})

const writingSkillDependencyResultSchema = strictObject({
  skillId: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  relativePath: z.literal('SKILL.md'),
  uri: z.string().min(1).max(2_048).startsWith('writellm://skills/'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().positive().max(65_536)
})

export const readWritingSkillResultSchema = strictObject({
  skillId: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  relativePath: z.string().min(1).max(1_024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().positive().max(65_536),
  content: z.string().max(65_536),
  references: z.array(writingSkillReferenceDescriptorSchema).max(31).default([]),
  dependencies: z.array(writingSkillDependencyResultSchema).max(8).default([])
})

export const getWritingContextArgsSchema = strictObject({
  includeBrief: z.boolean().default(true),
  includeOutline: z.boolean().default(true),
  activeSectionId: z
    .uuid()
    .optional()
    .describe('Use an exact sectionId from the current editor context when overriding selection.')
})

export const readOutlineArgsSchema = strictObject({
  rootSectionId: z
    .uuid()
    .optional()
    .describe('Copy read_outline.sections[].sectionId when reading a subtree.'),
  maxDepth: z.number().int().min(1).max(64).default(8),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Copy read_outline.nextCursor exactly; omit to restart.'),
  limit: z.number().int().min(1).max(100).default(50)
})

const readSectionIdSchema = z
  .uuid()
  .describe('Copy a sectionId from get_writing_context or read_outline in this run.')
const readSectionBlockIdSchema = z
  .string()
  .min(1)
  .max(256)
  .describe('Copy read_section.blocks[].blockId exactly.')
const readSectionSummaryArgsSchema = strictObject({
  sectionId: readSectionIdSchema,
  view: z.literal('summary').default('summary'),
  blockIds: z.array(readSectionBlockIdSchema).max(100).optional(),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Copy read_section.nextCursor exactly; omit to restart.'),
  limit: z.number().int().min(1).max(AGENT_SECTION_PAGE_LIMIT).default(20)
}).refine((value) => value.blockIds === undefined || value.cursor === undefined, {
  message: 'blockIds and cursor cannot be combined'
})
const readSectionCanonicalArgsSchema = strictObject({
  sectionId: readSectionIdSchema,
  view: z.literal('canonical'),
  blockId: readSectionBlockIdSchema
})
const readSectionFragmentArgsSchema = strictObject({
  sectionId: readSectionIdSchema,
  view: z.literal('fragment'),
  blockId: readSectionBlockIdSchema,
  offset: z.number().int().nonnegative().default(0),
  maxChars: z.number().int().min(256).max(65_536).default(16_384)
})
export const readSectionArgsSchema = z.union([
  readSectionSummaryArgsSchema,
  readSectionCanonicalArgsSchema,
  readSectionFragmentArgsSchema
])

export const searchKnowledgeArgsSchema = strictObject({
  query: z.string().trim().min(1).max(2_000),
  knowledgeItemIds: z.array(z.uuid()).max(20).default([]),
  fileExtensions: z.array(z.enum(SUPPORTED_KNOWLEDGE_EXTENSIONS)).max(10).default([]),
  parseRevisionIds: z.array(z.uuid()).max(20).default([]),
  pageFrom: z.number().int().nonnegative().optional().describe('Zero-based first source page.'),
  pageTo: z.number().int().nonnegative().optional().describe('Zero-based last source page.'),
  heading: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(AGENT_KNOWLEDGE_RESULT_LIMIT).default(10),
  rerank: z.boolean().default(true)
}).superRefine((value, context) => {
  if (value.pageFrom !== undefined && value.pageTo !== undefined && value.pageFrom > value.pageTo) {
    context.addIssue({
      code: 'custom',
      path: ['pageTo'],
      message: `Expected pageFrom <= pageTo, received pageFrom=${value.pageFrom} and pageTo=${value.pageTo}. Correct the range and retry search_knowledge once.`
    })
  }
})

export const readCitationsArgsSchema = strictObject({
  citationIds: z
    .array(z.string().regex(/^citation-[a-f0-9]{40}$/))
    .max(AGENT_CITATION_RESULT_LIMIT)
    .default([])
    .describe('Copy citation IDs from search_knowledge.hits[].citationId.'),
  requests: z
    .array(
      strictObject({
        citationId: z
          .string()
          .regex(/^citation-[a-f0-9]{40}$/)
          .describe('Copy search_knowledge.hits[].citationId.'),
        offset: z.number().int().nonnegative().default(0),
        maxChars: z.number().int().min(256).max(65_536).default(16_384)
      })
    )
    .max(AGENT_CITATION_RESULT_LIMIT)
    .default([])
})
  .refine((args) => args.citationIds.length > 0 || args.requests.length > 0, {
    message:
      'Expected at least one citationIds or requests entry, received both empty. Call search_knowledge, copy a citationId, and retry read_citations once.'
  })
  .refine((args) => args.citationIds.length + args.requests.length <= AGENT_CITATION_RESULT_LIMIT, {
    message: `Expected at most ${AGENT_CITATION_RESULT_LIMIT} combined citation requests. Reduce the request and retry read_citations once.`
  })

export const searchManuscriptArgsSchema = strictObject({
  query: z.string().trim().min(1).max(2_000),
  sectionIds: z.array(z.uuid()).max(100).default([]),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe('Copy search_manuscript.nextCursor exactly; omit to restart.'),
  limit: z.number().int().min(1).max(50).default(20)
})

export const inspectChangeArgsSchema = strictObject({
  proposalId: z
    .uuid()
    .describe('Copy the exact proposalId returned by a submit tool in this conversation.')
})

export const draftCheckNameSchema = z.enum([
  'document_structure',
  'outline_integrity',
  'revision_lineage',
  'citation_provenance',
  'safe_links',
  'unresolved_placeholders',
  'duplicate_headings',
  'duplicate_paragraphs',
  'length_constraints',
  'empty_sections',
  'section_objectives',
  'unresolved_citations',
  'references_availability',
  'unused_resources',
  'writing_rules',
  'figure_metadata'
])

export const checkDraftArgsSchema = strictObject({
  scope: z.discriminatedUnion('type', [
    strictObject({ type: z.literal('manuscript') }),
    strictObject({ type: z.literal('section'), sectionId: z.uuid() })
  ]),
  checks: z.array(draftCheckNameSchema).max(16).default([])
})

const sectionSummarySchema = strictObject({
  sectionId: z.uuid(),
  parentSectionId: z.uuid().nullable(),
  position: z.number().int().nonnegative(),
  level: z.number().int().positive().max(64),
  title: z.string().min(1).max(500),
  objective: z.string().max(8_192).nullable(),
  status: z.enum(['planned', 'drafting', 'completed']),
  currentRevisionId: z.uuid(),
  wordCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative()
})

export const readOutlineResultSchema = strictObject({
  snapshotId: z.uuid(),
  outlineVersion: z.number().int().positive(),
  sections: z.array(sectionSummarySchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable(),
  totalSections: z.number().int().nonnegative()
})

const briefSummarySchema = strictObject({
  version: z.number().int().positive(),
  title: z.string().max(500),
  description: z.string().max(16_384),
  topic: z.string().max(8_192),
  targetAudience: z.string().max(8_192),
  language: z.string().max(256),
  styleTone: z.string().max(8_192),
  scopeExclusions: z.string().max(8_192),
  targetLength: z.string().max(2_048),
  citationRequirements: z.string().max(8_192),
  additionalInstructions: z.string().max(16_384)
})

export const writingContextResultSchema = strictObject({
  snapshotId: z.uuid(),
  observedAt: z.iso.datetime(),
  manuscriptId: z.string().min(1).max(256),
  outlineVersion: z.number().int().positive(),
  brief: briefSummarySchema.nullable(),
  outline: z.array(sectionSummarySchema).max(200),
  outlineTruncated: z.boolean(),
  activeSection: sectionSummarySchema.nullable(),
  editorSelection: strictObject({
    capturedAt: z.number().int().nonnegative(),
    capturedRevisionId: z.uuid().nullable(),
    currentRevisionId: z.uuid().nullable(),
    stale: z.boolean(),
    selectedBlockIds: z.array(z.string().min(1).max(256)).max(256),
    activeBlockId: z.string().min(1).max(256).nullable(),
    selectedText: z.string().max(16_384).nullable()
  }),
  warnings: z
    .array(strictObject({ code: z.string().min(1).max(100), message: z.string().max(1_000) }))
    .max(20),
  totalWordCount: z.number().int().nonnegative(),
  totalCharacterCount: z.number().int().nonnegative()
})

const sectionBlockSchema = strictObject({
  blockId: z.string().min(1).max(256),
  blockType: z.string().min(1).max(100),
  parentBlockId: z.string().min(1).max(256).nullable(),
  depth: z.number().int().nonnegative().max(16),
  ordinal: z.number().int().nonnegative(),
  text: z.string().max(8_192),
  textTruncated: z.boolean(),
  blockHash: z.string().regex(/^[a-f0-9]{64}$/u),
  childBlockIds: z.array(z.string().min(1).max(256)).max(10_000),
  hasRichContent: z.boolean()
})

export const readSectionResultSchema = strictObject({
  section: sectionSummarySchema,
  revisionId: z.uuid(),
  blocks: z.array(sectionBlockSchema).max(AGENT_SECTION_PAGE_LIMIT),
  canonicalBlock: z.unknown().nullable(),
  canonicalFragment: z.string().max(65_536).nullable(),
  fragmentOffset: z.number().int().nonnegative().nullable(),
  nextFragmentOffset: z.number().int().nonnegative().nullable(),
  missingBlockIds: z.array(z.string().min(1).max(256)).max(100),
  nextCursor: z.string().min(1).max(512).nullable(),
  totalBlocks: z.number().int().nonnegative()
})

export const searchManuscriptResultSchema = strictObject({
  snapshotId: z.uuid(),
  hits: z
    .array(
      strictObject({
        sectionId: z.uuid(),
        revisionId: z.uuid(),
        blockId: z.string().min(1).max(256),
        excerpt: z.string().max(1_200),
        matchRanges: z
          .array(z.tuple([z.number().int().nonnegative(), z.number().int().positive()]))
          .max(100),
        headingPath: z.array(z.string().max(500)).max(64)
      })
    )
    .max(50),
  nextCursor: z.string().min(1).max(512).nullable()
})

export const inspectChangeResultSchema = strictObject({
  proposal: mutationProposalRecordSchema,
  applicationStatus: z.enum(['not_applied', 'applied', 'conflict', 'no_change']),
  base: strictObject({
    briefVersion: z.number().int().positive().nullable(),
    outlineVersion: z.number().int().positive().nullable(),
    revisionId: z.uuid().nullable()
  }),
  result: strictObject({
    briefVersion: z.number().int().positive().nullable(),
    outlineVersion: z.number().int().positive().nullable(),
    revisionId: z.uuid().nullable(),
    undoRevisionId: z.uuid().nullable()
  }),
  idMapping: strictObject({
    createdSectionRefs: z.record(z.string().min(1).max(256), z.uuid()),
    createdBlockRefs: z.record(z.string().min(1).max(256), z.string().min(1).max(256))
  }),
  compactDiff: strictObject({
    summary: z.string().max(2_000),
    beforeText: z.string().max(32_768),
    afterText: z.string().max(32_768)
  }),
  warnings: z.array(z.string().max(1_000)).max(20),
  conflict: z.string().max(4_096).nullable()
})

export const checkDraftResultSchema = strictObject({
  snapshotId: z.uuid(),
  findings: z
    .array(
      strictObject({
        findingId: z.string().regex(/^[a-f0-9]{64}$/),
        priority: reviewPrioritySchema,
        category: reviewIssueCategorySchema,
        check: draftCheckNameSchema,
        sectionId: z.uuid().optional(),
        revisionId: z.uuid().optional(),
        blockIds: z.array(z.string().min(1).max(256)).max(100).optional(),
        title: z.string().min(1).max(500),
        description: z.string().min(1).max(8_192),
        evidence: z.string().max(2_000)
      })
    )
    .max(200),
  summary: strictObject({
    priorities: strictObject({
      P0: z.number().int().nonnegative(),
      P1: z.number().int().nonnegative(),
      P2: z.number().int().nonnegative(),
      P3: z.number().int().nonnegative()
    }),
    passedChecks: z.array(draftCheckNameSchema).max(16),
    skippedChecks: z.array(draftCheckNameSchema).max(16),
    unavailableChecks: z.array(draftCheckNameSchema).max(16),
    checkOutcomes: z
      .array(
        strictObject({
          check: draftCheckNameSchema,
          status: z.enum(['passed', 'failed', 'skipped', 'unavailable']),
          reason: z.string().max(1_000).nullable()
        })
      )
      .max(16),
    truncated: z.boolean()
  })
})

const knowledgeHitSchema = strictObject({
  citationId: z.string().regex(/^citation-[a-f0-9]{40}$/),
  knowledgeItemId: z.uuid(),
  parseRevisionId: z.uuid(),
  chunkId: z.string().regex(/^chunk-[a-f0-9]{40}$/),
  title: z.string().min(1).max(512),
  snippet: z.string().max(1_200),
  page: z.number().int().nonnegative().optional(),
  headingPath: z.array(z.string().max(1_000)).max(20),
  sourceBlockIds: z.array(z.string().min(1).max(100)).max(1_000)
})

export const searchKnowledgeResultSchema = strictObject({
  mode: z.enum(['none', 'fts', 'hybrid']),
  rerankStatus: z.enum([
    'disabled',
    'not-configured',
    'skipped-no-candidates',
    'applied',
    'unavailable'
  ]),
  hits: z.array(knowledgeHitSchema).max(AGENT_KNOWLEDGE_RESULT_LIMIT)
})

const citationResultSchema = strictObject({
  citationId: z.string().regex(/^citation-[a-f0-9]{40}$/),
  knowledgeItemId: z.uuid(),
  parseRevisionId: z.uuid(),
  chunkId: z.string().regex(/^chunk-[a-f0-9]{40}$/),
  title: z.string().min(1).max(512),
  text: z.string().max(65_536),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  offset: z.number().int().nonnegative(),
  totalChars: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  page: z.number().int().nonnegative().optional(),
  headingPath: z.array(z.string().max(1_000)).max(20),
  sourceBlockIds: z.array(z.string().min(1).max(100)).max(1_000)
})

export const readCitationsResultSchema = strictObject({
  citations: z.array(citationResultSchema).max(AGENT_CITATION_RESULT_LIMIT),
  missingCitationIds: z
    .array(z.string().regex(/^citation-[a-f0-9]{40}$/))
    .max(AGENT_CITATION_RESULT_LIMIT),
  truncated: z.boolean()
})

const toolRequestBase = {
  type: z.literal('tool_request'),
  requestId: z.uuid(),
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  toolCallId: z.string().min(1).max(256),
  modelRequestId: agentModelRequestIdSchema
}

export const agentToolRequestEnvelopeSchema = strictObject({
  ...toolRequestBase,
  toolName: agentToolNameSchema,
  args: z.unknown()
}).superRefine((request, context) => addByteIssue(request.args, AGENT_TOOL_ARGUMENT_BYTES, context))

export const agentToolRequestSchema = z
  .discriminatedUnion('toolName', [
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('get_writing_context'),
      args: getWritingContextArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('read_outline'),
      args: readOutlineArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('read_section'),
      args: readSectionArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('search_knowledge'),
      args: searchKnowledgeArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('search_manuscript'),
      args: searchManuscriptArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('read_citations'),
      args: readCitationsArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('read_writing_skill'),
      args: readWritingSkillArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('inspect_change'),
      args: inspectChangeArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('check_draft'),
      args: checkDraftArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('list_review_issues'),
      args: listReviewIssuesArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('record_review_issues'),
      args: recordReviewIssuesArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('update_review_issues'),
      args: updateReviewIssuesArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('get_writing_task'),
      args: getWritingTaskArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('create_writing_task'),
      args: createWritingTaskArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('update_writing_task'),
      args: updateWritingTaskArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('submit_brief_change'),
      args: modelSubmitBriefChangeArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('submit_writing_rules_change'),
      args: modelSubmitWritingRulesChangeWithReviewArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('submit_outline_change'),
      args: modelSubmitOutlineChangeArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('submit_section_change'),
      args: modelSubmitSectionChangeArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('generate_image'),
      args: generateImageArgsSchema
    })
  ])
  .superRefine((request, context) => addByteIssue(request.args, AGENT_TOOL_ARGUMENT_BYTES, context))

const toolResponseBase = {
  type: z.literal('tool_response'),
  schemaVersion: z.literal(AGENT_TOOL_RESULT_SCHEMA_VERSION),
  requestId: z.uuid(),
  projectSessionId: projectSessionIdSchema,
  agentSessionId: agentSessionIdSchema,
  agentRunId: agentRunIdSchema,
  toolCallId: z.string().min(1).max(256),
  modelRequestId: agentModelRequestIdSchema
}

const successResponses = z.discriminatedUnion('toolName', [
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('get_writing_context'),
    data: writingContextResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('read_outline'),
    data: readOutlineResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('read_section'),
    data: readSectionResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('search_knowledge'),
    data: searchKnowledgeResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('search_manuscript'),
    data: searchManuscriptResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('read_citations'),
    data: readCitationsResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('read_writing_skill'),
    data: readWritingSkillResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('inspect_change'),
    data: inspectChangeResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('check_draft'),
    data: checkDraftResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('list_review_issues'),
    data: listReviewIssuesResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('record_review_issues'),
    data: recordReviewIssuesResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('update_review_issues'),
    data: updateReviewIssuesResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('get_writing_task'),
    data: getWritingTaskResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('create_writing_task'),
    data: createWritingTaskResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('update_writing_task'),
    data: updateWritingTaskResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('submit_brief_change'),
    data: submitChangeResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('submit_writing_rules_change'),
    data: submitChangeResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('submit_outline_change'),
    data: submitChangeResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('submit_section_change'),
    data: submitChangeResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('generate_image'),
    data: submitChangeResultSchema
  })
])

export const agentToolRecoverySchema = strictObject({
  action: z.enum([
    'fix_arguments',
    'refresh_context',
    'restart_pagination',
    'reduce_scope',
    'retry',
    'retry_after',
    'ask_user',
    'do_not_retry'
  ]),
  tool: agentToolNameSchema.optional(),
  maxAttempts: z.number().int().positive().max(10).optional(),
  uri: z.string().min(1).max(2_048).startsWith('writellm://').optional()
})

export const agentToolErrorCategorySchema = z.enum([
  'validation',
  'authorization',
  'precondition',
  'conflict',
  'transient',
  'cancelled',
  'internal'
])

const errorResponse = strictObject({
  ...toolResponseBase,
  ok: z.literal(false),
  toolName: agentToolNameSchema,
  error: strictObject({
    code: z.enum([
      'invalid_arguments',
      'unauthorized',
      'unavailable',
      'not_found',
      'conflict',
      'stale_cursor',
      'result_too_large',
      'deadline_exceeded',
      'aborted',
      'internal'
    ]),
    category: agentToolErrorCategorySchema,
    message: z.string().min(1).max(1_000),
    recovery: agentToolRecoverySchema
  })
})

export const agentToolResponseSchema = z
  .union([successResponses, errorResponse])
  .superRefine((response, context) => {
    if (response.ok) addByteIssue(response.data, AGENT_TOOL_RESULT_BYTES, context)
  })

export const agentToolCallPayloadSchema = strictObject({
  toolCallId: z.string().min(1).max(256),
  toolName: persistedAgentToolNameSchema,
  contractVersion: z.number().int().positive().default(1),
  args: z.record(z.string(), z.unknown()),
  timestamp: z.number().int().nonnegative()
}).superRefine((payload, context) => addByteIssue(payload.args, AGENT_TOOL_ARGUMENT_BYTES, context))

export const agentToolResultPayloadSchema = strictObject({
  toolCallId: z.string().min(1).max(256),
  toolName: persistedAgentToolNameSchema,
  contractVersion: z.number().int().positive().default(1),
  isError: z.boolean(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z
    .object({
      code: z.string().min(1).max(100),
      message: z.string().min(1).max(1_000),
      retryable: z.boolean().optional(),
      operationId: z.string().min(1).max(256).optional(),
      category: agentToolErrorCategorySchema.optional(),
      recovery: agentToolRecoverySchema.optional()
    })
    .strict()
    .nullable(),
  citationIds: z
    .array(z.string().regex(/^citation-[a-f0-9]{40}$/))
    .max(AGENT_KNOWLEDGE_RESULT_LIMIT),
  knowledgeItemIds: z.array(z.uuid()).max(AGENT_KNOWLEDGE_RESULT_LIMIT),
  parseRevisionIds: z.array(z.uuid()).max(AGENT_KNOWLEDGE_RESULT_LIMIT),
  timestamp: z.number().int().nonnegative()
}).superRefine((payload, context) => addByteIssue(payload, AGENT_TOOL_RESULT_BYTES, context))

function addByteIssue(value: unknown, limit: number, context: z.RefinementCtx): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit) {
    context.addIssue({ code: 'custom', message: `Payload exceeds ${limit} bytes` })
  }
}

export type AgentReadToolName = z.infer<typeof agentReadToolNameSchema>
export type ToolResultMeta = z.infer<typeof toolResultMetaSchema>
export type AgentToolName = z.infer<typeof agentToolNameSchema>
export type AgentProposalToolName = z.infer<typeof agentProposalToolNameSchema>
export type AgentToolRequestEnvelope = z.infer<typeof agentToolRequestEnvelopeSchema>
export type AgentToolRequest = z.infer<typeof agentToolRequestSchema>
export type AgentToolResponse = z.infer<typeof agentToolResponseSchema>
export type GetWritingContextArgs = z.infer<typeof getWritingContextArgsSchema>
export type ReadSectionArgs = z.infer<typeof readSectionArgsSchema>
export type ReadOutlineArgs = z.infer<typeof readOutlineArgsSchema>
export type SearchManuscriptArgs = z.infer<typeof searchManuscriptArgsSchema>
export type InspectChangeArgs = z.infer<typeof inspectChangeArgsSchema>
export type CheckDraftArgs = z.infer<typeof checkDraftArgsSchema>
export type SearchKnowledgeArgs = z.infer<typeof searchKnowledgeArgsSchema>
export type ReadCitationsArgs = z.infer<typeof readCitationsArgsSchema>
export type WritingContextResult = z.infer<typeof writingContextResultSchema>
export type ReadSectionResult = z.infer<typeof readSectionResultSchema>
export type ReadOutlineResult = z.infer<typeof readOutlineResultSchema>
export type SearchManuscriptResult = z.infer<typeof searchManuscriptResultSchema>
export type InspectChangeResult = z.infer<typeof inspectChangeResultSchema>
export type CheckDraftResult = z.infer<typeof checkDraftResultSchema>
export type SearchKnowledgeResult = z.infer<typeof searchKnowledgeResultSchema>
export type ReadCitationsResult = z.infer<typeof readCitationsResultSchema>
export type ReadWritingSkillResult = z.infer<typeof readWritingSkillResultSchema>
