import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  briefUpdateSchema,
  mutationCitedSourceSchema,
  mutationProposalRecordSchema,
  outlinePatchSchema,
  sectionPatchSchema,
  type AgentProposalToolName,
  type NormalizedGenerateImageArgs,
  type MutationCitedSource,
  type MutationProposalRecord,
  type OutlinePatch
} from '../../shared/contracts/agent-mutations'
import { agentToolResultPayloadSchema } from '../../shared/contracts/agent-tools'
import {
  blockNoteDocumentSchema,
  manuscriptBriefFieldsSchema,
  type BlockNoteDocument
} from '../../shared/contracts/manuscript'
import type {
  ManuscriptBriefTable,
  ManuscriptTable,
  MutationProposalTable,
  SectionRevisionTable,
  SectionTable
} from '../project/database-types'
import { prepareSectionContent } from '../manuscript/content'
import { assetIdFromUrl, recordRevisionAssetReferences } from '../manuscript/asset-service'
import { AgentToolDomainError } from './read-tools'
import { MutationSimulationError } from './mutation-simulator'
import { MutationProposalError, type ProposalToolExecutionContext } from './mutation-errors'
import { truncateUtf8 } from './session-history'

export function requireToolCall(
  database: Database.Database,
  context: ProposalToolExecutionContext
): { sequence: number } {
  const row = database
    .prepare(
      `SELECT sequence
         FROM agent_events
        WHERE agent_event_id = ? AND agent_session_id = ? AND agent_run_id = ?
          AND type = 'tool_call' AND model_request_id = ?`
    )
    .get(
      context.toolCallEventId,
      context.agentSessionId,
      context.agentRunId,
      context.modelRequestId
    ) as { sequence: number } | undefined
  if (row === undefined) {
    throw new AgentToolDomainError('unauthorized', 'Proposal tool call is unauthorized')
  }
  return row
}

export function resolveCitedSources(
  database: Database.Database,
  context: ProposalToolExecutionContext,
  citationIds: string[],
  beforeSequence: number
): MutationCitedSource[] {
  if (citationIds.length === 0) return []
  const requested = new Set(citationIds)
  const found = new Map<string, MutationCitedSource>()
  const rows = database
    .prepare(
      `SELECT payload_json
         FROM agent_events
        WHERE agent_session_id = ? AND agent_run_id = ? AND type = 'tool_result'
          AND sequence < ?
        ORDER BY sequence DESC`
    )
    .all(context.agentSessionId, context.agentRunId, beforeSequence) as Array<{
    payload_json: string
  }>
  for (const row of rows) {
    const parsed = agentToolResultPayloadSchema.safeParse(JSON.parse(row.payload_json))
    if (
      !parsed.success ||
      parsed.data.isError ||
      parsed.data.result === null ||
      parsed.data.toolName !== 'read_citations'
    )
      continue
    const result = parsed.data.result
    const entries = Array.isArray(result['citations']) ? result['citations'] : []
    for (const entry of entries) {
      const candidate =
        entry !== null && typeof entry === 'object'
          ? (() => {
              const record = entry as Record<string, unknown>
              const text = typeof record['text'] === 'string' ? record['text'] : ''
              return {
                evidenceSchemaVersion: 2,
                citationId: (entry as Record<string, unknown>)['citationId'],
                knowledgeItemId: (entry as Record<string, unknown>)['knowledgeItemId'],
                referenceId: (entry as Record<string, unknown>)['referenceId'],
                citationKey: (entry as Record<string, unknown>)['citationKey'],
                parseRevisionId: (entry as Record<string, unknown>)['parseRevisionId'],
                chunkId: (entry as Record<string, unknown>)['chunkId'],
                sourceBlockIds: (entry as Record<string, unknown>)['sourceBlockIds'],
                excerpt: text.slice(0, 8_192),
                contentHash:
                  typeof record['contentHash'] === 'string'
                    ? record['contentHash']
                    : createHash('sha256').update(text).digest('hex'),
                retrievedAt: new Date(parsed.data.timestamp).toISOString()
              }
            })()
          : entry
      const source = mutationCitedSourceSchema.safeParse(candidate)
      if (source.success && requested.has(source.data.citationId)) {
        found.set(source.data.citationId, source.data)
      }
    }
  }
  const missing = citationIds.filter((citationId) => !found.has(citationId))
  if (missing.length > 0) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'Proposal cites sources that were not read in this Agent run'
    )
  }
  return citationIds.map((citationId) => found.get(citationId) as MutationCitedSource)
}

