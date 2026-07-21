import { z } from 'zod'
import {
  type agentProposalToolNameSchema,
  briefUpdateSchema,
  mutationProposalToolResultSchema,
  outlinePatchSchema,
  sectionPatchSchema
} from './agent-mutations'
import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from './knowledge'
import { projectSessionIdSchema } from './projects'
import { agentModelRequestIdSchema, agentRunIdSchema, agentSessionIdSchema } from './agent'

export const AGENT_TOOL_ARGUMENT_BYTES = 65_536
export const AGENT_TOOL_RESULT_BYTES = 262_144
export const AGENT_SECTION_PAGE_LIMIT = 50
export const AGENT_KNOWLEDGE_RESULT_LIMIT = 20
export const AGENT_CITATION_RESULT_LIMIT = 10

export const agentReadToolNameSchema = z.enum([
  'get_writing_context',
  'read_section',
  'search_knowledge',
  'read_citations'
])

export const agentToolNameSchema = z.enum([
  'get_writing_context',
  'read_section',
  'search_knowledge',
  'read_citations',
  'propose_brief_update',
  'propose_outline_patch',
  'propose_section_patch'
])

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const getWritingContextArgsSchema = strictObject({
  includeBrief: z.boolean().default(true),
  includeOutline: z.boolean().default(true),
  activeSectionId: z.uuid().optional()
})

export const readSectionArgsSchema = strictObject({
  sectionId: z.uuid(),
  blockIds: z.array(z.string().min(1).max(256)).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(AGENT_SECTION_PAGE_LIMIT).default(20)
}).refine((value) => value.blockIds === undefined || value.cursor === undefined, {
  message: 'blockIds and cursor cannot be combined'
})

export const searchKnowledgeArgsSchema = strictObject({
  query: z.string().trim().min(1).max(2_000),
  knowledgeItemIds: z.array(z.uuid()).max(20).default([]),
  fileExtensions: z.array(z.enum(SUPPORTED_KNOWLEDGE_EXTENSIONS)).max(10).default([]),
  parseRevisionIds: z.array(z.uuid()).max(20).default([]),
  pageFrom: z.number().int().nonnegative().optional(),
  pageTo: z.number().int().nonnegative().optional(),
  heading: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(AGENT_KNOWLEDGE_RESULT_LIMIT).default(10),
  rerank: z.boolean().default(true)
}).refine(
  (value) =>
    value.pageFrom === undefined || value.pageTo === undefined || value.pageFrom <= value.pageTo,
  { message: 'Page range is invalid' }
)

export const readCitationsArgsSchema = strictObject({
  citationIds: z
    .array(z.string().regex(/^citation-[a-f0-9]{40}$/))
    .min(1)
    .max(AGENT_CITATION_RESULT_LIMIT)
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
  manuscriptId: z.string().min(1).max(256),
  outlineVersion: z.number().int().positive(),
  brief: briefSummarySchema.nullable(),
  outline: z.array(sectionSummarySchema).max(200),
  outlineTruncated: z.boolean(),
  activeSection: sectionSummarySchema.nullable(),
  activeSectionText: z.string().max(32_768).nullable(),
  selectedBlockIds: z.array(z.string().min(1).max(256)).max(256),
  activeBlockId: z.string().min(1).max(256).nullable(),
  totalWordCount: z.number().int().nonnegative(),
  totalCharacterCount: z.number().int().nonnegative()
})

const sectionBlockSchema = strictObject({
  blockId: z.string().min(1).max(256),
  blockType: z.string().min(1).max(100),
  ordinal: z.number().int().nonnegative(),
  text: z.string().max(8_192),
  textTruncated: z.boolean()
})

export const readSectionResultSchema = strictObject({
  section: sectionSummarySchema,
  revisionId: z.uuid(),
  blocks: z.array(sectionBlockSchema).max(AGENT_SECTION_PAGE_LIMIT),
  missingBlockIds: z.array(z.string().min(1).max(256)).max(100),
  nextCursor: z.string().min(1).max(512).nullable(),
  totalBlocks: z.number().int().nonnegative()
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
  page: z.number().int().nonnegative().optional(),
  headingPath: z.array(z.string().max(1_000)).max(20),
  sourceBlockIds: z.array(z.string().min(1).max(100)).max(1_000)
})

export const readCitationsResultSchema = strictObject({
  citations: z.array(citationResultSchema).max(AGENT_CITATION_RESULT_LIMIT),
  missingCitationIds: z
    .array(z.string().regex(/^citation-[a-f0-9]{40}$/))
    .max(AGENT_CITATION_RESULT_LIMIT)
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

export const agentToolRequestSchema = z
  .discriminatedUnion('toolName', [
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('get_writing_context'),
      args: getWritingContextArgsSchema
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
      toolName: z.literal('read_citations'),
      args: readCitationsArgsSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('propose_brief_update'),
      args: briefUpdateSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('propose_outline_patch'),
      args: outlinePatchSchema
    }),
    strictObject({
      ...toolRequestBase,
      toolName: z.literal('propose_section_patch'),
      args: sectionPatchSchema
    })
  ])
  .superRefine((request, context) => addByteIssue(request.args, AGENT_TOOL_ARGUMENT_BYTES, context))

const toolResponseBase = {
  type: z.literal('tool_response'),
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
    toolName: z.literal('read_citations'),
    data: readCitationsResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('propose_brief_update'),
    data: mutationProposalToolResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('propose_outline_patch'),
    data: mutationProposalToolResultSchema
  }),
  strictObject({
    ...toolResponseBase,
    ok: z.literal(true),
    toolName: z.literal('propose_section_patch'),
    data: mutationProposalToolResultSchema
  })
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
      'aborted',
      'internal'
    ]),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean()
  })
})

export const agentToolResponseSchema = z
  .union([successResponses, errorResponse])
  .superRefine((response, context) => {
    if (response.ok) addByteIssue(response.data, AGENT_TOOL_RESULT_BYTES, context)
  })

export const agentToolCallPayloadSchema = strictObject({
  toolCallId: z.string().min(1).max(256),
  toolName: agentToolNameSchema,
  args: z.record(z.string(), z.unknown()),
  timestamp: z.number().int().nonnegative()
}).superRefine((payload, context) => addByteIssue(payload.args, AGENT_TOOL_ARGUMENT_BYTES, context))

export const agentToolResultPayloadSchema = strictObject({
  toolCallId: z.string().min(1).max(256),
  toolName: agentToolNameSchema,
  isError: z.boolean(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z
    .object({ code: z.string().min(1).max(100), message: z.string().min(1).max(1_000) })
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
export type AgentToolName = z.infer<typeof agentToolNameSchema>
export type AgentProposalToolName = z.infer<typeof agentProposalToolNameSchema>
export type AgentToolRequest = z.infer<typeof agentToolRequestSchema>
export type AgentToolResponse = z.infer<typeof agentToolResponseSchema>
export type GetWritingContextArgs = z.infer<typeof getWritingContextArgsSchema>
export type ReadSectionArgs = z.infer<typeof readSectionArgsSchema>
export type SearchKnowledgeArgs = z.infer<typeof searchKnowledgeArgsSchema>
export type ReadCitationsArgs = z.infer<typeof readCitationsArgsSchema>
export type WritingContextResult = z.infer<typeof writingContextResultSchema>
export type ReadSectionResult = z.infer<typeof readSectionResultSchema>
export type SearchKnowledgeResult = z.infer<typeof searchKnowledgeResultSchema>
export type ReadCitationsResult = z.infer<typeof readCitationsResultSchema>
