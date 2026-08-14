import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  AGENT_MUTATION_PREVIEW_TEXT_LIMIT,
  approveMutationProposalResultSchema,
  approveMutationProposalInputSchema,
  briefUpdateSchema,
  mutationCitedSourceSchema,
  mutationPreviewSchema,
  mutationProposalActionResultSchema,
  mutationProposalRecordSchema,
  mutationProposalToolResultSchema,
  mutationProposalOutcomeSchema,
  outlinePatchSchema,
  persistedMutationProposalPayloadSchema,
  rejectMutationProposalInputSchema,
  sectionPatchSchema,
  undoMutationProposalInputSchema,
  type AgentProposalToolName,
  type BriefUpdate,
  type NormalizedGenerateImageArgs,
  type MutationCitedSource,
  type MutationPreview,
  type MutationProposalRecord,
  type MutationProposalToolResult,
  type MutationProposalOutcome,
  type ApproveMutationProposalResult,
  type MutationProposalChanged,
  type OutlineMutationOperation,
  type OutlinePatch,
  type SectionPatch
} from '../../shared/contracts/agent-mutations'
import { agentToolResultPayloadSchema } from '../../shared/contracts/agent-tools'
import {
  blockNoteDocumentSchema,
  figureIdForBlock,
  manuscriptBriefFieldsSchema,
  MAX_MANUSCRIPT_OUTLINE_DEPTH,
  MAX_MANUSCRIPT_SECTIONS,
  type BlockNoteDocument
} from '../../shared/contracts/manuscript'
import { readWritingRules, type WritingRulesState } from '../../shared/contracts/writing-rules'
import type {
  ManuscriptBriefTable,
  ManuscriptTable,
  MutationProposalTable,
  SectionRevisionTable,
  SectionTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { extractSectionAgentText, prepareSectionContent } from '../manuscript/content'
import {
  assetIdFromUrl,
  assetUrl,
  recordRevisionAssetReferences,
  type ManuscriptAssetService
} from '../manuscript/asset-service'
import type { ModelExecutionService } from '../providers/model-execution-service'
import type { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import { AgentToolDomainError } from './read-tools'
import type { WritingSnapshot } from './context'
import { MutationSimulationError, simulateSectionPatch } from './mutation-simulator'
import {
  analyzeSectionProposalRefresh,
  type SectionProposalRefreshConflictCode
} from './section-proposal-refresh'
import type { ReviewIssueService } from './review-issue-service'
import type { WritingTaskService } from './writing-task-service'

const MAX_PROPOSAL_PAYLOAD_BYTES = 1_048_576

export interface ProposalToolExecutionContext {
  agentSessionId: string
  agentRunId: string
  toolCallId: string
  toolCallEventId: string
  modelRequestId: string
  createdSectionRefs?: Record<string, string>
  createdBlockRefs?: Record<string, string>
  resolvesReviewIssues?: Array<{
    issueId: string
    expectedVersion: number
    resolutionSummary: string
  }>
  signal: AbortSignal
}

function outcomeFromApproval(
  originalProposalId: string,
  result: ApproveMutationProposalResult
): MutationProposalOutcome {
  const message =
    result.outcome === 'conflict'
      ? result.conflict.message
      : result.outcome === 'refresh_required'
        ? 'The section changed again and the replacement proposal requires review.'
        : null
  const messages = [message, ...result.warnings].filter((value): value is string => value !== null)
  return mutationProposalOutcomeSchema.parse({
    outcome:
      result.outcome === 'applied'
        ? 'applied'
        : result.outcome === 'already_satisfied'
          ? 'already_satisfied'
          : 'conflict',
    proposalId: originalProposalId,
    effectiveProposalId: result.proposal.proposalId,
    kind: result.proposal.kind,
    message: messages.length === 0 ? null : messages.join(' ')
  })
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

type ApprovalTransactionResult =
  | { outcome: 'applied'; transaction: ApplyTransactionResult }
  | {
      outcome: 'refresh_required'
      previousProposal: MutationProposalRecord
      proposal: MutationProposalRecord
    }
  | {
      outcome: 'conflict'
      proposal: MutationProposalRecord
      conflict: { code: SectionProposalRefreshConflictCode; message: string }
    }
  | { outcome: 'already_satisfied'; proposal: MutationProposalRecord }

export class MutationProposalService {
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #imageControllers = new Map<string, AbortController>()
  readonly #imageCompletions = new Map<string, Promise<void>>()
  readonly #settleImageCompletion = new Map<string, () => void>()

  constructor(
    private readonly options: {
      projectId: string
      projectSessionId: string
      database: ProjectDatabase
      manuscript: ManuscriptService
      editorPersistence: EditorPersistenceService
      manuscriptAssets?: ManuscriptAssetService
      modelExecution?: ModelExecutionService
      reviewIssues?: ReviewIssueService
      writingTasks?: WritingTaskService
      log: Pick<Logger, 'info' | 'warn' | 'error'>
      publishChanged?: (event: MutationProposalChanged) => void
      flushForMutation?: (affectedSectionIds: readonly string[]) => Promise<void>
      now?: () => Date
      createId?: () => string
    }
  ) {
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  cancelImageGeneration(agentSessionId: string, proposalId: string): boolean {
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT status FROM mutation_proposals
             WHERE mutation_proposal_id = ? AND agent_session_id = ?
               AND kind = 'generated_image_insert'`
          )
          .get(proposalId, agentSessionId) as { status: string } | undefined
    )
    if (row?.status !== 'generating') return false
    this.#imageControllers.get(proposalId)?.abort()
    this.options.log.info(
      { event: 'agent.image_generation.cancel_requested', proposalId, agentSessionId },
      'Agent image generation cancellation requested'
    )
    return true
  }

  async cancelAllImageGenerations(): Promise<void> {
    for (const controller of this.#imageControllers.values()) controller.abort()
    await Promise.allSettled([...this.#imageCompletions.values()])
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

  assertCanonicalBlockRead(
    agentSessionId: string,
    agentRunId: string,
    blockId: string,
    expectedBlockHash: string
  ): void {
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT payload_json FROM agent_events
            WHERE agent_session_id = ? AND agent_run_id = ? AND type = 'tool_result'
            ORDER BY sequence DESC`
          )
          .all(agentSessionId, agentRunId) as Array<{ payload_json: string }>
    )
    const found = rows.some((row) => {
      const parsed = agentToolResultPayloadSchema.safeParse(JSON.parse(row.payload_json))
      if (
        !parsed.success ||
        parsed.data.toolName !== 'read_section' ||
        parsed.data.isError ||
        parsed.data.result === null
      )
        return false
      const canonical = parsed.data.result['canonicalBlock']
      if (canonical === null || canonical === undefined || typeof canonical !== 'object')
        return false
      if (!('id' in canonical) || canonical.id !== blockId) return false
      return (
        createHash('sha256').update(JSON.stringify(canonical)).digest('hex') === expectedBlockHash
      )
    })
    if (!found) {
      throw new AgentToolDomainError(
        'invalid_arguments',
        'replaceCanonicalBlock requires a matching canonical read from the current Agent run'
      )
    }
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
        validateMutationAssetReferences(database, prepared.mutation)
        const payload = persistedMutationProposalPayloadSchema.parse({
          schemaVersion: 1,
          kind: prepared.kind,
          mutation: prepared.mutation,
          preview: prepared.preview,
          provenance: {
            modelRequestId: context.modelRequestId,
            citedSources,
            resolvesReviewIssues: context.resolvesReviewIssues ?? [],
            ...(context.createdSectionRefs === undefined
              ? {}
              : { createdSectionRefs: context.createdSectionRefs }),
            ...(context.createdBlockRefs === undefined
              ? {}
              : { createdBlockRefs: context.createdBlockRefs })
          }
        })
        const payloadJson = JSON.stringify(payload)
        if (Buffer.byteLength(payloadJson) > MAX_PROPOSAL_PAYLOAD_BYTES) {
          throw new AgentToolDomainError('result_too_large', 'Mutation proposal is too large')
        }
        const writingTask =
          this.options.writingTasks?.activeCorrelation(context.agentSessionId, database) ?? null
        const now = this.#now().toISOString()
        database
          .prepare(
            `INSERT INTO mutation_proposals (
               mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
               agent_tool_call_id, kind, payload_json, base_revision_id,
               base_brief_version, base_outline_version, status, decision_at,
               applied_revision_id, applied_brief_version, applied_outline_version,
               undo_revision_id, rejected_reason, writing_task_id, writing_task_step_id,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL,
                       NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`
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
            writingTask?.taskId ?? null,
            writingTask?.stepId ?? null,
            now,
            now
          )
        return mutationProposalToolResultSchema.parse({
          proposalId,
          kind: prepared.kind,
          status: 'pending',
          preview: prepared.preview,
          ...(context.createdSectionRefs === undefined
            ? {}
            : { createdSectionRefs: context.createdSectionRefs }),
          ...(context.createdBlockRefs === undefined
            ? {}
            : { createdBlockRefs: context.createdBlockRefs })
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
      this.options.publishChanged?.({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: context.agentSessionId,
        proposalId: result.proposalId,
        kind: result.kind,
        status: 'pending',
        sectionChanged: null
      })
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

  proposeGeneratedImage(
    rawArgs: NormalizedGenerateImageArgs,
    snapshot: WritingSnapshot,
    context: ProposalToolExecutionContext
  ): MutationProposalToolResult {
    if (context.signal.aborted) throw abortedToolError()
    const args = rawArgs
    const entry = snapshot.workspace.sections.find(
      (candidate) => candidate.section.sectionId === args.sectionId
    )
    if (entry === undefined) throw new AgentToolDomainError('not_found', 'Section does not exist')
    const baseRevisionId = entry.section.currentRevisionId
    const document = snapshot.sectionContents.get(baseRevisionId)
    if (document === undefined) {
      throw new AgentToolDomainError('conflict', 'Mutation source snapshot expired')
    }
    if (args.iteration === undefined && args.anchor !== null) {
      verifyBlockPrecondition(document, args.anchor)
    }
    const proposalId = this.#createId()
    const result = this.options.database.immediate((database) => {
      requireToolCall(database, context)
      const section = requireSection(database, args.sectionId)
      if (section.current_revision_id !== baseRevisionId) throw staleBase('section')
      const iteration =
        args.iteration === undefined
          ? null
          : resolveImageIteration(database, document, args.iteration, args.prompt)
      const effectivePrompt =
        iteration === null
          ? args.prompt
          : composeImageIterationPrompt(
              iteration.parentPrompt,
              args.prompt,
              extractSectionAgentText(document)
            )
      const preview = createPreview({
        summary:
          iteration === null
            ? 'Generate and insert one image'
            : iteration.disposition === 'replace'
              ? 'Generate a candidate to replace one figure'
              : 'Generate a candidate to insert after one figure',
        affectedSectionIds: [args.sectionId],
        beforeText: iteration === null ? '' : `Current generated image: ${iteration.parentAssetId}`,
        afterText: `Image: ${args.altText}\nCaption: ${args.caption}\nPrompt: ${args.prompt}`,
        citedSources: []
      })
      const payload = persistedMutationProposalPayloadSchema.parse({
        schemaVersion: 1,
        kind: 'generated_image_insert',
        mutation: {
          schemaVersion: 1,
          sectionId: args.sectionId,
          baseRevisionId,
          anchor: args.anchor,
          placement: args.placement,
          prompt: effectivePrompt,
          altText: args.altText,
          caption: args.caption,
          aspectRatio: args.aspectRatio,
          imageSize: args.imageSize,
          iteration:
            iteration === null
              ? null
              : {
                  sourceBlock: iteration.sourceBlock,
                  disposition: iteration.disposition,
                  parentAssetId: iteration.parentAssetId
                },
          assetId: null,
          imageModelRequestId: null
        },
        preview,
        provenance: {
          modelRequestId: context.modelRequestId,
          citedSources: [],
          resolvesReviewIssues: context.resolvesReviewIssues ?? []
        }
      })
      const now = this.#now().toISOString()
      const writingTask =
        this.options.writingTasks?.activeCorrelation(context.agentSessionId, database) ?? null
      database
        .prepare(
          `INSERT INTO mutation_proposals (
             mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
             agent_tool_call_id, kind, payload_json, base_revision_id,
             base_brief_version, base_outline_version, status, decision_at,
             applied_revision_id, applied_brief_version, applied_outline_version,
             undo_revision_id, rejected_reason, writing_task_id, writing_task_step_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'generated_image_insert', ?, ?, NULL, NULL, 'pending', NULL,
                     NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`
        )
        .run(
          proposalId,
          context.agentSessionId,
          context.agentRunId,
          context.toolCallEventId,
          context.toolCallId,
          JSON.stringify(payload),
          baseRevisionId,
          writingTask?.taskId ?? null,
          writingTask?.stepId ?? null,
          now,
          now
        )
      return mutationProposalToolResultSchema.parse({
        proposalId,
        kind: 'generated_image_insert',
        status: 'pending',
        preview
      })
    })
    this.options.publishChanged?.({
      projectSessionId: this.options.projectSessionId,
      agentSessionId: context.agentSessionId,
      proposalId,
      kind: 'generated_image_insert',
      status: 'pending',
      sectionChanged: null
    })
    return result
  }

  async approve(rawInput: unknown) {
    const input = approveMutationProposalInputSchema.parse(rawInput)
    this.#assertProjectSession(input.projectSessionId)
    const initialPayload = this.options.database.immediate((database) => {
      const row = requireProposal(database, input.agentSessionId, input.proposalId)
      return persistedMutationProposalPayloadSchema.parse(JSON.parse(row.payload_json))
    })
    if (initialPayload.kind === 'generated_image_insert') {
      const result = await this.#approveGeneratedImage(input.agentSessionId, input.proposalId)
      this.options.publishChanged?.({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: input.agentSessionId,
        proposalId: result.proposal.proposalId,
        kind: result.proposal.kind,
        status: result.proposal.status,
        sectionChanged: result.sectionChanged
      })
      return result
    }
    const affectedSectionIds = this.options.database.immediate((database) => {
      const row = requireProposal(database, input.agentSessionId, input.proposalId)
      return persistedMutationProposalPayloadSchema.parse(JSON.parse(row.payload_json)).preview
        .affectedSectionIds
    })
    if (affectedSectionIds.length > 0) {
      try {
        await this.options.flushForMutation?.(affectedSectionIds)
      } catch (err) {
        this.options.log.error(
          { event: 'agent.mutation_barrier.failed', err, proposalId: input.proposalId },
          'Agent mutation editor barrier failed'
        )
        throw new MutationProposalError(
          'stale_base',
          'The active editor could not be safely flushed before applying the proposal',
          { cause: err }
        )
      }
    }
    const result = await this.#approveDecision(input.agentSessionId, input.proposalId)
    const effectiveProposal = result.proposal
    this.options.publishChanged?.({
      projectSessionId: this.options.projectSessionId,
      agentSessionId: input.agentSessionId,
      proposalId: effectiveProposal.proposalId,
      kind: effectiveProposal.kind,
      status: effectiveProposal.status,
      sectionChanged: result.sectionChanged
    })
    return result
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
      const result = mutationProposalActionResultSchema.parse({ proposal, sectionChanged: null })
      this.options.publishChanged?.({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: input.agentSessionId,
        proposalId: proposal.proposalId,
        kind: proposal.kind,
        status: proposal.status,
        sectionChanged: null
      })
      return result
    } catch (err) {
      this.#logDecisionFailure('agent.mutation.reject_failed', err, input.proposalId, startedAt)
      throw err
    }
  }

  async approveAutomatically(
    agentSessionId: string,
    proposalId: string,
    refreshOnce: boolean
  ): Promise<MutationProposalOutcome> {
    let effectiveProposalId = proposalId
    const result = await this.approve({
      projectSessionId: this.options.projectSessionId,
      agentSessionId,
      proposalId
    })
    if (result.outcome === 'refresh_required' && refreshOnce) {
      effectiveProposalId = result.proposal.proposalId
      const refreshed = await this.approve({
        projectSessionId: this.options.projectSessionId,
        agentSessionId,
        proposalId: effectiveProposalId
      })
      return outcomeFromApproval(proposalId, refreshed)
    }
    return outcomeFromApproval(proposalId, result)
  }

  async undo(rawInput: unknown) {
    const input = undoMutationProposalInputSchema.parse(rawInput)
    this.#assertProjectSession(input.projectSessionId)
    const result = await this.#undoDecision(input.agentSessionId, input.proposalId)
    this.options.publishChanged?.({
      projectSessionId: this.options.projectSessionId,
      agentSessionId: input.agentSessionId,
      proposalId: result.proposal.proposalId,
      kind: result.proposal.kind,
      status: result.proposal.status,
      sectionChanged: result.sectionChanged
    })
    return result
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
      case 'submit_brief_change':
      case 'submit_writing_rules_change': {
        const mutation = briefUpdateSchema.parse(rawArgs)
        const current = requirePrimaryBrief(database, mutation.manuscriptId)
        if (current.version !== mutation.baseBriefVersion) throw staleBase('brief')
        const before = briefFieldsFromRow(current)
        const after = manuscriptBriefFieldsSchema.parse({ ...before, ...mutation.changes })
        if (JSON.stringify(after) === JSON.stringify(before)) {
          throw new MutationSimulationError('no_change', 'Brief update does not change the brief')
        }
        const writingRulesChange = toolName === 'submit_writing_rules_change'
        return {
          kind: 'brief_update',
          mutation,
          preview: createPreview({
            summary: writingRulesChange
              ? 'Update project Writing Rules'
              : 'Update the manuscript brief',
            affectedSectionIds: [],
            beforeText: writingRulesChange
              ? formatWritingRulesPreview(readWritingRules(before.extensible))
              : JSON.stringify(before, null, 2),
            afterText: writingRulesChange
              ? formatWritingRulesPreview(readWritingRules(after.extensible))
              : JSON.stringify(after, null, 2),
            citedSources
          })
        }
      }
      case 'submit_outline_change': {
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
      case 'submit_section_change': {
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
      case 'generate_image':
        throw new AgentToolDomainError(
          'invalid_arguments',
          'Image generation must use the dedicated proposal path'
        )
    }
  }

  async #approveGeneratedImage(agentSessionId: string, proposalId: string) {
    if (this.options.manuscriptAssets === undefined || this.options.modelExecution === undefined) {
      throw new MutationProposalError(
        'invalid_proposal',
        'Image generation is unavailable for this project session'
      )
    }
    const assets = this.options.manuscriptAssets
    const execution = this.options.modelExecution
    const prepared = this.options.database.immediate((database) => {
      const row = requireProposal(database, agentSessionId, proposalId)
      if (row.status !== 'pending') {
        throw new MutationProposalError(
          'proposal_not_pending',
          'Image proposal is no longer pending'
        )
      }
      const payload = persistedMutationProposalPayloadSchema.parse(JSON.parse(row.payload_json))
      if (payload.kind !== 'generated_image_insert') {
        throw new MutationProposalError('invalid_proposal', 'Proposal is not an image request')
      }
      const section = database
        .prepare('SELECT * FROM sections WHERE section_id = ?')
        .get(payload.mutation.sectionId) as SectionTable | undefined
      if (section === undefined || section.deleted_at !== null) {
        // A removed target must resolve the proposal instead of throwing: a throw
        // leaves the proposal pending and deadlocks the review wait.
        return {
          decision: this.#recordRefreshConflict(
            database,
            row,
            'target_missing',
            'The proposal target is no longer available'
          )
        }
      }
      if (section.current_revision_id !== payload.mutation.baseRevisionId) {
        return { decision: this.#refreshGeneratedImageProposal(database, row, payload, section) }
      }
      const revision = requireRevision(database, payload.mutation.baseRevisionId)
      const document = blockNoteDocumentSchema.parse(JSON.parse(revision.content_json))
      if (payload.mutation.anchor !== null) {
        verifyBlockPrecondition(document, payload.mutation.anchor)
      }
      if (payload.mutation.assetId !== null) {
        return { decision: null, row, payload, needsGeneration: false }
      }
      const now = this.#now().toISOString()
      const changed = database
        .prepare(
          `UPDATE mutation_proposals
              SET status = 'generating', decision_at = ?, updated_at = ?
            WHERE mutation_proposal_id = ? AND status = 'pending'`
        )
        .run(now, now, proposalId)
      if (changed.changes !== 1) {
        throw new MutationProposalError(
          'proposal_not_pending',
          'Image proposal is no longer pending'
        )
      }
      return { decision: null, row, payload, needsGeneration: true }
    })
    if (prepared.decision !== null) {
      if (prepared.decision.outcome === 'refresh_required') {
        this.options.log.info(
          {
            event: 'agent.image_refresh.refresh_required',
            proposalId,
            replacementProposalId: prepared.decision.proposal.proposalId,
            agentSessionId
          },
          'Stale generated image proposal refreshed for review'
        )
      }
      return approveMutationProposalResultSchema.parse({
        ...prepared.decision,
        sectionChanged: null
      })
    }

    let payload = prepared.payload
    if (prepared.needsGeneration) {
      this.options.publishChanged?.({
        projectSessionId: this.options.projectSessionId,
        agentSessionId,
        proposalId,
        kind: 'generated_image_insert',
        status: 'generating',
        sectionChanged: null
      })
      const controller = new AbortController()
      this.#imageControllers.set(proposalId, controller)
      this.#imageCompletions.set(
        proposalId,
        new Promise<void>((resolve) => this.#settleImageCompletion.set(proposalId, resolve))
      )
      const generationStartedAt = Date.now()
      this.options.log.info(
        {
          event: 'agent.image_generation.started',
          proposalId,
          agentSessionId,
          promptLength: payload.mutation.prompt.length,
          promptHash: createHash('sha256').update(payload.mutation.prompt).digest('hex'),
          aspectRatio: payload.mutation.aspectRatio,
          imageSize: payload.mutation.imageSize
        },
        'Agent image generation started'
      )
      try {
        const generated = await execution.generateImage(
          this.options.database,
          {
            prompt: payload.mutation.prompt,
            aspectRatio: payload.mutation.aspectRatio,
            imageSize: payload.mutation.imageSize
          },
          {
            operationId: this.#createId(),
            agentRunId: prepared.row.agent_run_id,
            projectSessionId: this.options.projectSessionId
          },
          controller.signal
        )
        const asset = await assets.store({
          bytes: Buffer.from(generated.dataBase64, 'base64'),
          mimeType: generated.mimeType,
          sourceType: 'generated',
          generationRequest: {
            prompt: payload.mutation.prompt,
            aspectRatio: payload.mutation.aspectRatio,
            requestedImageSize: payload.mutation.imageSize,
            effectiveImageSize: generated.effectiveImageSize
          },
          modelRequestId: generated.modelRequestId,
          agentRunId: prepared.row.agent_run_id,
          agentToolCallId: prepared.row.agent_tool_call_id
        })
        const updatedPayload = persistedMutationProposalPayloadSchema.parse({
          ...payload,
          mutation: {
            ...payload.mutation,
            assetId: asset.assetId,
            imageModelRequestId: generated.modelRequestId
          }
        })
        if (updatedPayload.kind !== 'generated_image_insert') {
          throw new MutationProposalError(
            'invalid_proposal',
            'Generated image payload changed kind'
          )
        }
        payload = updatedPayload
        this.options.log.info(
          {
            event: 'agent.image_generation.completed',
            proposalId,
            agentSessionId,
            assetId: asset.assetId,
            modelRequestId: generated.modelRequestId,
            modelId: generated.metadata.providerModelId,
            requestedImageSize: payload.mutation.imageSize,
            effectiveImageSize: generated.effectiveImageSize,
            durationMs: Date.now() - generationStartedAt
          },
          'Agent image generation completed'
        )
        this.options.database.immediate((database) => {
          const changed = database
            .prepare(
              `UPDATE mutation_proposals SET payload_json = ?, updated_at = ?
               WHERE mutation_proposal_id = ? AND status = 'generating'`
            )
            .run(JSON.stringify(payload), this.#now().toISOString(), proposalId)
          if (changed.changes !== 1) {
            throw new MutationProposalError(
              'proposal_not_pending',
              'Image proposal was cancelled before publication'
            )
          }
        })
      } catch (err) {
        this.options.log.error(
          {
            event: 'agent.image_generation.failed',
            err,
            proposalId,
            agentSessionId,
            cancelled: controller.signal.aborted,
            durationMs: Date.now() - generationStartedAt
          },
          'Agent image generation failed'
        )
        this.options.database.immediate((database) => {
          const now = this.#now().toISOString()
          database
            .prepare(
              `UPDATE mutation_proposals
                  SET status = 'failed', rejected_reason = ?, updated_at = ?
                WHERE mutation_proposal_id = ? AND status = 'generating'`
            )
            .run(
              controller.signal.aborted
                ? 'Image generation was cancelled'
                : 'Image generation failed safely',
              now,
              proposalId
            )
        })
        this.options.publishChanged?.({
          projectSessionId: this.options.projectSessionId,
          agentSessionId,
          proposalId,
          kind: 'generated_image_insert',
          status: 'failed',
          sectionChanged: null
        })
        throw err
      } finally {
        this.#imageControllers.delete(proposalId)
        this.#settleImageCompletion.get(proposalId)?.()
        this.#settleImageCompletion.delete(proposalId)
        this.#imageCompletions.delete(proposalId)
      }
    }

    if (payload.mutation.iteration !== null) {
      return this.#publishImageIterationCandidate(agentSessionId, proposalId, payload)
    }

    try {
      await this.options.flushForMutation?.([payload.mutation.sectionId])
    } catch (err) {
      this.options.log.error(
        { event: 'agent.image_mutation_barrier.failed', err, proposalId },
        'Generated image editor barrier failed'
      )
      throw new MutationProposalError(
        'stale_base',
        'The active editor could not be safely flushed before inserting the image',
        { cause: err }
      )
    }

    const transactionResult = this.options.database.immediate((database) => {
      const row = requireProposal(database, agentSessionId, proposalId)
      const currentPayload = persistedMutationProposalPayloadSchema.parse(
        JSON.parse(row.payload_json)
      )
      if (currentPayload.kind !== 'generated_image_insert') {
        throw new MutationProposalError('invalid_proposal', 'Proposal is not an image request')
      }
      const section = database
        .prepare('SELECT * FROM sections WHERE section_id = ?')
        .get(currentPayload.mutation.sectionId) as SectionTable | undefined
      if (section === undefined || section.deleted_at !== null) {
        // A removed target must resolve the proposal instead of throwing: a throw
        // leaves the proposal pending and deadlocks the review wait.
        return this.#recordRefreshConflict(
          database,
          row,
          'target_missing',
          'The proposal target is no longer available'
        )
      }
      if (section.current_revision_id !== currentPayload.mutation.baseRevisionId) {
        return this.#refreshGeneratedImageProposal(database, row, currentPayload, section)
      }
      return {
        outcome: 'applied' as const,
        transaction: this.#applyProposal(database, agentSessionId, proposalId)
      }
    })
    if (transactionResult.outcome === 'applied') {
      const applied = await this.#finalizeAppliedTransaction(
        transactionResult.transaction,
        agentSessionId,
        proposalId,
        'apply',
        Date.now()
      )
      return approveMutationProposalResultSchema.parse({ outcome: 'applied', ...applied })
    }
    if (transactionResult.outcome === 'refresh_required') {
      this.options.log.info(
        {
          event: 'agent.image_refresh.refresh_required',
          proposalId,
          replacementProposalId: transactionResult.proposal.proposalId,
          agentSessionId
        },
        'Stale generated image proposal refreshed for review'
      )
    }
    return approveMutationProposalResultSchema.parse({
      ...transactionResult,
      sectionChanged: null
    })
  }

  async #publishImageIterationCandidate(
    agentSessionId: string,
    proposalId: string,
    payload: Extract<
      ReturnType<typeof persistedMutationProposalPayloadSchema.parse>,
      { kind: 'generated_image_insert' }
    >
  ) {
    if (
      payload.mutation.iteration === null ||
      payload.mutation.assetId === null ||
      payload.mutation.imageModelRequestId === null
    ) {
      throw new MutationProposalError('invalid_proposal', 'Image iteration candidate is incomplete')
    }
    try {
      await this.options.flushForMutation?.([payload.mutation.sectionId])
    } catch (err) {
      this.options.log.error(
        { event: 'agent.image_iteration.mutation_barrier_failed', err, proposalId },
        'Image iteration editor barrier failed'
      )
      throw new MutationProposalError(
        'stale_base',
        'The active editor could not be safely flushed before preparing the candidate proposal',
        { cause: err }
      )
    }
    const result = this.options.database.immediate((database) => {
      const row = requireProposal(database, agentSessionId, proposalId)
      if (row.status !== 'generating') {
        throw new MutationProposalError(
          'proposal_not_pending',
          'Image generation request is no longer active'
        )
      }
      const currentPayload = persistedMutationProposalPayloadSchema.parse(
        JSON.parse(row.payload_json)
      )
      if (
        currentPayload.kind !== 'generated_image_insert' ||
        currentPayload.mutation.iteration === null ||
        currentPayload.mutation.assetId === null ||
        currentPayload.mutation.imageModelRequestId === null
      ) {
        throw new MutationProposalError('invalid_proposal', 'Image iteration payload is incomplete')
      }
      const iteration = currentPayload.mutation.iteration
      const section = requireSection(database, currentPayload.mutation.sectionId)
      const revision = requireRevision(database, section.current_revision_id)
      const document = blockNoteDocumentSchema.parse(JSON.parse(revision.content_json))
      const lineageId = this.#createId()
      const now = this.#now().toISOString()
      const insertLineage = (sectionProposalId: string | null): void => {
        database
          .prepare(
            `INSERT INTO manuscript_asset_variants (
               manuscript_asset_variant_id, parent_asset_id, candidate_asset_id,
               generation_proposal_id, candidate_model_request_id, section_proposal_id,
               disposition, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            lineageId,
            iteration.parentAssetId,
            currentPayload.mutation.assetId,
            proposalId,
            currentPayload.mutation.imageModelRequestId,
            sectionProposalId,
            iteration.disposition,
            now
          )
      }
      try {
        verifyBlockPrecondition(document, iteration.sourceBlock)
      } catch (err) {
        this.options.log.warn(
          { event: 'agent.image_iteration.target_changed', err, proposalId },
          'Image iteration target changed before candidate review'
        )
        insertLineage(null)
        const proposal = updateTerminalProposal(
          database,
          proposalId,
          'conflicted',
          'The candidate was generated, but the target figure changed',
          now
        )
        return {
          outcome: 'conflict' as const,
          proposal,
          conflict: {
            code: 'target_changed' as const,
            message: 'The target figure changed while the candidate was generated'
          }
        }
      }
      const target = findDocumentBlock(document, iteration.sourceBlock.blockId)
      if (target === null || target.type !== 'image') {
        this.options.log.warn(
          { event: 'agent.image_iteration.target_missing', proposalId },
          'Image iteration target is unavailable before candidate review'
        )
        insertLineage(null)
        const proposal = updateTerminalProposal(
          database,
          proposalId,
          'conflicted',
          'The candidate was generated, but the target figure is unavailable',
          now
        )
        return {
          outcome: 'conflict' as const,
          proposal,
          conflict: {
            code: 'target_missing' as const,
            message: 'The target figure is unavailable'
          }
        }
      }
      const sectionProposalId = this.#createId()
      const operations =
        iteration.disposition === 'replace'
          ? [
              {
                type: 'updateBlock' as const,
                blockId: target.id,
                update: { props: { url: assetUrl(currentPayload.mutation.assetId) } }
              }
            ]
          : [
              {
                type: 'insertBlocks' as const,
                anchorBlockId: target.id,
                placement: 'after' as const,
                blocks: [
                  {
                    id: this.#createId(),
                    type: 'image' as const,
                    props: {
                      backgroundColor: 'default',
                      textAlignment: 'center',
                      name: currentPayload.mutation.altText,
                      url: assetUrl(currentPayload.mutation.assetId),
                      caption: currentPayload.mutation.caption,
                      figureId: '',
                      altText: currentPayload.mutation.altText,
                      showPreview: true,
                      previewWidth: 720
                    },
                    children: []
                  }
                ]
              }
            ]
      if (iteration.disposition === 'insert_after') {
        const inserted = operations[0]
        if (inserted?.type === 'insertBlocks') {
          const block = inserted.blocks[0]
          if (block !== undefined) {
            block.props.figureId = figureIdForBlock(currentPayload.mutation.sectionId, block.id)
          }
        }
      }
      const mutation = sectionPatchSchema.parse({
        schemaVersion: 1,
        sectionId: currentPayload.mutation.sectionId,
        baseRevisionId: revision.section_revision_id,
        operations,
        citationIds: []
      })
      validateMutationAssetReferences(database, mutation)
      const simulation = simulateSectionPatch(document, mutation)
      const sectionPayload = persistedMutationProposalPayloadSchema.parse({
        schemaVersion: 1,
        kind: 'section_patch',
        mutation,
        preview: createPreview({
          summary:
            iteration.disposition === 'replace'
              ? 'Replace one figure with the generated candidate'
              : 'Insert the generated candidate as another figure',
          affectedSectionIds: [currentPayload.mutation.sectionId],
          beforeText: simulation.beforeText,
          afterText: simulation.afterText,
          citedSources: []
        }),
        provenance: currentPayload.provenance
      })
      const payloadJson = JSON.stringify(sectionPayload)
      if (Buffer.byteLength(payloadJson) > MAX_PROPOSAL_PAYLOAD_BYTES) {
        throw new MutationProposalError('invalid_proposal', 'Image candidate proposal is too large')
      }
      database
        .prepare(
          `INSERT INTO mutation_proposals (
             mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
             agent_tool_call_id, kind, payload_json, base_revision_id,
             base_brief_version, base_outline_version, status, decision_at,
             applied_revision_id, applied_brief_version, applied_outline_version,
             undo_revision_id, replaces_proposal_id, rejected_reason, writing_task_id,
             writing_task_step_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'section_patch', ?, ?, NULL, NULL, 'pending', NULL,
                     NULL, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?)`
        )
        .run(
          sectionProposalId,
          row.agent_session_id,
          row.agent_run_id,
          row.tool_call_event_id,
          row.agent_tool_call_id,
          payloadJson,
          revision.section_revision_id,
          proposalId,
          row.writing_task_id,
          row.writing_task_step_id,
          now,
          now
        )
      database
        .prepare(
          `UPDATE mutation_proposals
              SET status = 'superseded', decision_at = COALESCE(decision_at, ?),
                  rejected_reason = ?, updated_at = ?
            WHERE mutation_proposal_id = ? AND status = 'generating'`
        )
        .run(now, 'The generated candidate awaits manuscript review', now, proposalId)
      insertLineage(sectionProposalId)
      const previousProposal = proposalFromRow(
        database
          .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .get(proposalId) as MutationProposalTable
      )
      const proposal = proposalFromRow(
        database
          .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .get(sectionProposalId) as MutationProposalTable
      )
      this.options.log.info(
        {
          event: 'agent.image_iteration.candidate_ready',
          proposalId,
          sectionProposalId,
          parentAssetId: iteration.parentAssetId,
          candidateAssetId: currentPayload.mutation.assetId,
          modelRequestId: currentPayload.mutation.imageModelRequestId,
          disposition: iteration.disposition
        },
        'Image iteration candidate is ready for manuscript review'
      )
      return { outcome: 'refresh_required' as const, previousProposal, proposal }
    })
    return approveMutationProposalResultSchema.parse({ ...result, sectionChanged: null })
  }

  #refreshGeneratedImageProposal(
    database: Database.Database,
    row: MutationProposalTable,
    payload: Extract<
      ReturnType<typeof persistedMutationProposalPayloadSchema.parse>,
      { kind: 'generated_image_insert' }
    >,
    section: SectionTable
  ): ApprovalTransactionResult {
    const current = requireRevision(database, section.current_revision_id)
    try {
      if (payload.mutation.anchor !== null) {
        verifyBlockPrecondition(
          blockNoteDocumentSchema.parse(JSON.parse(current.content_json)),
          payload.mutation.anchor
        )
      }
    } catch (err) {
      this.options.log.warn(
        { event: 'agent.image_refresh.anchor_conflict', err, proposalId: row.mutation_proposal_id },
        'Generated image proposal anchor changed during generation'
      )
      const now = this.#now().toISOString()
      database
        .prepare(
          `UPDATE mutation_proposals
              SET status = 'conflicted', decision_at = COALESCE(decision_at, ?),
                  rejected_reason = ?, updated_at = ?
            WHERE mutation_proposal_id = ? AND status IN ('pending', 'generating')`
        )
        .run(
          now,
          'The image was generated, but its insertion anchor changed',
          now,
          row.mutation_proposal_id
        )
      const proposal = proposalFromRow(
        database
          .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
          .get(row.mutation_proposal_id) as MutationProposalTable
      )
      return {
        outcome: 'conflict',
        proposal,
        conflict: { code: 'target_changed', message: 'The image insertion anchor changed' }
      }
    }
    const replacementId = this.#createId()
    const now = this.#now().toISOString()
    const replacementPayload = persistedMutationProposalPayloadSchema.parse({
      ...payload,
      mutation: { ...payload.mutation, baseRevisionId: current.section_revision_id }
    })
    database
      .prepare(
        `INSERT INTO mutation_proposals (
           mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
           agent_tool_call_id, kind, payload_json, base_revision_id,
           base_brief_version, base_outline_version, status, decision_at,
           applied_revision_id, applied_brief_version, applied_outline_version,
           undo_revision_id, replaces_proposal_id, rejected_reason, writing_task_id,
           writing_task_step_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'generated_image_insert', ?, ?, NULL, NULL, 'pending', NULL,
                   NULL, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?)`
      )
      .run(
        replacementId,
        row.agent_session_id,
        row.agent_run_id,
        row.tool_call_event_id,
        row.agent_tool_call_id,
        JSON.stringify(replacementPayload),
        current.section_revision_id,
        row.mutation_proposal_id,
        row.writing_task_id,
        row.writing_task_step_id,
        now,
        now
      )
    database
      .prepare(
        `UPDATE mutation_proposals
            SET status = 'superseded', decision_at = COALESCE(decision_at, ?),
                rejected_reason = ?, updated_at = ?
          WHERE mutation_proposal_id = ? AND status IN ('pending', 'generating')`
      )
      .run(
        now,
        payload.mutation.assetId === null
          ? 'A refreshed proposal replaces this outdated proposal'
          : 'A refreshed proposal reuses the generated asset',
        now,
        row.mutation_proposal_id
      )
    const previousProposal = proposalFromRow(
      database
        .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
        .get(row.mutation_proposal_id) as MutationProposalTable
    )
    const proposal = proposalFromRow(
      database
        .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
        .get(replacementId) as MutationProposalTable
    )
    return { outcome: 'refresh_required', previousProposal, proposal }
  }

  async #undoDecision(agentSessionId: string, proposalId: string) {
    const startedAt = Date.now()
    let transactionResult: ApplyTransactionResult
    try {
      transactionResult = this.options.database.immediate((database) =>
        this.#undoProposal(database, agentSessionId, proposalId)
      )
    } catch (err) {
      this.#logDecisionFailure('agent.mutation.undo_failed', err, proposalId, startedAt)
      throw err
    }
    return this.#finalizeAppliedTransaction(
      transactionResult,
      agentSessionId,
      proposalId,
      'undo',
      startedAt
    )
  }

  async #finalizeAppliedTransaction(
    transactionResult: ApplyTransactionResult,
    agentSessionId: string,
    proposalId: string,
    decision: 'apply' | 'undo',
    startedAt: number
  ) {
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
    const reviewWarnings =
      decision === 'apply'
        ? this.#resolveReviewIssues(transactionResult.proposal)
        : (this.options.reviewIssues?.reopenForUndo(transactionResult.proposal.proposalId) ?? [])
    const result = mutationProposalActionResultSchema.parse({
      proposal: transactionResult.proposal,
      sectionChanged,
      warnings: reviewWarnings
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

  async #approveDecision(agentSessionId: string, proposalId: string) {
    const startedAt = Date.now()
    let transactionResult: ApprovalTransactionResult
    try {
      transactionResult = this.options.database.immediate((database) =>
        this.#approveProposal(database, agentSessionId, proposalId)
      )
    } catch (err) {
      this.#logDecisionFailure('agent.mutation.apply_failed', err, proposalId, startedAt)
      if (isDeterministicApplyFailure(err)) {
        this.#recordApplyFailure(agentSessionId, proposalId, err)
      }
      throw err
    }

    if (transactionResult.outcome === 'applied') {
      const applied = await this.#finalizeAppliedTransaction(
        transactionResult.transaction,
        agentSessionId,
        proposalId,
        'apply',
        startedAt
      )
      const result = approveMutationProposalResultSchema.parse({
        outcome: 'applied',
        ...applied
      })
      return result
    }

    if (transactionResult.outcome === 'refresh_required') {
      this.options.log.info(
        {
          event: 'agent.mutation.refresh_required',
          proposalId,
          replacementProposalId: transactionResult.proposal.proposalId,
          agentSessionId,
          durationMs: Date.now() - startedAt
        },
        'Stale Agent section proposal refreshed for review'
      )
      return approveMutationProposalResultSchema.parse({
        ...transactionResult,
        sectionChanged: null
      })
    }

    if (transactionResult.outcome === 'conflict') {
      this.options.log.info(
        {
          event: 'agent.mutation.refresh_conflict',
          proposalId,
          agentSessionId,
          conflictCode: transactionResult.conflict.code,
          durationMs: Date.now() - startedAt
        },
        'Stale Agent section proposal conflicts with the current revision'
      )
      return approveMutationProposalResultSchema.parse({
        ...transactionResult,
        sectionChanged: null
      })
    }

    this.options.log.info(
      {
        event: 'agent.mutation.refresh_satisfied',
        proposalId,
        agentSessionId,
        durationMs: Date.now() - startedAt
      },
      'Stale Agent section proposal was already satisfied'
    )
    const warnings = this.#resolveReviewIssues(transactionResult.proposal)
    return approveMutationProposalResultSchema.parse({
      ...transactionResult,
      sectionChanged: null,
      warnings
    })
  }

  #resolveReviewIssues(proposal: MutationProposalRecord): string[] {
    const targets = proposal.payload.provenance.resolvesReviewIssues ?? []
    if (targets.length === 0 || this.options.reviewIssues === undefined) return []
    return this.options.reviewIssues.resolveForProposal(proposal.proposalId, targets, {
      agentSessionId: proposal.agentSessionId,
      agentRunId: proposal.agentRunId
    })
  }

  #approveProposal(
    database: Database.Database,
    agentSessionId: string,
    proposalId: string
  ): ApprovalTransactionResult {
    const row = requireProposal(database, agentSessionId, proposalId)
    if (row.status !== 'pending' && row.status !== 'generating') {
      throw new MutationProposalError(
        'proposal_not_pending',
        'Mutation proposal is no longer pending'
      )
    }
    const payload = persistedMutationProposalPayloadSchema.parse(JSON.parse(row.payload_json))
    if (payload.kind !== 'section_patch') {
      return {
        outcome: 'applied',
        transaction: this.#applyProposal(database, agentSessionId, proposalId)
      }
    }
    const section = database
      .prepare('SELECT * FROM sections WHERE section_id = ?')
      .get(payload.mutation.sectionId) as SectionTable | undefined
    if (section === undefined || section.deleted_at !== null) {
      return this.#recordRefreshConflict(
        database,
        row,
        'target_missing',
        'The proposal target is no longer available'
      )
    }
    if (section.current_revision_id === payload.mutation.baseRevisionId) {
      return {
        outcome: 'applied',
        transaction: this.#applyProposal(database, agentSessionId, proposalId)
      }
    }
    return this.#refreshSectionProposal(database, row, payload, section)
  }

  #refreshSectionProposal(
    database: Database.Database,
    row: MutationProposalTable,
    payload: Extract<
      ReturnType<typeof persistedMutationProposalPayloadSchema.parse>,
      { kind: 'section_patch' }
    >,
    section: SectionTable
  ): ApprovalTransactionResult {
    const base = database
      .prepare('SELECT * FROM section_revisions WHERE section_revision_id = ?')
      .get(payload.mutation.baseRevisionId) as SectionRevisionTable | undefined
    const current = database
      .prepare('SELECT * FROM section_revisions WHERE section_revision_id = ?')
      .get(section.current_revision_id) as SectionRevisionTable | undefined
    if (
      base === undefined ||
      current === undefined ||
      base.section_id !== payload.mutation.sectionId ||
      current.section_id !== payload.mutation.sectionId ||
      Number(base.content_body_retained) !== 1 ||
      Number(current.content_body_retained) !== 1
    ) {
      return this.#recordRefreshConflict(
        database,
        row,
        'base_unavailable',
        'The proposal base revision is no longer available'
      )
    }

    let baseDocument: BlockNoteDocument
    let currentDocument: BlockNoteDocument
    try {
      baseDocument = blockNoteDocumentSchema.parse(JSON.parse(base.content_json))
      currentDocument = blockNoteDocumentSchema.parse(JSON.parse(current.content_json))
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.mutation.refresh_analysis_failed',
          err,
          proposalId: row.mutation_proposal_id
        },
        'Agent section proposal refresh could not parse a retained revision'
      )
      return this.#recordRefreshConflict(
        database,
        row,
        'invalid_result',
        'The proposal cannot be refreshed because a retained revision is invalid'
      )
    }

    const analysis = analyzeSectionProposalRefresh(
      baseDocument,
      currentDocument,
      payload.mutation,
      current.section_revision_id
    )
    if (analysis.kind === 'conflict') {
      return this.#recordRefreshConflict(database, row, analysis.code, analysis.message)
    }
    if (analysis.kind === 'satisfied') {
      const proposal = updateTerminalProposal(
        database,
        row.mutation_proposal_id,
        'satisfied',
        'The current section already contains this proposal change',
        this.#now().toISOString()
      )
      return { outcome: 'already_satisfied', proposal }
    }

    const replacementId = this.#createId()
    const now = this.#now().toISOString()
    const replacementPayload = persistedMutationProposalPayloadSchema.parse({
      ...payload,
      mutation: analysis.mutation,
      preview: createPreview({
        summary: payload.preview.summary,
        affectedSectionIds: [payload.mutation.sectionId],
        beforeText: analysis.simulation.beforeText,
        afterText: analysis.simulation.afterText,
        citedSources: payload.preview.citedSources
      })
    })
    const payloadJson = JSON.stringify(replacementPayload)
    if (Buffer.byteLength(payloadJson) > MAX_PROPOSAL_PAYLOAD_BYTES) {
      return this.#recordRefreshConflict(
        database,
        row,
        'invalid_result',
        'The refreshed proposal is too large to review safely'
      )
    }
    validateMutationAssetReferences(database, replacementPayload.mutation)
    database
      .prepare(
        `INSERT INTO mutation_proposals (
           mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
           agent_tool_call_id, kind, payload_json, base_revision_id,
           base_brief_version, base_outline_version, status, decision_at,
           applied_revision_id, applied_brief_version, applied_outline_version,
           undo_revision_id, replaces_proposal_id, rejected_reason, writing_task_id,
           writing_task_step_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'section_patch', ?, ?, NULL, NULL, 'pending', NULL,
                   NULL, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?)`
      )
      .run(
        replacementId,
        row.agent_session_id,
        row.agent_run_id,
        row.tool_call_event_id,
        row.agent_tool_call_id,
        payloadJson,
        current.section_revision_id,
        row.mutation_proposal_id,
        row.writing_task_id,
        row.writing_task_step_id,
        now,
        now
      )
    const previousProposal = updateTerminalProposal(
      database,
      row.mutation_proposal_id,
      'superseded',
      'A refreshed proposal replaces this outdated proposal',
      now
    )
    const replacement = proposalFromRow(
      database
        .prepare('SELECT * FROM mutation_proposals WHERE mutation_proposal_id = ?')
        .get(replacementId) as MutationProposalTable
    )
    return { outcome: 'refresh_required', previousProposal, proposal: replacement }
  }

  #recordRefreshConflict(
    database: Database.Database,
    row: MutationProposalTable,
    code: SectionProposalRefreshConflictCode,
    message: string
  ): ApprovalTransactionResult {
    const proposal = updateTerminalProposal(
      database,
      row.mutation_proposal_id,
      'conflicted',
      message,
      this.#now().toISOString()
    )
    return { outcome: 'conflict', proposal, conflict: { code, message } }
  }

  #applyProposal(
    database: Database.Database,
    agentSessionId: string,
    proposalId: string
  ): ApplyTransactionResult {
    const row = requireProposal(database, agentSessionId, proposalId)
    if (row.status !== 'pending' && row.status !== 'generating') {
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
      case 'generated_image_insert': {
        const mutation = payload.mutation
        if (mutation.assetId === null || mutation.imageModelRequestId === null) {
          throw new MutationProposalError(
            'invalid_proposal',
            'Generated image proposal has no published asset'
          )
        }
        const section = requireSection(database, mutation.sectionId)
        if (section.current_revision_id !== mutation.baseRevisionId) throw staleBase('section')
        const base = requireRevision(database, mutation.baseRevisionId)
        if (base.section_id !== mutation.sectionId || Number(base.content_body_retained) !== 1) {
          throw new MutationProposalError('stale_base', 'Section base revision is unavailable')
        }
        const imageBlockId = this.#createId()
        const patch = sectionPatchSchema.parse({
          schemaVersion: 1,
          sectionId: mutation.sectionId,
          baseRevisionId: mutation.baseRevisionId,
          operations: [
            {
              type: 'insertBlocks',
              anchorBlockId: mutation.anchor?.blockId ?? null,
              placement: mutation.placement,
              blocks: [
                {
                  id: imageBlockId,
                  type: 'image',
                  props: {
                    backgroundColor: 'default',
                    textAlignment: 'center',
                    name: mutation.altText,
                    url: assetUrl(mutation.assetId),
                    caption: mutation.caption,
                    figureId: figureIdForBlock(mutation.sectionId, imageBlockId),
                    altText: mutation.altText,
                    showPreview: true,
                    previewWidth: 720
                  },
                  children: []
                }
              ]
            }
          ],
          citationIds: []
        })
        const simulation = simulateSectionPatch(
          blockNoteDocumentSchema.parse(JSON.parse(base.content_json)),
          patch
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
    if (row.kind !== 'section_patch' && row.kind !== 'generated_image_insert') {
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

function proposalCitationIds(toolName: AgentProposalToolName, rawArgs: unknown): string[] {
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

function verifyBlockPrecondition(
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

function findDocumentBlock(
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

function resolveImageIteration(
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

function composeImageIterationPrompt(
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

function truncateImagePromptUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value
  let result = ''
  let size = 0
  for (const character of value) {
    const nextSize = Buffer.byteLength(character)
    if (size + nextSize > maximumBytes - 3) break
    result += character
    size += nextSize
  }
  return `${result}…`
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

function formatWritingRulesPreview(state: WritingRulesState): string {
  if (state.rules.length === 0) return 'No Writing Rules'
  return state.rules
    .map((rule) => {
      const details = [
        rule.preferredForm === null ? null : `prefer “${rule.preferredForm}”`,
        rule.discouragedForms.length === 0
          ? null
          : `avoid ${rule.discouragedForms.map((value) => `“${value}”`).join(', ')}`
      ].filter((value): value is string => value !== null)
      return `${rule.active ? 'Active' : 'Inactive'} · ${rule.category}\n${rule.instruction}${
        details.length === 0 ? '' : `\n${details.join(' · ')}`
      }`
    })
    .join('\n\n')
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

function updateTerminalProposal(
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
    replacesProposalId: row.replaces_proposal_id,
    rejectedReason: row.rejected_reason,
    writingTaskId: row.writing_task_id,
    writingTaskStepId: row.writing_task_step_id,
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

function validateMutationAssetReferences(database: Database.Database, mutation: unknown): void {
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