export function proposalCitationIds(toolName: AgentProposalToolName, rawArgs: unknown): string[] {
  switch (toolName) {
    case 'submit_brief_change':
    case 'submit_writing_rules_change':
      return briefUpdateSchema.parse(rawArgs).citationIds
    case 'submit_outline_change':
      return outlinePatchSchema.parse(rawArgs).citationIds
    case 'submit_section_change':
      return sectionPatchSchema.parse(rawArgs).citationIds
    case 'generate_image':
      return []
  }
}

export function verifyBlockPrecondition(
  document: BlockNoteDocument,
  target: { blockId: string; expectedBlockHash: string }
): void {
  const pending = [...document]
  while (pending.length > 0) {
    const block = pending.shift()
    if (block === undefined) break
    if (block.id === target.blockId) {
      const actual = createHash('sha256').update(JSON.stringify(block)).digest('hex')
      if (actual !== target.expectedBlockHash) {
        throw new AgentToolDomainError('conflict', 'Image anchor changed')
      }
      return
    }
    pending.push(...block.children)
  }
  throw new AgentToolDomainError('conflict', 'Image anchor no longer exists')
}

export function findDocumentBlock(
  document: BlockNoteDocument,
  blockId: string
): BlockNoteDocument[number] | null {
  const pending = [...document]
  while (pending.length > 0) {
    const block = pending.shift()
    if (block === undefined) break
    if (block.id === blockId) return block
    pending.push(...block.children)
  }
  return null
}

export function resolveImageIteration(
  database: Database.Database,
  document: BlockNoteDocument,
  input: NonNullable<NormalizedGenerateImageArgs['iteration']>,
  instruction: string
): {
  sourceBlock: NonNullable<NormalizedGenerateImageArgs['iteration']>['sourceBlock']
  disposition: 'replace' | 'insert_after'
  parentAssetId: string
  parentPrompt: string
} {
  verifyBlockPrecondition(document, input.sourceBlock)
  const block = findDocumentBlock(document, input.sourceBlock.blockId)
  if (block === null || block.type !== 'image' || typeof block.props.url !== 'string') {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'Image iteration requires a current manuscript image block'
    )
  }
  let parentAssetId: string
  try {
    parentAssetId = assetIdFromUrl(block.props.url)
  } catch (err) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'Image iteration requires a project-managed generated image',
      false,
      { cause: err }
    )
  }
  const parent = database
    .prepare(
      `SELECT generation_request_json FROM manuscript_assets
       WHERE asset_id = ? AND source_type = 'generated' AND deletion_state = 'active'`
    )
    .get(parentAssetId) as { generation_request_json: string | null } | undefined
  if (parent?.generation_request_json === null || parent === undefined) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'Only generated images with a retained prompt can be iterated'
    )
  }
  let parentPrompt: unknown
  try {
    parentPrompt = (JSON.parse(parent.generation_request_json) as Record<string, unknown>)['prompt']
  } catch (err) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'The source image generation specification is unavailable',
      false,
      { cause: err }
    )
  }
  if (typeof parentPrompt !== 'string' || parentPrompt.trim().length === 0) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'The source image generation specification is unavailable'
    )
  }
  if (instruction.trim().length === 0) {
    throw new AgentToolDomainError('invalid_arguments', 'Image iteration instruction is required')
  }
  return {
    sourceBlock: input.sourceBlock,
    disposition: input.disposition,
    parentAssetId,
    parentPrompt
  }
}

export function composeImageIterationPrompt(
  parentPrompt: string,
  instruction: string,
  sectionContext: string
): string {
  return truncateImagePromptUtf8(
    [
      'Create a new independent candidate image. Do not describe or edit source pixels.',
      `Original image specification:\n${parentPrompt}`,
      `Requested iteration:\n${instruction}`,
      `Current manuscript section context:\n${sectionContext}`
    ].join('\n\n'),
    16_384
  )
}

export function truncateImagePromptUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value
  return `${truncateUtf8(value, maximumBytes - 3)}…`
}

export function requirePrimaryManuscript(
  database: Database.Database,
  manuscriptId: string
): ManuscriptTable {
  const row = database
    .prepare('SELECT * FROM manuscripts WHERE manuscript_id = ? AND is_primary = 1')
    .get(manuscriptId) as ManuscriptTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Manuscript does not exist')
  return row
}

