import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  AGENT_MUTATION_PREVIEW_TEXT_LIMIT,
  approveMutationProposalInputSchema,
  briefUpdateSchema,
  mutationCitedSourceSchema,
  mutationPreviewSchema,
  mutationProposalActionResultSchema,
  mutationProposalRecordSchema,
  mutationProposalToolResultSchema,
  outlinePatchSchema,
  persistedMutationProposalPayloadSchema,
  rejectMutationProposalInputSchema,
  sectionPatchSchema,
  undoMutationProposalInputSchema,
  type AgentProposalToolName,
  type BriefUpdate,
  type MutationCitedSource,
  type MutationPreview,
  type MutationProposalRecord,
  type MutationProposalToolResult,
  type OutlineMutationOperation,
  type OutlinePatch,
  type SectionPatch
} from '../../shared/contracts/agent-mutations'
import { agentToolResultPayloadSchema } from '../../shared/contracts/agent-tools'
import {
  blockNoteDocumentSchema,
  manuscriptBriefFieldsSchema,
  MAX_MANUSCRIPT_OUTLINE_DEPTH,
  MAX_MANUSCRIPT_SECTIONS,
  type BlockNoteDocument
} from '../../shared/contracts/manuscript'
import type {
  ManuscriptBriefTable,
  ManuscriptTable,
  MutationProposalTable,
  SectionRevisionTable,
  SectionTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { prepareSectionContent } from '../manuscript/content'
import type { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import { AgentToolDomainError } from './read-tools'
import { MutationSimulationError, simulateSectionPatch } from './mutation-simulator'

const MAX_PROPOSAL_PAYLOAD_BYTES = 1_048_576

export interface ProposalToolExecutionContext {
  agentSessionId: string
  agentRunId: string
  toolCallId: string
  toolCallEventId: string
  modelRequestId: string
  signal: AbortSignal
}

export class MutationProposalError extends Error {
  constructor(
    readonly code:
      | 'proposal_not_found'
      | 'proposal_not_pending'
      | 'proposal_not_applied'
      | 'proposal_not_undoable'
      | 'stale_base'
      | 'invalid_proposal',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MutationProposalError'
  }
}

interface OutlineNode {
  sectionId: string
  parentSectionId: string | null
  position: number
  level: number
  title: string
  objective: string | null
  status: 'planned' | 'drafting' | 'completed'
}

interface OutlineSimulation {
  nodes: OutlineNode[]
  affectedSectionIds: string[]
  beforeText: string
  afterText: string
}

interface ApplyTransactionResult {
  proposal: MutationProposalRecord
  materializeRevisionIds: string[]
  removeMaterializationSectionIds: string[]
  sectionChanged: {
    sectionId: string
    sectionRevisionId: string
    reason: 'applied' | 'undone'
  } | null
}

export class MutationProposalService {
  readonly #now: () => Date
  readonly #createId: () => string

  constructor(
    private readonly options: {
      projectId: string
      projectSessionId: string
      database: ProjectDatabase
      manuscript: ManuscriptService
      editorPersistence: EditorPersistenceService
      log: Pick<Logger, 'info' | 'warn' | 'error'>
      now?: () => Date
      createId?: () => string
    }
  ) {
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  list(agentSessionId: string): MutationProposalRecord[] {
    const sessionExists = this.options.database.immediate((database) =>
      database
        .prepare('SELECT 1 FROM agent_sessions WHERE agent_session_id = ?')
        .pluck()
        .get(agentSessionId)
    )
    if (sessionExists !== 1) {
      throw new MutationProposalError('proposal_not_found', 'Agent session does not exist')
    }
    return this.options.database.immediate((database) =>
      (
        database
          .prepare(
            `SELECT * FROM mutation_proposals
              WHERE agent_session_id = ?
              ORDER BY created_at, mutation_proposal_id
              LIMIT 1000`
          )
          .all(agentSessionId) as MutationProposalTable[]
      ).map(proposalFromRow)
    )
  }

  propose(
    toolName: AgentProposalToolName,
    rawArgs: unknown,
    context: ProposalToolExecutionContext
  ): MutationProposalToolResult {
    if (context.signal.aborted) throw abortedToolError()
    const startedAt = Date.now()
    try {
      const proposalId = this.#createId()
      const result = this.options.database.immediate((database) => {
        const call = requireToolCall(database, context)
        const citedSources = resolveCitedSources(
          database,
          context,
          proposalCitationIds(toolName, rawArgs),
          call.sequence
        )
        const prepared = this.#prepareProposal(database, toolName, rawArgs, citedSources)
        const payload = persistedMutationProposalPayloadSchema.parse({
          schemaVersion: 1,
          kind: prepared.kind,
          mutation: prepared.mutation,
          preview: prepared.preview,
          provenance: { modelRequestId: context.modelRequestId, citedSources }
        })
        const payloadJson = JSON.stringify(payload)
        if (Buffer.byteLength(payloadJson) > MAX_PROPOSAL_PAYLOAD_BYTES) {
          throw new AgentToolDomainError('result_too_large', 'Mutation proposal is too large')
        }
        const now = this.#now().toISOString()
        database
          .prepare(
            `INSERT INTO mutation_proposals (
               mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
               agent_tool_call_id, kind, payload_json, base_revision_id,
               base_brief_version, base_outline_version, status, decision_at,
               applied_revision_id, applied_brief_version, applied_outline_version,
               undo_revision_id, rejected_reason, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL,
                       NULL, NULL, NULL, NULL, NULL, ?, ?)`
          )
          .run(
            proposalId,
            context.agentSessionId,
            context.agentRunId,
            context.toolCallEventId,
            context.toolCallId,
            prepared.kind,
            payloadJson,
            prepared.kind === 'section_patch' ? prepared.mutation.baseRevisionId : null,
            prepared.kind === 'brief_update' ? prepared.mutation.baseBriefVersion : null,
            prepared.kind === 'outline_patch' ? prepared.mutation.baseOutlineVersion : null,
            now,
            now
          )
        return mutationProposalToolResultSchema.parse({
          proposalId,
          kind: prepared.kind,
          status: 'pending',
          preview: prepared.preview
        })
      })
      this.options.log.info(
        {
          event: 'agent.mutation.proposed',
          proposalId: result.proposalId,
          agentRunId: context.agentRunId,
          toolCallId: context.toolCallId,
          kind: result.kind,
          durationMs: Date.now() - startedAt
        },
        'Agent mutation proposal persisted'
      )
      return result
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.mutation.propose_failed',
          err,
          agentRunId: context.agentRunId,
          toolCallId: context.toolCallId,
          toolName,
          durationMs: Date.now() - startedAt
        },
        'Agent mutation proposal failed'
      )
      if (context.signal.aborted) throw abortedToolError(err)
      if (err instanceof AgentToolDomainError) throw err
      if (err instanceof MutationProposalError) {
        if (err.code === 'stale_base') {
          throw new AgentToolDomainError(
            'conflict',
            `${err.message}. Call get_writing_context and retry once with the refreshed version.`,
            true,
            { cause: err }
          )
        }
        throw new AgentToolDomainError(
          err.code === 'invalid_proposal' ? 'invalid_arguments' : 'conflict',
          err.message,
          false,
          { cause: err }
        )
      }
      if (err instanceof MutationSimulationError) {
        throw new AgentToolDomainError('invalid_arguments', err.message, false, { cause: err })
      }
      throw new AgentToolDomainError('internal', 'Mutation proposal failed', false, { cause: err })
    }
  }

  async approve(rawInput: unknown) {
    const input = approveMutationProposalInputSchema.parse(rawInput)
    this.#assertProjectSession(input.projectSessionId)
    return this.#applyDecision(input.agentSessionId, input.proposalId, 'apply')
  }

  reject(rawInput: unknown) {
    const input = rejectMutationProposalInputSchema.parse(rawInput)
    this.#assertProjectSession(input.projectSessionId)
    const startedAt = Date.now()
    try {
      const proposal = this.options.database.immediate((database) => {
        const row = requireProposal(database, input.agentSessionId, input.proposalId)
        if (row.status !== 'pending') {
          throw new MutationProposalError(
            'proposal_not_pending',
            'Mutation proposal is no longer pending'
          )
        }
        const now = this.#now().toISOString()
        const changed = database
          .prepare(
            `UPDATE mutation_proposals
                SET status = 'rejected', decision_at = ?, rejected_reason = ?, updated_at = ?
              WHERE mutation_proposal_id = ? AND status = 'pending'`
          )
          .run(now, input.reason, now, input.proposalId)
        if (changed.changes !== 1) {
          throw new MutationProposalError(
            'proposal_not_pending',
            'Mutation proposal is no longer pending'
          )
        }
        return proposalFromRow(
          database
            .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
            .get(input.proposalId) as MutationProposalTable
        )
      })
      this.options.log.info(
        {
          event: 'agent.mutation.rejected',
          proposalId: input.proposalId,
          agentSessionId: input.agentSessionId,
          durationMs: Date.now() - startedAt
        },
        'Agent mutation proposal rejected'
      )
      return mutationProposalActionResultSchema.parse({ proposal, sectionChanged: null })
    } catch (err) {
      this.#logDecisionFailure('agent.mutation.reject_failed', err, input.proposalId, startedAt)
      throw err
    }
  }

  async undo(rawInput: unknown) {
    const input = undoMutationProposalInputSchema.parse(rawInput)
    this.#assertProjectSession(input.projectSessionId)
    return this.#applyDecision(input.agentSessionId, input.proposalId, 'undo')
  }

  #assertProjectSession(projectSessionId: string): void {
    if (projectSessionId !== this.options.projectSessionId) {
      throw new MutationProposalError('proposal_not_found', 'Project session is not active')
    }
  }

  #prepareProposal(
    database: Database.Database,
    toolName: AgentProposalToolName,
    rawArgs: unknown,
    citedSources: MutationCitedSource[]
  ):
    | { kind: 'brief_update'; mutation: BriefUpdate; preview: MutationPreview }
    | { kind: 'outline_patch'; mutation: OutlinePatch; preview: MutationPreview }
    | { kind: 'section_patch'; mutation: SectionPatch; preview: MutationPreview } {
    switch (toolName) {
      case 'propose_brief_update': {
        const mutation = briefUpdateSchema.parse(rawArgs)
        const current = requirePrimaryBrief(database, mutation.manuscriptId)
        if (current.version !== mutation.baseBriefVersion) throw staleBase('brief')
        const before = briefFieldsFromRow(current)
        const after = manuscriptBriefFieldsSchema.parse({ ...before, ...mutation.changes })
        if (JSON.stringify(after) === JSON.stringify(before)) {
          throw new MutationSimulationError('no_change', 'Brief update does not change the brief')
        }
        return {
          kind: 'brief_update',
          mutation,
          preview: createPreview({
            summary: 'Update the manuscript brief',
            affectedSectionIds: [],
            beforeText: JSON.stringify(before, null, 2),
            afterText: JSON.stringify(after, null, 2),
            citedSources
          })
        }
      }
      case 'propose_outline_patch': {
        const mutation = outlinePatchSchema.parse(rawArgs)
        const manuscript = requirePrimaryManuscript(database, mutation.manuscriptId)
        if (manuscript.outline_version !== mutation.baseOutlineVersion) throw staleBase('outline')
        assertOutlineCreateIdsAvailable(database, mutation)
        const simulation = simulateOutline(
          readSections(database, manuscript.manuscript_id),
          mutation
        )
        return {
          kind: 'outline_patch',
          mutation,
          preview: createPreview({
            summary: `Apply ${mutation.operations.length} outline operation${mutation.operations.length === 1 ? '' : 's'}`,
            affectedSectionIds: simulation.affectedSectionIds,
            beforeText: simulation.beforeText,
            afterText: simulation.afterText,
            citedSources
          })
        }
      }
      case 'propose_section_patch': {
        const mutation = sectionPatchSchema.parse(rawArgs)
        const section = requireSection(database, mutation.sectionId)
        if (section.current_revision_id !== mutation.baseRevisionId) throw staleBase('section')
        const revision = requireRevision(database, mutation.baseRevisionId)
        if (
          revision.section_id !== section.section_id ||
          Number(revision.content_body_retained) !== 1
        ) {
          throw new AgentToolDomainError('not_found', 'Section base revision is unavailable')
        }
        const simulation = simulateSectionPatch(
          blockNoteDocumentSchema.parse(JSON.parse(revision.content_json)),
          mutation
        )
        return {
          kind: 'section_patch',
          mutation,
          preview: createPreview({
            summary: `Apply ${mutation.operations.length} section operation${mutation.operations.length === 1 ? '' : 's'}`,
            affectedSectionIds: [mutation.sectionId],
            beforeText: simulation.beforeText,
            afterText: simulation.afterText,
            citedSources
          })
        }
      }
    }
  }

  async #applyDecision(agentSessionId: string, proposalId: string, decision: 'apply' | 'undo') {
    const startedAt = Date.now()
    let transactionResult: ApplyTransactionResult
    try {
      transactionResult = this.options.database.immediate((database) =>
        decision === 'apply'
          ? this.#applyProposal(database, agentSessionId, proposalId)
          : this.#undoProposal(database, agentSessionId, proposalId)
      )
    } catch (err) {
      this.#logDecisionFailure(
        decision === 'apply' ? 'agent.mutation.apply_failed' : 'agent.mutation.undo_failed',
        err,
        proposalId,
        startedAt
      )
      if (decision === 'apply' && isDeterministicApplyFailure(err)) {
        this.#recordApplyFailure(agentSessionId, proposalId, err)
      }
      throw err
    }

    for (const revisionId of transactionResult.materializeRevisionIds) {
      try {
        await this.options.editorPersistence.materialize(
          this.options.manuscript.getRevision(revisionId)
        )
      } catch (err) {
        this.options.log.error(
          {
            event: 'agent.mutation.materialization_failed',
            err,
            proposalId,
            sectionRevisionId: revisionId
          },
          'Applied Agent revision is authoritative but materialization is pending repair'
        )
      }
    }
    for (const sectionId of transactionResult.removeMaterializationSectionIds) {
      try {
        await this.options.editorPersistence.removeMaterialization(sectionId)
      } catch (err) {
        this.options.log.error(
          { event: 'agent.mutation.materialization_remove_failed', err, proposalId, sectionId },
          'Deleted Agent outline section materialization cleanup failed'
        )
      }
    }

    const sectionChanged =
      transactionResult.sectionChanged === null
        ? null
        : {
            projectSessionId: this.options.projectSessionId,
            proposalId,
            ...transactionResult.sectionChanged
          }
    const result = mutationProposalActionResultSchema.parse({
      proposal: transactionResult.proposal,
      sectionChanged
    })
    this.options.log.info(
      {
        event: decision === 'apply' ? 'agent.mutation.applied' : 'agent.mutation.undone',
        proposalId,
        agentSessionId,
        kind: result.proposal.kind,
        sectionRevisionId: sectionChanged?.sectionRevisionId,
        durationMs: Date.now() - startedAt
      },
      decision === 'apply' ? 'Agent mutation proposal applied' : 'Agent section mutation undone'
    )
    return result
  }

  #applyProposal(
    database: Database.Database,
    agentSessionId: string,
    proposalId: string
  ): ApplyTransactionResult {
    const row = requireProposal(database, agentSessionId, proposalId)
    if (row.status !== 'pending') {
      throw new MutationProposalError(
        'proposal_not_pending',
        'Mutation proposal is no longer pending'
      )
    }
    const payload = persistedMutationProposalPayloadSchema.parse(JSON.parse(row.payload_json))
    const now = this.#now().toISOString()
    let materializeRevisionIds: string[] = []
    let removeMaterializationSectionIds: string[] = []
    let sectionChanged: ApplyTransactionResult['sectionChanged'] = null

    switch (payload.kind) {
      case 'brief_update': {
        const mutation = payload.mutation
        const current = requirePrimaryBrief(database, mutation.manuscriptId)
        if (current.version !== mutation.baseBriefVersion) throw staleBase('brief')
        const fields = manuscriptBriefFieldsSchema.parse({
          ...briefFieldsFromRow(current),
          ...mutation.changes
        })
        database
          .prepare(
            `INSERT INTO manuscript_briefs (
               manuscript_brief_id, manuscript_id, version, schema_version, title,
               description, topic, target_audience, language, style_tone, scope_exclusions,
               target_length, citation_requirements, additional_instructions,
               extensible_json, created_at, updated_at
             ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            this.#createId(),
            mutation.manuscriptId,
            mutation.baseBriefVersion + 1,
            fields.title,
            fields.description,
            fields.topic,
            fields.targetAudience,
            fields.language,
            fields.styleTone,
            fields.scopeExclusions,
            fields.targetLength,
            fields.citationRequirements,
            fields.additionalInstructions,
            JSON.stringify(fields.extensible),
            now,
            now
          )
        updateAppliedProposal(database, proposalId, now, {
          appliedBriefVersion: mutation.baseBriefVersion + 1
        })
        break
      }
      case 'outline_patch': {
        const mutation = payload.mutation
        const manuscript = requirePrimaryManuscript(database, mutation.manuscriptId)
        if (manuscript.outline_version !== mutation.baseOutlineVersion) throw staleBase('outline')
        const beforeRows = readSections(database, mutation.manuscriptId)
        assertOutlineCreateIdsAvailable(database, mutation)
        const simulation = simulateOutline(beforeRows, mutation)
        const beforeIds = new Set(beforeRows.map((section) => section.section_id))
        const afterIds = new Set(simulation.nodes.map((section) => section.sectionId))
        const created = simulation.nodes.filter((section) => !beforeIds.has(section.sectionId))
        const deleted = beforeRows.filter((section) => !afterIds.has(section.section_id))
        const revisionIds = new Map(created.map((section) => [section.sectionId, this.#createId()]))

        database
          .prepare(
            `UPDATE sections SET position = position + 1000000
              WHERE manuscript_id = ? AND deleted_at IS NULL`
          )
          .run(mutation.manuscriptId)
        for (const node of [...created].sort((left, right) => left.level - right.level)) {
          database
            .prepare(
              `INSERT INTO sections (
                 section_id, manuscript_id, parent_section_id, position, level, title,
                 objective, status, current_revision_id, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              node.sectionId,
              mutation.manuscriptId,
              node.parentSectionId,
              node.position,
              node.level,
              node.title,
              node.objective,
              node.status,
              revisionIds.get(node.sectionId),
              now,
              now
            )
        }
        for (const node of simulation.nodes.filter((section) => beforeIds.has(section.sectionId))) {
          database
            .prepare(
              `UPDATE sections
                  SET parent_section_id = ?, position = ?, level = ?, title = ?,
                      objective = ?, status = ?, updated_at = ?
                WHERE section_id = ? AND manuscript_id = ? AND deleted_at IS NULL`
            )
            .run(
              node.parentSectionId,
              node.position,
              node.level,
              node.title,
              node.objective,
              node.status,
              now,
              node.sectionId,
              mutation.manuscriptId
            )
        }
        for (const section of [...deleted].sort((left, right) => right.level - left.level)) {
          const tombstoned = database
            .prepare(
              `UPDATE sections SET deleted_at = ?, updated_at = ?
                WHERE section_id = ? AND deleted_at IS NULL`
            )
            .run(now, now, section.section_id)
          if (tombstoned.changes !== 1) {
            throw new MutationSimulationError('target_missing', 'Outline section does not exist')
          }
          database
            .prepare('DELETE FROM section_materializations WHERE section_id = ?')
            .run(section.section_id)
        }
        for (const node of created) {
          const revisionId = revisionIds.get(node.sectionId) as string
          insertSectionRevision(database, {
            revisionId,
            sectionId: node.sectionId,
            revisionNumber: 1,
            source: 'bootstrap',
            sourceClass: 'manual_checkpoint',
            content: [],
            priorRevisionId: null,
            agentRunId: null,
            agentToolCallId: null,
            agentProposalId: null,
            createdAt: now
          })
          materializeRevisionIds.push(revisionId)
        }
        const outlineUpdate = database
          .prepare(
            `UPDATE manuscripts
                SET outline_version = outline_version + 1, updated_at = ?
              WHERE manuscript_id = ? AND outline_version = ?`
          )
          .run(now, mutation.manuscriptId, mutation.baseOutlineVersion)
        if (outlineUpdate.changes !== 1) throw staleBase('outline')
        updateAppliedProposal(database, proposalId, now, {
          appliedOutlineVersion: mutation.baseOutlineVersion + 1
        })
        removeMaterializationSectionIds = deleted.map((section) => section.section_id)
        break
      }
      case 'section_patch': {
        const mutation = payload.mutation
        const section = requireSection(database, mutation.sectionId)
        if (section.current_revision_id !== mutation.baseRevisionId) throw staleBase('section')
        const base = requireRevision(database, mutation.baseRevisionId)
        if (base.section_id !== mutation.sectionId || Number(base.content_body_retained) !== 1) {
          throw new MutationProposalError('stale_base', 'Section base revision is unavailable')
        }
        const simulation = simulateSectionPatch(
          blockNoteDocumentSchema.parse(JSON.parse(base.content_json)),
          mutation
        )
        const revisionId = this.#createId()
        insertSectionRevision(database, {
          revisionId,
          sectionId: mutation.sectionId,
          revisionNumber: base.revision_number + 1,
          source: 'agent',
          sourceClass: 'agent_accepted',
          content: simulation.document,
          priorRevisionId: base.section_revision_id,
          agentRunId: row.agent_run_id,
          agentToolCallId: row.agent_tool_call_id,
          agentProposalId: proposalId,
          createdAt: now
        })
        const sectionUpdate = database
          .prepare(
            `UPDATE sections SET current_revision_id = ?, updated_at = ?
              WHERE section_id = ? AND current_revision_id = ? AND deleted_at IS NULL`
          )
          .run(revisionId, now, mutation.sectionId, mutation.baseRevisionId)
        if (sectionUpdate.changes !== 1) throw staleBase('section')
        updateAppliedProposal(database, proposalId, now, { appliedRevisionId: revisionId })
        materializeRevisionIds = [revisionId]
        sectionChanged = {
          sectionId: mutation.sectionId,
          sectionRevisionId: revisionId,
          reason: 'applied'
        }
        break
      }
    }

    const applied = database
      .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
      .get(proposalId) as MutationProposalTable
    return {
      proposal: proposalFromRow(applied),
      materializeRevisionIds,
      removeMaterializationSectionIds,
      sectionChanged
    }
  }

  #undoProposal(
    database: Database.Database,
    agentSessionId: string,
    proposalId: string
  ): ApplyTransactionResult {
    const row = requireProposal(database, agentSessionId, proposalId)
    if (row.kind !== 'section_patch') {
      throw new MutationProposalError(
        'proposal_not_undoable',
        'Only applied section proposals can be undone'
      )
    }
    if (row.status !== 'applied' || row.applied_revision_id === null) {
      throw new MutationProposalError(
        'proposal_not_applied',
        'Section proposal is not in an applied state'
      )
    }
    const applied = requireRevision(database, row.applied_revision_id)
    const section = requireUndoableSection(database, applied.section_id)
    if (section.current_revision_id !== applied.section_revision_id) {
      throw new MutationProposalError(
        'stale_base',
        'Section changed after the proposal was applied'
      )
    }
    if (applied.prior_revision_id === null) {
      throw new MutationProposalError('proposal_not_undoable', 'Applied revision has no parent')
    }
    const parent = requireRevision(database, applied.prior_revision_id)
    if (Number(parent.content_body_retained) !== 1) {
      throw new MutationProposalError(
        'proposal_not_undoable',
        'The pre-Agent revision body is unavailable'
      )
    }
    const now = this.#now().toISOString()
    const undoRevisionId = this.#createId()
    insertSectionRevision(database, {
      revisionId: undoRevisionId,
      sectionId: section.section_id,
      revisionNumber: applied.revision_number + 1,
      source: 'undo',
      sourceClass: 'manual_checkpoint',
      content: blockNoteDocumentSchema.parse(JSON.parse(parent.content_json)),
      priorRevisionId: applied.section_revision_id,
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null,
      createdAt: now
    })
    const sectionUpdate = database
      .prepare(
        `UPDATE sections SET current_revision_id = ?, updated_at = ?
          WHERE section_id = ? AND current_revision_id = ? AND deleted_at IS NULL`
      )
      .run(undoRevisionId, now, section.section_id, applied.section_revision_id)
    if (sectionUpdate.changes !== 1) throw staleBase('section')
    const proposalUpdate = database
      .prepare(
        `UPDATE mutation_proposals
            SET status = 'undone', undo_revision_id = ?, updated_at = ?
          WHERE mutation_proposal_id = ? AND status = 'applied'`
      )
      .run(undoRevisionId, now, proposalId)
    if (proposalUpdate.changes !== 1) {
      throw new MutationProposalError(
        'proposal_not_applied',
        'Section proposal is not in an applied state'
      )
    }
    const updated = database
      .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
      .get(proposalId) as MutationProposalTable
    return {
      proposal: proposalFromRow(updated),
      materializeRevisionIds: [undoRevisionId],
      removeMaterializationSectionIds: [],
      sectionChanged: {
        sectionId: section.section_id,
        sectionRevisionId: undoRevisionId,
        reason: 'undone'
      }
    }
  }

  #recordApplyFailure(agentSessionId: string, proposalId: string, err: unknown): void {
    const reason = safeFailureReason(err)
    try {
      this.options.database.immediate((database) => {
        const row = requireProposal(database, agentSessionId, proposalId)
        if (row.status !== 'pending') return
        const now = this.#now().toISOString()
        database
          .prepare(
            `UPDATE mutation_proposals
                SET status = 'failed', decision_at = ?, rejected_reason = ?, updated_at = ?
              WHERE mutation_proposal_id = ? AND status = 'pending'`
          )
          .run(now, reason, now, proposalId)
      })
    } catch (recordErr) {
      this.options.log.error(
        { event: 'agent.mutation.failure_record_failed', err: recordErr, proposalId },
        'Agent mutation application failure could not be recorded'
      )
    }
  }

  #logDecisionFailure(event: string, err: unknown, proposalId: string, startedAt: number): void {
    this.options.log.error(
      { event, err, proposalId, durationMs: Date.now() - startedAt },
      'Agent mutation decision failed'
    )
  }
}

