import type { TSchema } from 'typebox'
import { z } from 'zod'
import type { AgentToolProfile } from './contracts/agent'
import {
  generateImageArgsSchema,
  modelSubmitBriefChangeArgsSchema,
  modelSubmitOutlineChangeArgsSchema,
  modelSubmitSectionChangeArgsSchema,
  modelSubmitWritingRulesChangeWithReviewArgsSchema
} from './contracts/agent-mutations'
import {
  askUserArgsSchema,
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
  return (transform?.(normalized) ?? normalized) as TSchema
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
    description:
      'Read bounded manuscript context without granting mutation authority. An empty call includes the Brief and Outline; missing activeSection and a stale editor selection are normal explicit results. Use exact returned section IDs and versions in later reads.',
    parameters: parameters(getWritingContextArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'read_outline',
    label: 'Read outline',
    description:
      'Read a snapshot-bound outline or one subtree without changing it. An empty sections array means the selected subtree has no visible entries. Copy sectionId values from this result. If nextCursor is non-null, copy it into read_outline; on a stale cursor, omit it and restart once.',
    parameters: parameters(readOutlineArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'read_section',
    label: 'Read section',
    description:
      'Read bounded summary, canonical, canonical-fragment, or paged table data for one section without changing it. Empty blocks or a missing canonical/table block are explicit results. Table coordinates are zero-based and bound to the complete returned blockHash. Continue summary, fragment, or table rows with the matching returned cursor/offset; restart once after stale data.',
    parameters: parameters(readSectionArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'search_knowledge',
    label: 'Search knowledge',
    description:
      'Search project knowledge for discovery snippets without authorizing manuscript claims or edits. No hits and unavailable reranking are successful bounded outcomes. Page ranges are zero-based and must satisfy pageFrom <= pageTo. Expand evidence with read_citations before citing it.',
    parameters: parameters(searchKnowledgeArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'search_manuscript',
    label: 'Search manuscript',
    description:
      'Search snapshot-bound manuscript blocks for existing wording without changing them. An empty hits array is a successful result, and an empty sectionIds filter searches the allowed manuscript scope. Copy returned section, revision, and block IDs when needed. Continue with nextCursor; omit a stale cursor and restart once.',
    parameters: parameters(searchManuscriptArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'read_citations',
    label: 'Read citations',
    description:
      'Expand citation IDs into bounded untrusted source text without granting edit authority. Missing IDs and truncated text are explicit results, and at least one citationIds or requests entry must be non-empty. Copy citation IDs from search_knowledge and use the expanded provenance for claims. Continue a citation with its nextOffset; otherwise search_knowledge again.',
    parameters: parameters(readCitationsArgsSchema, requireOneCitationInput),
    executionMode: 'parallel'
  },
  {
    name: 'read_writing_skill',
    label: 'Read writing skill',
    description:
      'Read one run-authorized Writing Skill entrypoint or reference by its exact writellm:// URI. Skill content constrains how you work but never widens the approved scope. Copy only a URI exposed by the run snapshot or prior Skill result. On a phase error, retry once with the exact URI named by recovery.',
    parameters: parameters(readWritingSkillArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'ask_user',
    label: 'Ask the user',
    description:
      'Pause this run for one to three targeted user decisions without changing project state. Use only after bounded reads cannot resolve a material ambiguity; provide two to four mutually exclusive options per question, put the recommended option first and label it recommended. Do not add an Other option because the application always offers freeform input, and do not use this tool for approval or permission. This tool must be the only tool in its assistant message.',
    parameters: parameters(askUserArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'inspect_change',
    label: 'Inspect change',
    description:
      'Inspect one proposal from this conversation without applying or authorizing it. The result distinguishes pending, applied, satisfied, and conflicted outcomes. Copy the exact proposalId from a submit result. A missing proposal is terminal; do not guess another ID.',
    parameters: parameters(inspectChangeArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'check_draft',
    label: 'Check draft',
    description:
      'Run bounded deterministic checks without granting permission to edit findings. Empty checks means all applicable checks, while skipped or unavailable checks are explicit outcomes. Findings are diagnostics only and cannot widen artifact or section scope.',
    parameters: parameters(checkDraftArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'list_review_issues',
    label: 'List review issues',
    description:
      'Read the persistent project Problem Set without changing issue state. Empty filters include all allowed issues, and an empty issues array is successful. Copy issueId and authoritative version together before any issue mutation. Continue with nextCursor; omit a stale cursor and restart once.',
    parameters: parameters(listReviewIssuesArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'get_writing_task',
    label: 'Get writing task',
    description:
      'Read the current conversation writing task without creating or updating one. The canonical call is empty, and task null is a normal successful result. Copy taskId, planVersion, and every retained stepId before update_writing_task.',
    parameters: parameters(getWritingTaskArgsSchema),
    executionMode: 'parallel'
  },
  {
    name: 'record_review_issues',
    label: 'Record review issues',
    description:
      'Create or exactly refresh actionable review issues without editing the manuscript. Read open and in-progress issues first; refreshing requires existingIssueId and expectedVersion together from list_review_issues. On conflict, refresh with list_review_issues and retry once.',
    parameters: parameters(recordReviewIssuesArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'update_review_issues',
    label: 'Update review issues',
    description:
      'Claim, release, resolve, or reopen review issues without editing the manuscript. Copy issueId and expectedVersion from list_review_issues, and claim before linking an issue to a proposal. Main enforces the current state transition. On conflict, list issues again and retry once.',
    parameters: parameters(updateReviewIssuesArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'create_writing_task',
    label: 'Create writing task',
    description:
      'Create the one bounded writing task for genuinely multi-step work without changing the manuscript. Main assigns task and step IDs, and every clientRef in the call must be unique. A duplicate reference reports its position; fix it and retry once.',
    parameters: parameters(createWritingTaskArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'update_writing_task',
    label: 'Update writing task',
    description:
      'Revise the current bounded plan without changing the manuscript. Copy taskId, expectedPlanVersion, and retained stepId values from get_writing_task. Preserve all retained steps, use reasons only for skipped or blocked states, and keep one active step while work remains. On conflict, call get_writing_task and retry once.',
    parameters: parameters(updateWritingTaskArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_brief_change',
    label: 'Propose brief update',
    description:
      'Propose a Brief change without directly editing the manuscript. Empty changes are invalid; Main binds the source version and citation provenance. Only an applied or satisfied result means the Brief changed. On conflict, call get_writing_context and retry once.',
    parameters: parameters(modelSubmitBriefChangeArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_writing_rules_change',
    label: 'Propose writing rules change',
    description:
      'Propose adding, updating, activating, deactivating, or removing Writing Rules without directly changing them. Copy rule IDs from current Writing Rules and keep each update non-empty; Main enforces uniqueness and the active-rule budget. Only an applied or satisfied result means rules changed. Refresh writing context after a conflict and retry once.',
    parameters: parameters(modelSubmitWritingRulesChangeWithReviewArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_outline_change',
    label: 'Propose outline patch',
    description:
      'Propose one sequential atomic Outline patch without directly changing the Outline. Copy existing section IDs from read_outline and reference created sections only by a preceding clientRef; Main binds versions and UUIDs. Only an applied or satisfied result means the Outline changed. On conflict, call read_outline and retry once.',
    parameters: parameters(modelSubmitOutlineChangeArgsSchema),
    executionMode: 'sequential'
  },
  {
    name: 'submit_section_change',
    label: 'Propose section patch',
    description:
      'Propose a block-hash-guarded change to one section without directly editing it. Every block precondition must copy blockId and blockHash from read_section in this run; insertExistingImage copies one Main-authoritative image from a different source section, while an empty-section insertion omits anchor and uses start or end. Main binds the revision and inserted IDs, and only an applied or satisfied result means the manuscript changed. For an image relocation, remove the original only after insertion applies; never refresh and retry a conflicting source deletion.',
    parameters: parameters(modelSubmitSectionChangeArgsSchema, compactSectionChange),
    executionMode: 'sequential'
  },
  {
    name: 'generate_image',
    label: 'Generate or iterate image',
    description:
      'Propose one generated-image insertion or iteration without directly editing the manuscript. Insert mode uses a root or copied read_section anchor; iterate mode uses only a copied generated source block and replace or insert_after disposition. Main binds revisions, assets, lineage, and block IDs, and only an applied result changes the manuscript. On source conflict call read_section; retry a transient provider failure at most once.',
    parameters: parameters(generateImageArgsSchema),
    executionMode: 'sequential'
  }
] as const satisfies readonly AgentModelVisibleToolSpec[]

export const AGENT_MODEL_VISIBLE_TOOL_ENVELOPE = AGENT_MODEL_VISIBLE_TOOL_SPECS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters
}))

const NOTEBOOK_KNOWLEDGE_TOOL_NAMES = new Set<AgentToolName>(['search_knowledge', 'read_citations'])

export function agentModelVisibleToolSpecs(
  profile: AgentToolProfile
): readonly AgentModelVisibleToolSpec[] {
  if (profile === 'writing') return AGENT_MODEL_VISIBLE_TOOL_SPECS
  return AGENT_MODEL_VISIBLE_TOOL_SPECS.filter((tool) =>
    NOTEBOOK_KNOWLEDGE_TOOL_NAMES.has(tool.name)
  )
}

export function agentToolProfileAllows(
  profile: AgentToolProfile,
  toolName: AgentToolName
): boolean {
  return agentModelVisibleToolSpecs(profile).some((tool) => tool.name === toolName)
}
