import type { TSchema } from 'typebox'
import { z } from 'zod'
import type { AgentToolProfile, WritingToolGroup } from './contracts/agent'
import {
  generateImageArgsSchema,
  modelSubmitBriefChangeArgsSchema,
  modelSubmitOutlineChangeArgsSchema,
  modelSubmitSectionChangeArgsSchema,
  modelSubmitWritingRulesChangeWithReviewArgsSchema
} from './contracts/agent-mutations'
import {
  askUserArgsSchema,
  activateToolGroupsArgsSchema,
  checkDraftArgsSchema,
  getWritingContextArgsSchema,
  inspectChangeArgsSchema,
  readCitationsArgsSchema,
  readOutlineArgsSchema,
  readSectionArgsSchema,
  readWritingSkillArgsSchema,
  searchKnowledgeArgsSchema,
  searchManuscriptArgsSchema,
  type AgentToolName
} from './contracts/agent-tools'
import {
  listReviewIssuesArgsSchema,
  recordReviewIssuesArgsSchema,
  updateReviewIssuesArgsSchema
} from './contracts/review'
import {
  createWritingTaskArgsSchema,
  getWritingTaskArgsSchema,
  updateWritingTaskArgsSchema
} from './contracts/writing-task'

export interface AgentModelVisibleToolSpec {
  readonly name: AgentToolName
  readonly label: string
  readonly description: string
  readonly parameters: TSchema
  readonly executionMode: 'parallel' | 'sequential'
}

function parameters(schema: z.ZodType, transform?: (schema: unknown) => unknown): TSchema {
  const normalized = normalizeModelToolSchema(
    z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' })
  )
  return ensureObjectRoot(transform?.(normalized) ?? normalized) as TSchema
}

function ensureObjectRoot(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (
      record.type === 'object' &&
      record.properties &&
      typeof record.properties === 'object' &&
      !Array.isArray(record.properties)
    ) {
      return value
    }
    const projected = projectObjectUnionRoot(record)
    if (projected !== undefined) return { ...projected, allOf: [value] }
  }
  return { type: 'object', properties: {}, allOf: [value] }
}

function projectObjectUnionRoot(
  value: Record<string, unknown>
): Record<string, unknown> | undefined {
  const union = Array.isArray(value.anyOf)
    ? value.anyOf
    : Array.isArray(value.oneOf)
      ? value.oneOf
      : undefined
  if (union === undefined || union.length === 0) return undefined

  const branches = union.map(objectSchemaBranch)
  if (branches.some((branch) => branch === undefined)) return undefined
  const objectBranches = branches as Array<{
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: unknown
  }>
  const propertyNames = [
    ...new Set(objectBranches.flatMap((branch) => Object.keys(branch.properties)))
  ]
  const properties = Object.fromEntries(
    propertyNames.map((name) => [
      name,
      mergeProjectedPropertySchemas(
        objectBranches.flatMap((branch) =>
          name in branch.properties ? [branch.properties[name]] : []
        )
      )
    ])
  )
  const required = objectBranches
    .slice(1)
    .reduce(
      (common, branch) => common.filter((name) => branch.required.includes(name)),
      objectBranches[0]?.required ?? []
    )

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(objectBranches.every((branch) => branch.additionalProperties === false)
      ? { additionalProperties: false }
      : {})
  }
}

function objectSchemaBranch(value: unknown):
  | {
      properties: Record<string, unknown>
      required: string[]
      additionalProperties: unknown
    }
  | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.type !== 'object' ||
    !record.properties ||
    typeof record.properties !== 'object' ||
    Array.isArray(record.properties)
  ) {
    return undefined
  }
  return {
    properties: record.properties as Record<string, unknown>,
    required: Array.isArray(record.required)
      ? record.required.filter((name): name is string => typeof name === 'string')
      : [],
    additionalProperties: record.additionalProperties
  }
}