function requireToolCall(
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

function resolveCitedSources(
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
    if (!parsed.success || parsed.data.isError || parsed.data.result === null) continue
    const result = parsed.data.result
    const entries = Array.isArray(result['hits'])
      ? result['hits']
      : Array.isArray(result['citations'])
        ? result['citations']
        : []
    for (const entry of entries) {
      const candidate =
        entry !== null && typeof entry === 'object'
          ? {
              citationId: (entry as Record<string, unknown>)['citationId'],
              knowledgeItemId: (entry as Record<string, unknown>)['knowledgeItemId'],
              parseRevisionId: (entry as Record<string, unknown>)['parseRevisionId'],
              chunkId: (entry as Record<string, unknown>)['chunkId'],
              sourceBlockIds: (entry as Record<string, unknown>)['sourceBlockIds']
            }
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

function proposalCitationIds(toolName: AgentProposalToolName, rawArgs: unknown): string[] {
  switch (toolName) {
    case 'propose_brief_update':
      return briefUpdateSchema.parse(rawArgs).citationIds
    case 'propose_outline_patch':
      return outlinePatchSchema.parse(rawArgs).citationIds
    case 'propose_section_patch':
      return sectionPatchSchema.parse(rawArgs).citationIds
  }
}

function requirePrimaryManuscript(
  database: Database.Database,
  manuscriptId: string
): ManuscriptTable {
  const row = database
    .prepare('SELECT * FROM manuscripts WHERE manuscript_id = ? AND is_primary = 1')
    .get(manuscriptId) as ManuscriptTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Manuscript does not exist')
  return row
}

function requirePrimaryBrief(
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

function requireSection(database: Database.Database, sectionId: string): SectionTable {
  const row = database
    .prepare('SELECT * FROM sections WHERE section_id = ? AND deleted_at IS NULL')
    .get(sectionId) as SectionTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Section does not exist')
  return row
}

function requireUndoableSection(database: Database.Database, sectionId: string): SectionTable {
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

function requireRevision(database: Database.Database, revisionId: string): SectionRevisionTable {
  const row = database
    .prepare('SELECT * FROM section_revisions WHERE section_revision_id = ?')
    .get(revisionId) as SectionRevisionTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Section revision is missing')
  return row
}

function requireProposal(
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

function readSections(database: Database.Database, manuscriptId: string): SectionTable[] {
  return database
    .prepare(
      `SELECT * FROM sections
        WHERE manuscript_id = ? AND deleted_at IS NULL
        ORDER BY level, position`
    )
    .all(manuscriptId) as SectionTable[]
}

function assertOutlineCreateIdsAvailable(
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

function briefFieldsFromRow(row: ManuscriptBriefTable) {
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

function createPreview(input: {
  summary: string
  affectedSectionIds: string[]
  beforeText: string
  afterText: string
  citedSources: MutationCitedSource[]
}): MutationPreview {
  const before = truncateUtf8(input.beforeText, AGENT_MUTATION_PREVIEW_TEXT_LIMIT)
  const after = truncateUtf8(input.afterText, AGENT_MUTATION_PREVIEW_TEXT_LIMIT)
  return mutationPreviewSchema.parse({
    summary: input.summary,
    affectedSectionIds: [...new Set(input.affectedSectionIds)],
    beforeText: before.text,
    afterText: after.text,
    beforeTextTruncated: before.truncated,
    afterTextTruncated: after.truncated,
    citedSources: input.citedSources
  })
}

function truncateUtf8(value: string, maximumBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= maximumBytes) return { text: value, truncated: false }
  return { text: bytes.subarray(0, maximumBytes).toString('utf8'), truncated: true }
}

function simulateOutline(rows: SectionTable[], patch: OutlinePatch): OutlineSimulation {
  const before = rows.map(outlineNodeFromRow)
  let nodes = before.map((node) => ({ ...node }))
  const affected = new Set<string>()
  for (const operation of patch.operations) {
    nodes = applyOutlineOperation(nodes, operation, affected)
    normalizeOutline(nodes)
  }
  if (nodes.length > MAX_MANUSCRIPT_SECTIONS) {
    throw new MutationSimulationError('invalid_result', 'Outline contains too many sections')
  }
  if (JSON.stringify(nodes) === JSON.stringify(before)) {
    throw new MutationSimulationError('no_change', 'Outline patch does not change the outline')
  }
  return {
    nodes,
    affectedSectionIds: [...affected],
    beforeText: renderOutline(before),
    afterText: renderOutline(nodes)
  }
}

function applyOutlineOperation(
  source: OutlineNode[],
  operation: OutlineMutationOperation,
  affected: Set<string>
): OutlineNode[] {
  const nodes = source.map((node) => ({ ...node }))
  switch (operation.type) {
    case 'createSection': {
      if (nodes.some((node) => node.sectionId === operation.sectionId)) {
        throw new MutationSimulationError('id_collision', 'Section ID already exists')
      }
      requireOutlineParent(nodes, operation.parentSectionId)
      const siblings = outlineSiblings(nodes, operation.parentSectionId)
      if (operation.position > siblings.length) {
        throw new MutationSimulationError('invalid_result', 'Section position is invalid')
      }
      shiftSiblingPositions(nodes, operation.parentSectionId, operation.position, 1)
      nodes.push({
        sectionId: operation.sectionId,
        parentSectionId: operation.parentSectionId,
        position: operation.position,
        level: 1,
        title: operation.title,
        objective: operation.objective,
        status: operation.status
      })
      affected.add(operation.sectionId)
      break
    }
    case 'updateSection': {
      const target = requireOutlineNode(nodes, operation.sectionId)
      target.title = operation.title ?? target.title
      target.objective = operation.objective === undefined ? target.objective : operation.objective
      target.status = operation.status ?? target.status
      affected.add(target.sectionId)
      break
    }
    case 'moveSection': {
      const target = requireOutlineNode(nodes, operation.sectionId)
      requireOutlineParent(nodes, operation.parentSectionId)
      if (
        operation.parentSectionId === target.sectionId ||
        descendants(nodes, target.sectionId).has(operation.parentSectionId ?? '')
      ) {
        throw new MutationSimulationError('invalid_result', 'Section move creates a cycle')
      }
      const destination = outlineSiblings(nodes, operation.parentSectionId).filter(
        (node) => node.sectionId !== target.sectionId
      )
      if (operation.position > destination.length) {
        throw new MutationSimulationError('invalid_result', 'Section position is invalid')
      }
      const oldParent = target.parentSectionId
      nodes.splice(nodes.indexOf(target), 1)
      renumberSiblings(nodes, oldParent)
      target.parentSectionId = operation.parentSectionId
      target.position = operation.position
      shiftSiblingPositions(nodes, operation.parentSectionId, operation.position, 1)
      nodes.push(target)
      affected.add(target.sectionId)
      break
    }
    case 'deleteSection': {
      const target = requireOutlineNode(nodes, operation.sectionId)
      if (nodes.length === 1) {
        throw new MutationSimulationError('invalid_result', 'The last section cannot be deleted')
      }
      if (nodes.some((node) => node.parentSectionId === target.sectionId)) {
        throw new MutationSimulationError(
          'invalid_result',
          'A section with children cannot be deleted'
        )
      }
      nodes.splice(nodes.indexOf(target), 1)
      renumberSiblings(nodes, target.parentSectionId)
      affected.add(target.sectionId)
      break
    }
  }
  return nodes
}

function normalizeOutline(nodes: OutlineNode[]): void {
  const ids = new Set(nodes.map((node) => node.sectionId))
  if (ids.size !== nodes.length) {
    throw new MutationSimulationError('id_collision', 'Outline contains duplicate section IDs')
  }
  for (const node of nodes) {
    if (node.parentSectionId !== null && !ids.has(node.parentSectionId)) {
      throw new MutationSimulationError('target_missing', 'Outline parent does not exist')
    }
  }
  const roots = outlineSiblings(nodes, null)
  const visited = new Set<string>()
  const visit = (node: OutlineNode, level: number): void => {
    if (visited.has(node.sectionId)) {
      throw new MutationSimulationError('invalid_result', 'Outline contains a cycle')
    }
    if (level > MAX_MANUSCRIPT_OUTLINE_DEPTH) {
      throw new MutationSimulationError('invalid_result', 'Outline nesting is too deep')
    }
    visited.add(node.sectionId)
    node.level = level
    outlineSiblings(nodes, node.sectionId).forEach((child, position) => {
      child.position = position
      visit(child, level + 1)
    })
  }
  roots.forEach((root, position) => {
    root.position = position
    visit(root, 1)
  })
  if (visited.size !== nodes.length) {
    throw new MutationSimulationError('invalid_result', 'Outline contains unreachable sections')
  }
  nodes.sort((left, right) =>
    left.level === right.level
      ? (left.parentSectionId ?? '').localeCompare(right.parentSectionId ?? '') ||
        left.position - right.position
      : left.level - right.level
  )
}

function outlineNodeFromRow(row: SectionTable): OutlineNode {
  return {
    sectionId: row.section_id,
    parentSectionId: row.parent_section_id,
    position: row.position,
    level: row.level,
    title: row.title,
    objective: row.objective,
    status: row.status
  }
}

function outlineSiblings(nodes: OutlineNode[], parentSectionId: string | null): OutlineNode[] {
  return nodes
    .filter((node) => node.parentSectionId === parentSectionId)
    .sort((left, right) => left.position - right.position)
}

function requireOutlineNode(nodes: OutlineNode[], sectionId: string): OutlineNode {
  const node = nodes.find((candidate) => candidate.sectionId === sectionId)
  if (node === undefined) {
    throw new MutationSimulationError('target_missing', 'Outline section does not exist')
  }
  return node
}

function requireOutlineParent(nodes: OutlineNode[], parentSectionId: string | null): void {
  if (parentSectionId !== null) requireOutlineNode(nodes, parentSectionId)
}

function descendants(nodes: OutlineNode[], sectionId: string): Set<string> {
  const result = new Set<string>()
  const visit = (parentId: string): void => {
    for (const child of nodes.filter((node) => node.parentSectionId === parentId)) {
      result.add(child.sectionId)
      visit(child.sectionId)
    }
  }
  visit(sectionId)
  return result
}

function shiftSiblingPositions(
  nodes: OutlineNode[],
  parentSectionId: string | null,
  from: number,
  delta: number
): void {
  for (const node of nodes) {
    if (node.parentSectionId === parentSectionId && node.position >= from) node.position += delta
  }
}

function renumberSiblings(nodes: OutlineNode[], parentSectionId: string | null): void {
  outlineSiblings(nodes, parentSectionId).forEach((node, position) => {
    node.position = position
  })
}

function renderOutline(nodes: OutlineNode[]): string {
  const lines: string[] = []
  const visit = (parentSectionId: string | null, depth: number): void => {
    for (const node of outlineSiblings(nodes, parentSectionId)) {
      lines.push(`${'  '.repeat(depth)}- ${node.title} [${node.status}] (${node.sectionId})`)
      visit(node.sectionId, depth + 1)
    }
  }
  visit(null, 0)
  return lines.join('\n')
}

function insertSectionRevision(
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
  const prepared = prepareSectionContent(blockNoteDocumentSchema.parse(input.content))
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
}

function updateAppliedProposal(
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
        WHERE mutation_proposal_id = ? AND status = 'pending'`
    )
    .run(now, appliedRevisionId, appliedBriefVersion, appliedOutlineVersion, now, proposalId)
  if (changed.changes !== 1) {
    throw new MutationProposalError(
      'proposal_not_pending',
      'Mutation proposal is no longer pending'
    )
  }
}

function proposalFromRow(row: MutationProposalTable): MutationProposalRecord {
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
    rejectedReason: row.rejected_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}

function staleBase(kind: 'brief' | 'outline' | 'section'): MutationProposalError {
  return new MutationProposalError('stale_base', `The ${kind} base has changed`)
}

function abortedToolError(cause?: unknown): AgentToolDomainError {
  return new AgentToolDomainError('aborted', 'Mutation proposal was aborted', true, { cause })
}

function isDeterministicApplyFailure(err: unknown): boolean {
  return (
    err instanceof MutationProposalError ||
    err instanceof MutationSimulationError ||
    err instanceof AgentToolDomainError
  )
}

function safeFailureReason(err: unknown): string {
  if (
    err instanceof MutationProposalError ||
    err instanceof MutationSimulationError ||
    err instanceof AgentToolDomainError
  ) {
    return err.message.slice(0, 4_096)
  }
  return 'Mutation proposal could not be applied'
}