export function requirePrimaryBrief(
  database: Database.Database,
  manuscriptId: string
): ManuscriptBriefTable {
  requirePrimaryManuscript(database, manuscriptId)
  const row = database
    .prepare(
      'SELECT * FROM manuscript_briefs WHERE manuscript_id = ? ORDER BY version DESC LIMIT 1'
    )
    .get(manuscriptId) as ManuscriptBriefTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Manuscript brief is missing')
  return row
}

export function requireSection(database: Database.Database, sectionId: string): SectionTable {
  const row = database
    .prepare('SELECT * FROM sections WHERE section_id = ? AND deleted_at IS NULL')
    .get(sectionId) as SectionTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Section does not exist')
  return row
}

export function requireUndoableSection(
  database: Database.Database,
  sectionId: string
): SectionTable {
  const row = database.prepare('SELECT * FROM sections WHERE section_id = ?').get(sectionId) as
    | SectionTable
    | undefined
  if (row === undefined || row.deleted_at !== null) {
    throw new MutationProposalError(
      'proposal_not_undoable',
      'The proposal target has been removed from the outline'
    )
  }
  return row
}

export function requireRevision(
  database: Database.Database,
  revisionId: string
): SectionRevisionTable {
  const row = database
    .prepare('SELECT * FROM section_revisions WHERE section_revision_id = ?')
    .get(revisionId) as SectionRevisionTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Section revision is missing')
  return row
}

export function requireProposal(
  database: Database.Database,
  agentSessionId: string,
  proposalId: string
): MutationProposalTable {
  const row = database
    .prepare(
      `SELECT * FROM mutation_proposals
        WHERE mutation_proposal_id = ? AND agent_session_id = ?`
    )
    .get(proposalId, agentSessionId) as MutationProposalTable | undefined
  if (row === undefined) {
    throw new MutationProposalError('proposal_not_found', 'Mutation proposal does not exist')
  }
  return row
}

export function readSections(database: Database.Database, manuscriptId: string): SectionTable[] {
  return database
    .prepare(
      `SELECT * FROM sections
        WHERE manuscript_id = ? AND deleted_at IS NULL
        ORDER BY level, position`
    )
    .all(manuscriptId) as SectionTable[]
}

export function assertOutlineCreateIdsAvailable(
  database: Database.Database,
  mutation: OutlinePatch
): void {
  for (const operation of mutation.operations) {
    if (operation.type !== 'createSection') continue
    const exists = database
      .prepare('SELECT 1 FROM sections WHERE section_id = ?')
      .pluck()
      .get(operation.sectionId)
    if (exists === 1) {
      throw new MutationSimulationError('id_collision', 'Section ID already exists')
    }
  }
}

export function briefFieldsFromRow(row: ManuscriptBriefTable) {
  return manuscriptBriefFieldsSchema.parse({
    title: row.title,
    description: row.description,
    topic: row.topic,
    targetAudience: row.target_audience,
    language: row.language,
    styleTone: row.style_tone,
    scopeExclusions: row.scope_exclusions,
    targetLength: row.target_length,
    citationRequirements: row.citation_requirements,
    additionalInstructions: row.additional_instructions,
    extensible: JSON.parse(row.extensible_json)
  })
}