function mergeProjectedPropertySchemas(values: unknown[]): unknown {
  const unique = [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]
  if (unique.length <= 1) return unique[0] ?? {}

  const literalSchemas = unique.map(literalPropertySchema)
  if (literalSchemas.every((schema) => schema !== undefined)) {
    const schemas = literalSchemas as Array<{ type: unknown; values: unknown[] }>
    const types = [...new Set(schemas.map((schema) => schema.type))]
    return {
      ...(types.length === 1 && types[0] !== undefined ? { type: types[0] } : {}),
      enum: [...new Set(schemas.flatMap((schema) => schema.values))]
    }
  }
  return { anyOf: unique }
}

function literalPropertySchema(value: unknown): { type: unknown; values: unknown[] } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if ('const' in record) return { type: record.type, values: [record.const] }
  if (Array.isArray(record.enum)) return { type: record.type, values: record.enum }
  return undefined
}

function requireOneCitationInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...value, anyOf: [{ required: ['citationIds'] }, { required: ['requests'] }] }
}

function makeCanonicalBlocksOpaque(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(makeCanonicalBlocksOpaque)
  if (!value || typeof value !== 'object') return value
  const record = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, makeCanonicalBlocksOpaque(entry)])
  ) as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const propertyRecord = properties as Record<string, unknown>
    const type = propertyRecord.type
    if (
      type &&
      typeof type === 'object' &&
      !Array.isArray(type) &&
      ((type as Record<string, unknown>).const === 'replaceCanonicalBlock' ||
        ((type as Record<string, unknown>).enum as unknown[])?.[0] === 'replaceCanonicalBlock')
    ) {
      propertyRecord.block = {
        type: 'object',
        maxProperties: 64,
        additionalProperties: true,
        description: 'Copy the exact canonicalBlock object returned by read_section in this run.'
      }
    } else if (
      type &&
      typeof type === 'object' &&
      !Array.isArray(type) &&
      ((type as Record<string, unknown>).const === 'insertRichBlock' ||
        ((type as Record<string, unknown>).enum as unknown[])?.[0] === 'insertRichBlock')
    ) {
      propertyRecord.block = {
        type: 'object',
        properties: {
          clientRef: { type: 'string' },
          blockType: { type: 'string', enum: ['mathBlock', 'diagram'] },
          source: { type: 'string', maxLength: 64_000 },
          caption: { type: 'string', maxLength: 2_000 },
          altText: { type: 'string', maxLength: 2_000 }
        },
        required: ['blockType', 'source'],
        additionalProperties: false,
        description: 'mathBlock uses source; diagram may also include caption and altText.'
      }
    } else if (
      type &&
      typeof type === 'object' &&
      !Array.isArray(type) &&
      ((type as Record<string, unknown>).const === 'insertTable' ||
        ((type as Record<string, unknown>).enum as unknown[])?.[0] === 'insertTable')
    ) {
      propertyRecord.table = {
        type: 'object',
        properties: {
          clientRef: { type: 'string', maxLength: 256 },
          headerRows: { type: 'integer', enum: [0, 1] },
          headerCols: { type: 'integer', enum: [0, 1] },
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 30,
              items: {
                anyOf: [
                  { type: 'string', maxLength: 8_192 },
                  {
                    type: 'object',
                    maxProperties: 2,
                    additionalProperties: true,
                    description: 'Use content for approved inline nodes and optional textAlignment.'
                  }
                ]
              }
            }
          }
        },
        required: ['headerRows', 'headerCols', 'rows'],
        additionalProperties: false
      }
    } else if (
      type &&
      typeof type === 'object' &&
      !Array.isArray(type) &&
      ((type as Record<string, unknown>).const === 'editTable' ||
        ((type as Record<string, unknown>).enum as unknown[])?.[0] === 'editTable')
    ) {
      propertyRecord.operations = {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          maxProperties: 4,
          additionalProperties: true,
          description:
            'One of setCell, insertRows, deleteRows, insertColumns, deleteColumns, moveRow, moveColumn, setHeaders, or setColumnAlignment.'
        }
      }
    }
  }
  delete record.definitions
  return record
}

function stripSchemaDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaDescriptions)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      key === 'description' ? [] : [[key, stripSchemaDescriptions(entry)]]
    )
  )
}

function compactSectionChange(value: unknown): unknown {
  return stripSchemaDescriptions(makeCanonicalBlocksOpaque(value))
}

function normalizeModelToolSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeModelToolSchema)
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const record = Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      key === '$schema' ? [] : [[key, normalizeModelToolSchema(entry)]]
    )
  ) as Record<string, unknown>
  if (
    record.type === 'object' &&
    record.properties &&
    typeof record.properties === 'object' &&
    !Array.isArray(record.properties) &&
    Array.isArray(record.required)
  ) {
    const properties = record.properties as Record<string, unknown>
    const required = record.required.filter((key): key is string => {
      if (typeof key !== 'string') return false
      const property = properties[key]
      return !(
        property &&
        typeof property === 'object' &&
        !Array.isArray(property) &&
        'default' in property
      )
    })
    if (required.length > 0) {
      record.required = required
    } else {
      delete record.required
    }
  }
  return record
}

export const AGENT_MODEL_VISIBLE_TOOL_SPECS = [
  {
    name: 'get_writing_context',
    label: 'Get writing context',
    description: 'Read the bounded Brief, Outline, active-section, and editor context snapshot.',
    parameters: parameters(getWritingContextArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'read_outline',
    label: 'Read outline',
    description: 'Read a snapshot-bound Outline page or subtree.',
    parameters: parameters(readOutlineArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'read_section',
    label: 'Read section',
    description: 'Read bounded summary, canonical, fragment, or table data for one section.',
    parameters: parameters(readSectionArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'search_knowledge',
    label: 'Search knowledge',
    description:
      'Search project knowledge for discovery snippets; expand evidence before citing it.',
    parameters: parameters(searchKnowledgeArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'search_manuscript',
    label: 'Search manuscript',
    description: 'Search snapshot-bound manuscript blocks for existing wording and locations.',
    parameters: parameters(searchManuscriptArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'read_citations',
    label: 'Read citations',
    description: 'Expand selected citation IDs into bounded source text and provenance.',
    parameters: parameters(readCitationsArgsSchema, requireOneCitationInput),
    executionMode: 'parallel'
  },
  {
    name: 'read_writing_skill',
    label: 'Read writing skill',
    description: 'Read one run-authorized Writing Skill entrypoint or reference by virtual URI.',
    parameters: parameters(readWritingSkillArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'ask_user',
    label: 'Ask the user',
    description:
      'Pause for one to three material user decisions. This must be the only tool call in the message.',
    parameters: parameters(askUserArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'activate_tool_groups',
    label: 'Activate tool groups',
    description:
      'Enable task-relevant writing capabilities for later calls in this run. This must be the only tool call in the message.',
    parameters: parameters(activateToolGroupsArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'inspect_change',
    label: 'Inspect change',
    description:
      'Inspect the authoritative state and outcome of one proposal in this conversation.',
    parameters: parameters(inspectChangeArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'check_draft',
    label: 'Check draft',
    description: 'Run bounded deterministic draft checks; findings do not authorize edits.',
    parameters: parameters(checkDraftArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'list_review_issues',
    label: 'List review issues',
    description: 'Read a bounded page of persistent review issues and their current versions.',
    parameters: parameters(listReviewIssuesArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'get_writing_task',
    label: 'Get writing task',
    description: 'Read the current conversation writing task and plan version.',
    parameters: parameters(getWritingTaskArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'record_review_issues',
    label: 'Record review issues',
    description:
      'Create or exactly refresh actionable review issues without editing the manuscript.',
    parameters: parameters(recordReviewIssuesArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'update_review_issues',
    label: 'Update review issues',
    description: 'Claim, release, resolve, or reopen version-bound review issues.',
    parameters: parameters(updateReviewIssuesArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'create_writing_task',
    label: 'Create writing task',
    description: 'Create one bounded writing task for genuinely multi-step work.',
    parameters: parameters(createWritingTaskArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'update_writing_task',
    label: 'Update writing task',
    description: 'Update the version-bound writing task plan without changing the manuscript.',
    parameters: parameters(updateWritingTaskArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_brief_change',
    label: 'Propose brief update',
    description: 'Submit one reviewable Brief change; Main binds the source version.',
    parameters: parameters(modelSubmitBriefChangeArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_writing_rules_change',
    label: 'Propose writing rules change',
    description: 'Submit one reviewable Writing Rules change against current rule IDs.',
    parameters: parameters(modelSubmitWritingRulesChangeWithReviewArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_outline_change',
    label: 'Propose outline patch',
    description:
      'Submit one sequential, reviewable Outline patch using existing IDs or prior client refs.',
    parameters: parameters(modelSubmitOutlineChangeArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_section_change',
    label: 'Propose section patch',
    description:
      'Submit one reviewable, block-hash-guarded section patch; Main binds the revision and inserted IDs.',
    parameters: parameters(modelSubmitSectionChangeArgsSchema, compactSectionChange),
    executionMode: 'sequential'
  },
  {
    name: 'generate_image',
    label: 'Generate or iterate image',
    description:
      'Submit one reviewable generated-image insertion or iteration with Main-bound lineage.',
    parameters: parameters(generateImageArgsSchema),
    executionMode: 'sequential'
  }
] as const satisfies readonly AgentModelVisibleToolSpec[]

export const AGENT_MODEL_VISIBLE_TOOL_ENVELOPE = AGENT_MODEL_VISIBLE_TOOL_SPECS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters
}))

export const WRITING_CORE_TOOL_NAMES = [
  'get_writing_context',
  'read_outline',
  'read_section',
  'search_manuscript',
  'search_knowledge',
  'read_citations',
  'read_writing_skill',
  'ask_user',
  'activate_tool_groups'
] as const satisfies readonly AgentToolName[]

export const WRITING_TOOL_GROUP_TOOL_NAMES = {
  review: [
    'inspect_change',
    'check_draft',
    'list_review_issues',
    'record_review_issues',
    'update_review_issues'
  ],
  writing_task: ['get_writing_task', 'create_writing_task', 'update_writing_task'],
  brief: ['submit_brief_change'],
  writing_rules: ['submit_writing_rules_change'],
  outline: ['submit_outline_change'],
  section: ['submit_section_change'],
  image: ['generate_image']
} as const satisfies Record<WritingToolGroup, readonly AgentToolName[]>

export const AGENT_INITIAL_WRITING_TOOL_ENVELOPE = agentToolEnvelope(
  agentModelVisibleToolSpecs('writing', [])
)
export const AGENT_INITIAL_WRITING_TOOL_ENVELOPE_MAX_BYTES = 20 * 1_024

const NOTEBOOK_KNOWLEDGE_TOOL_NAMES = new Set<AgentToolName>(['search_knowledge', 'read_citations'])

export function agentModelVisibleToolSpecs(
  profile: AgentToolProfile,
  activeGroups: readonly WritingToolGroup[] = []
): readonly AgentModelVisibleToolSpec[] {
  if (profile === 'writing') {
    const names = new Set<AgentToolName>(WRITING_CORE_TOOL_NAMES)
    for (const group of activeGroups) {
      for (const name of WRITING_TOOL_GROUP_TOOL_NAMES[group]) names.add(name)
    }
    return AGENT_MODEL_VISIBLE_TOOL_SPECS.filter((tool) => names.has(tool.name))
  }
  return AGENT_MODEL_VISIBLE_TOOL_SPECS.filter((tool) =>
    NOTEBOOK_KNOWLEDGE_TOOL_NAMES.has(tool.name)
  )
}

export function agentToolEnvelope(specs: readonly AgentModelVisibleToolSpec[]): unknown[] {
  return specs.map(({ name, description, parameters }) => ({ name, description, parameters }))
}

export function agentToolProfileAllows(
  profile: AgentToolProfile,
  toolName: AgentToolName
): boolean {
  if (profile === 'writing')
    return AGENT_MODEL_VISIBLE_TOOL_SPECS.some((tool) => tool.name === toolName)
  return agentModelVisibleToolSpecs(profile).some((tool) => tool.name === toolName)
}

export function activeAgentToolSetAllows(
  profile: AgentToolProfile,
  activeGroups: readonly WritingToolGroup[],
  toolName: AgentToolName
): boolean {
  return agentModelVisibleToolSpecs(profile, activeGroups).some((tool) => tool.name === toolName)
}