export function insertSectionRevision(
  database: Database.Database,
  input: {
    revisionId: string
    sectionId: string
    revisionNumber: number
    source: SectionRevisionTable['source']
    sourceClass: SectionRevisionTable['source_class']
    content: BlockNoteDocument
    priorRevisionId: string | null
    agentRunId: string | null
    agentToolCallId: string | null
    agentProposalId: string | null
    createdAt: string
  }
): void {
  const prepared = prepareSectionContent(
    blockNoteDocumentSchema.parse(input.content),
    input.sectionId
  )
  database
    .prepare(
      `INSERT INTO section_revisions (
         section_revision_id, section_id, revision_number, source, source_class,
         content_json, content_schema_version, content_hash, prior_revision_id,
         word_count, character_count, count_algorithm_version, agent_run_id,
         agent_tool_call_id, agent_proposal_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.revisionId,
      input.sectionId,
      input.revisionNumber,
      input.source,
      input.sourceClass,
      prepared.contentJson,
      prepared.contentSchemaVersion,
      prepared.contentHash,
      input.priorRevisionId,
      prepared.wordCount,
      prepared.characterCount,
      prepared.countAlgorithmVersion,
      input.agentRunId,
      input.agentToolCallId,
      input.agentProposalId,
      input.createdAt
    )
  recordRevisionAssetReferences(database, input.revisionId, prepared.content, input.createdAt)
}

export function updateAppliedProposal(
  database: Database.Database,
  proposalId: string,
  now: string,
  result:
    | { appliedRevisionId: string }
    | { appliedBriefVersion: number }
    | { appliedOutlineVersion: number }
): void {
  const appliedRevisionId = 'appliedRevisionId' in result ? result.appliedRevisionId : null
  const appliedBriefVersion = 'appliedBriefVersion' in result ? result.appliedBriefVersion : null
  const appliedOutlineVersion =
    'appliedOutlineVersion' in result ? result.appliedOutlineVersion : null
  const changed = database
    .prepare(
      `UPDATE mutation_proposals
          SET status = 'applied', decision_at = ?, applied_revision_id = ?,
              applied_brief_version = ?, applied_outline_version = ?, updated_at = ?
        WHERE mutation_proposal_id = ? AND status IN ('pending', 'generating')`
    )
    .run(now, appliedRevisionId, appliedBriefVersion, appliedOutlineVersion, now, proposalId)
  if (changed.changes !== 1) {
    throw new MutationProposalError(
      'proposal_not_pending',
      'Mutation proposal is no longer pending'
    )
  }
}

export function updateTerminalProposal(
  database: Database.Database,
  proposalId: string,
  status: 'superseded' | 'conflicted' | 'satisfied',
  reason: string,
  now: string
): MutationProposalRecord {
  const changed = database
    .prepare(
      `UPDATE mutation_proposals
          SET status = ?, decision_at = COALESCE(decision_at, ?), rejected_reason = ?, updated_at = ?
        WHERE mutation_proposal_id = ? AND status IN ('pending', 'generating')`
    )
    .run(status, now, reason.slice(0, 4_096), now, proposalId)
  if (changed.changes !== 1) {
    throw new MutationProposalError(
      'proposal_not_pending',
      'Mutation proposal is no longer pending'
    )
  }
  return proposalFromRow(
    database
      .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
      .get(proposalId) as MutationProposalTable
  )
}

export function proposalFromRow(row: MutationProposalTable): MutationProposalRecord {
  return mutationProposalRecordSchema.parse({
    proposalId: row.mutation_proposal_id,
    agentSessionId: row.agent_session_id,
    agentRunId: row.agent_run_id,
    agentToolCallId: row.agent_tool_call_id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    decisionAt: row.decision_at,
    appliedRevisionId: row.applied_revision_id,
    appliedBriefVersion: row.applied_brief_version,
    appliedOutlineVersion: row.applied_outline_version,
    undoRevisionId: row.undo_revision_id,
    replacesProposalId: row.replaces_proposal_id,
    rejectedReason: row.rejected_reason,
    writingTaskId: row.writing_task_id,
    writingTaskStepId: row.writing_task_step_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}

export function staleBase(kind: 'brief' | 'outline' | 'section'): MutationProposalError {
  return new MutationProposalError('stale_base', `The ${kind} base has changed`)
}

export function abortedToolError(cause?: unknown): AgentToolDomainError {
  return new AgentToolDomainError('aborted', 'Mutation proposal was aborted', true, { cause })
}

export function isDeterministicApplyFailure(err: unknown): boolean {
  return (
    err instanceof MutationProposalError ||
    err instanceof MutationSimulationError ||
    err instanceof AgentToolDomainError
  )
}

export function safeFailureReason(err: unknown): string {
  if (
    err instanceof MutationProposalError ||
    err instanceof MutationSimulationError ||
    err instanceof AgentToolDomainError
  ) {
    return err.message.slice(0, 4_096)
  }
  return 'Mutation proposal could not be applied'
}

export function validateMutationAssetReferences(
  database: Database.Database,
  mutation: unknown
): void {
  const assetIds = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const match = /^writellm-asset:([0-9a-f-]+)$/iu.exec(value)
      if (match?.[1] !== undefined) assetIds.add(match[1])
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item)
    }
  }
  visit(mutation)
  for (const assetId of assetIds) {
    const active = database
      .prepare("SELECT 1 FROM manuscript_assets WHERE asset_id = ? AND deletion_state = 'active'")
      .pluck()
      .get(assetId)
    if (active !== 1) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Mutation references an unavailable manuscript asset'
      )
    }
  }
}
