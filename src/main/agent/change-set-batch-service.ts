import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  changeSetBatchInputSchema,
  changeSetBatchItemResultSchema,
  changeSetBatchResultSchema,
  type ChangeSetBatchInput,
  type ChangeSetBatchItemResult,
  type ChangeSetBatchResult,
  type ChangeSetCheckpointStatus
} from '../../shared/contracts/agent-change-set'
import type { MutationProposalRecord } from '../../shared/contracts/agent-mutations'
import type { ProjectDatabase } from '../project/project-database'
import type { MutationProposalService } from './mutation-service'

interface CommandRow {
  command_id: string
  writing_task_id: string
  agent_session_id: string
  request_fingerprint: string
  action: 'apply' | 'reject'
  ordered_proposal_ids_json: string
  reject_reason: string | null
  checkpoint_status: ChangeSetCheckpointStatus
  checkpoint_requested: 0 | 1
  next_index: number
  results_json: string
  status: 'prepared' | 'running' | 'completed' | 'stopped'
  created_at: string
  updated_at: string
}

const KIND_ORDER: Record<MutationProposalRecord['kind'], number> = {
  brief_update: 0,
  outline_patch: 1,
  section_patch: 2,
  generated_image_insert: 3
}

export class ChangeSetBatchService {
  readonly #commands = new Map<string, Promise<ChangeSetBatchResult>>()

  constructor(
    private readonly options: {
      projectSessionId: string
      database: ProjectDatabase
      mutations: MutationProposalService
      recordDecision(input: {
        agentSessionId: string
        agentRunId: string
        proposalId: string
        decision: 'approved' | 'rejected'
      }): Promise<void>
      log: Pick<Logger, 'info' | 'error'>
      now?: () => Date
    }
  ) {}

  execute(
    rawInput: unknown,
    ensureCheckpoint: () => Promise<Exclude<ChangeSetCheckpointStatus, 'pending'>>
  ): Promise<ChangeSetBatchResult> {
    const input = changeSetBatchInputSchema.parse(rawInput)
    if (input.projectSessionId !== this.options.projectSessionId) {
      throw new Error('Project session is not active')
    }
    const current = this.#commands.get(input.commandId)
    if (current !== undefined) return current
    const execution = this.#execute(input, ensureCheckpoint).finally(() => {
      this.#commands.delete(input.commandId)
    })
    this.#commands.set(input.commandId, execution)
    return execution
  }

  async #execute(
    input: ChangeSetBatchInput,
    ensureCheckpoint: () => Promise<Exclude<ChangeSetCheckpointStatus, 'pending'>>
  ): Promise<ChangeSetBatchResult> {
    const startedAt = Date.now()
    try {
      let row = this.#prepare(input)
      if (row.status === 'completed' || row.status === 'stopped') return this.#project(row)
      if (row.checkpoint_status === 'pending') {
        let checkpointStatus: Exclude<ChangeSetCheckpointStatus, 'pending'>
        try {
          checkpointStatus = await ensureCheckpoint()
        } catch (err) {
          this.options.log.error(
            { event: 'agent.change_set.checkpoint_failed', err, commandId: input.commandId },
            'Change-set pre-application checkpoint failed'
          )
          checkpointStatus = 'failed'
        }
        row = this.#setCheckpoint(row.command_id, checkpointStatus)
        if (checkpointStatus === 'failed') {
          row = this.#stop(row.command_id)
          return this.#project(row)
        }
      }

      const orderedIds = parseIds(row.ordered_proposal_ids_json)
      while (row.next_index < orderedIds.length) {
        const proposalId = orderedIds[row.next_index]
        if (proposalId === undefined) break
        const proposal = this.#requireProposal(row.agent_session_id, proposalId)
        const item = await this.#decide(row, proposal)
        row = this.#appendResult(row.command_id, row.next_index, item)
        if (isStop(item.status)) {
          row = this.#stop(row.command_id)
          break
        }
      }
      if (row.next_index === orderedIds.length) row = this.#complete(row.command_id)
      const result = this.#project(row)
      this.options.log.info(
        {
          event: 'agent.change_set.batch_completed',
          commandId: input.commandId,
          taskId: input.taskId,
          action: input.action,
          status: result.status,
          completedCount: result.completedCount,
          remainingCount: result.remainingCount,
          durationMs: Date.now() - startedAt
        },
        'Agent change-set batch completed'
      )
      return result
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.change_set.batch_failed',
          err,
          commandId: input.commandId,
          taskId: input.taskId,
          durationMs: Date.now() - startedAt
        },
        'Agent change-set batch failed'
      )
      throw err
    }
  }

  #prepare(input: ChangeSetBatchInput): CommandRow {
    const proposals = this.options.mutations
      .list(input.agentSessionId)
      .filter((proposal) => input.proposalIds.includes(proposal.proposalId))
    if (proposals.length !== input.proposalIds.length) {
      throw new Error('One or more selected proposals do not belong to the Agent conversation')
    }
    if (proposals.some((proposal) => proposal.writingTaskId !== input.taskId)) {
      throw new Error('One or more selected proposals do not belong to the writing task')
    }
    const ordered = [...proposals].sort(compareProposals).map((proposal) => proposal.proposalId)
    const fingerprint = requestFingerprint(input, ordered)
    return this.options.database.immediate((database) => {
      const existing = database
        .prepare('SELECT * FROM agent_change_set_commands WHERE command_id = ?')
        .get(input.commandId) as CommandRow | undefined
      if (existing !== undefined) {
        if (existing.request_fingerprint !== fingerprint) {
          throw new Error('Change-set command ID was already used for another request')
        }
        return existing
      }
      if (proposals.some((proposal) => proposal.status !== 'pending')) {
        throw new Error('Only currently pending proposals may begin a batch decision')
      }
      for (const proposal of proposals) {
        const current = database
          .prepare(
            `SELECT status, writing_task_id FROM mutation_proposals
              WHERE mutation_proposal_id = ? AND agent_session_id = ?`
          )
          .get(proposal.proposalId, input.agentSessionId) as
          | { status: string; writing_task_id: string | null }
          | undefined
        if (current?.status !== 'pending' || current.writing_task_id !== input.taskId) {
          throw new Error('Selected proposal authority changed before the batch began')
        }
      }
      const task = database
        .prepare(
          `SELECT writing_task_id FROM agent_writing_tasks
            WHERE writing_task_id = ? AND agent_session_id = ?`
        )
        .get(input.taskId, input.agentSessionId)
      if (task === undefined)
        throw new Error('Writing task does not belong to the Agent conversation')
      const now = (this.options.now?.() ?? new Date()).toISOString()
      database
        .prepare(
          `INSERT INTO agent_change_set_commands (
             command_id, writing_task_id, agent_session_id, request_fingerprint, action,
             ordered_proposal_ids_json, reject_reason, checkpoint_status, checkpoint_requested,
             next_index, results_json, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', 'prepared', ?, ?)`
        )
        .run(
          input.commandId,
          input.taskId,
          input.agentSessionId,
          fingerprint,
          input.action,
          JSON.stringify(ordered),
          input.rejectReason,
          input.createCheckpoint ? 'pending' : 'not_requested',
          input.createCheckpoint ? 1 : 0,
          now,
          now
        )
      return database
        .prepare('SELECT * FROM agent_change_set_commands WHERE command_id = ?')
        .get(input.commandId) as CommandRow
    })
  }

  async #decide(
    command: CommandRow,
    proposal: MutationProposalRecord
  ): Promise<ChangeSetBatchItemResult> {
    const prior = reconciledItem(proposal, command.action)
    if (prior !== null) {
      if (prior.status !== 'skipped') await this.#recordDecisionIfMissing(command, proposal)
      return prior
    }
    if (command.action === 'apply' && proposal.status === 'superseded') {
      const leaf = this.#replacementLeaf(command.agent_session_id, proposal)
      await this.#recordDecisionIfMissing(command, proposal)
      return changeSetBatchItemResultSchema.parse({
        proposalId: proposal.proposalId,
        effectiveProposalId: leaf.proposalId,
        kind: proposal.kind,
        status: 'refresh_required',
        authoritativeStatus: proposal.status,
        message: 'A refreshed proposal requires individual review before it can be applied.'
      })
    }
    try {
      if (command.action === 'reject') {
        const result = this.options.mutations.reject({
          projectSessionId: this.options.projectSessionId,
          agentSessionId: command.agent_session_id,
          proposalId: proposal.proposalId,
          reason: command.reject_reason ?? 'Rejected through the selected change set.',
          continueRequested: false
        })
        await this.#recordDecisionIfMissing(command, result.proposal)
        return changeSetBatchItemResultSchema.parse({
          proposalId: proposal.proposalId,
          effectiveProposalId: result.proposal.proposalId,
          kind: proposal.kind,
          status: 'rejected',
          authoritativeStatus: result.proposal.status,
          message: null
        })
      }
      const result = await this.options.mutations.approve({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: command.agent_session_id,
        proposalId: proposal.proposalId
      })
      await this.#recordDecisionIfMissing(
        command,
        result.outcome === 'refresh_required' ? result.previousProposal : result.proposal
      )
      if (result.outcome === 'applied' || result.outcome === 'already_satisfied') {
        return changeSetBatchItemResultSchema.parse({
          proposalId: proposal.proposalId,
          effectiveProposalId: result.proposal.proposalId,
          kind: proposal.kind,
          status: result.outcome === 'applied' ? 'applied' : 'satisfied',
          authoritativeStatus: result.proposal.status,
          message: result.warnings.length === 0 ? null : result.warnings.join(' ')
        })
      }
      return changeSetBatchItemResultSchema.parse({
        proposalId: proposal.proposalId,
        effectiveProposalId: result.proposal.proposalId,
        kind: proposal.kind,
        status: result.outcome === 'refresh_required' ? 'refresh_required' : 'conflicted',
        authoritativeStatus: result.proposal.status,
        message:
          result.outcome === 'refresh_required'
            ? 'A refreshed proposal requires individual review before it can be applied.'
            : result.conflict.message
      })
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.change_set.item_failed',
          err,
          commandId: command.command_id,
          proposalId: proposal.proposalId
        },
        'Agent change-set item failed'
      )
      const current = this.#requireProposal(command.agent_session_id, proposal.proposalId)
      return changeSetBatchItemResultSchema.parse({
        proposalId: proposal.proposalId,
        effectiveProposalId: current.proposalId,
        kind: proposal.kind,
        status: current.status === 'conflicted' ? 'conflicted' : 'failed',
        authoritativeStatus: current.status,
        message: 'This item failed safely; remaining items were not attempted.'
      })
    }
  }

  async #recordDecisionIfMissing(
    command: CommandRow,
    proposal: MutationProposalRecord
  ): Promise<void> {
    const decision = command.action === 'apply' ? 'approved' : 'rejected'
    const exists = this.options.database.immediate((database) =>
      database
        .prepare(
          `SELECT 1 FROM agent_events
            WHERE agent_session_id = ? AND type = 'approval_decision'
              AND json_extract(payload_json, '$.proposalId') = ?
              AND json_extract(payload_json, '$.decision') = ?
            LIMIT 1`
        )
        .get(command.agent_session_id, proposal.proposalId, decision)
    )
    if (exists !== undefined) return
    await this.options.recordDecision({
      agentSessionId: command.agent_session_id,
      agentRunId: proposal.agentRunId,
      proposalId: proposal.proposalId,
      decision
    })
  }

  #requireProposal(agentSessionId: string, proposalId: string): MutationProposalRecord {
    const proposal = this.options.mutations
      .list(agentSessionId)
      .find((candidate) => candidate.proposalId === proposalId)
    if (proposal === undefined) throw new Error('Selected proposal no longer exists')
    return proposal
  }

  #replacementLeaf(
    agentSessionId: string,
    proposal: MutationProposalRecord
  ): MutationProposalRecord {
    const proposals = this.options.mutations.list(agentSessionId)
    const replacements = new Map(
      proposals.flatMap((candidate) =>
        candidate.replacesProposalId === null
          ? []
          : ([[candidate.replacesProposalId, candidate]] as const)
      )
    )
    const seen = new Set<string>()
    let current = proposal
    while (!seen.has(current.proposalId)) {
      seen.add(current.proposalId)
      const replacement = replacements.get(current.proposalId)
      if (replacement === undefined) break
      current = replacement
    }
    return current
  }

  #setCheckpoint(commandId: string, status: ChangeSetCheckpointStatus): CommandRow {
    return this.#update(commandId, (database, now) => {
      database
        .prepare(
          `UPDATE agent_change_set_commands SET checkpoint_status = ?, updated_at = ?
            WHERE command_id = ? AND checkpoint_status = 'pending'`
        )
        .run(status, now, commandId)
    })
  }

  #appendResult(
    commandId: string,
    expectedIndex: number,
    item: ChangeSetBatchItemResult
  ): CommandRow {
    return this.#update(commandId, (database, now, row) => {
      if (row.next_index !== expectedIndex) return
      const results = parseResults(row.results_json)
      results.push(item)
      database
        .prepare(
          `UPDATE agent_change_set_commands
              SET results_json = ?, next_index = ?, status = 'running', updated_at = ?
            WHERE command_id = ? AND next_index = ?`
        )
        .run(JSON.stringify(results), expectedIndex + 1, now, commandId, expectedIndex)
    })
  }

  #stop(commandId: string): CommandRow {
    return this.#update(commandId, (database, now) => {
      database
        .prepare(
          `UPDATE agent_change_set_commands SET status = 'stopped', updated_at = ?
            WHERE command_id = ? AND status != 'completed'`
        )
        .run(now, commandId)
    })
  }

  #complete(commandId: string): CommandRow {
    return this.#update(commandId, (database, now) => {
      database
        .prepare(
          `UPDATE agent_change_set_commands SET status = 'completed', updated_at = ?
            WHERE command_id = ?`
        )
        .run(now, commandId)
    })
  }

  #update(
    commandId: string,
    update: (database: Database.Database, now: string, row: CommandRow) => void
  ): CommandRow {
    return this.options.database.immediate((database) => {
      const row = database
        .prepare('SELECT * FROM agent_change_set_commands WHERE command_id = ?')
        .get(commandId) as CommandRow
      update(database, (this.options.now?.() ?? new Date()).toISOString(), row)
      return database
        .prepare('SELECT * FROM agent_change_set_commands WHERE command_id = ?')
        .get(commandId) as CommandRow
    })
  }

  #project(row: CommandRow): ChangeSetBatchResult {
    const ids = parseIds(row.ordered_proposal_ids_json)
    const processed = parseResults(row.results_json).map((item) => {
      const current = this.#requireProposal(row.agent_session_id, item.effectiveProposalId)
      return { ...item, authoritativeStatus: current.status }
    })
    const items = [...processed]
    for (const proposalId of ids.slice(row.next_index)) {
      const proposal = this.#requireProposal(row.agent_session_id, proposalId)
      items.push(
        changeSetBatchItemResultSchema.parse({
          proposalId,
          effectiveProposalId: proposalId,
          kind: proposal.kind,
          status: 'skipped',
          authoritativeStatus: proposal.status,
          message: 'Not attempted after the batch stopped.'
        })
      )
    }
    const adverseOutcomes = items.filter((item) =>
      ['refresh_required', 'conflicted', 'failed', 'skipped'].includes(item.status)
    ).length
    const authorityMismatches = processed.filter(
      (item) =>
        ['applied', 'satisfied', 'rejected'].includes(item.status) && !itemMatchesAuthority(item)
    ).length
    const adverse = adverseOutcomes + authorityMismatches
    return changeSetBatchResultSchema.parse({
      commandId: row.command_id,
      taskId: row.writing_task_id,
      action: row.action,
      status:
        row.status === 'completed' ? 'completed' : row.next_index === 0 ? 'stopped' : 'partial',
      checkpointStatus: row.checkpoint_status,
      items,
      completedCount: row.next_index,
      remainingCount: ids.length - row.next_index,
      review: {
        reconciled: row.status === 'completed' && adverse === 0,
        appliedCount: items.filter((item) => item.status === 'applied').length,
        satisfiedCount: items.filter((item) => item.status === 'satisfied').length,
        rejectedCount: items.filter((item) => item.status === 'rejected').length,
        adverseCount: adverse
      }
    })
  }
}

function itemMatchesAuthority(item: ChangeSetBatchItemResult): boolean {
  if (item.status === 'applied') return item.authoritativeStatus === 'applied'
  if (item.status === 'satisfied') return item.authoritativeStatus === 'satisfied'
  if (item.status === 'rejected') return item.authoritativeStatus === 'rejected'
  return false
}

function compareProposals(left: MutationProposalRecord, right: MutationProposalRecord): number {
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
  if (kind !== 0) return kind
  if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt)
  return left.proposalId.localeCompare(right.proposalId)
}

function requestFingerprint(input: ChangeSetBatchInput, ordered: string[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        taskId: input.taskId,
        agentSessionId: input.agentSessionId,
        action: input.action,
        ordered,
        rejectReason: input.rejectReason,
        createCheckpoint: input.createCheckpoint
      })
    )
    .digest('hex')
}

function reconciledItem(
  proposal: MutationProposalRecord,
  action: 'apply' | 'reject'
): ChangeSetBatchItemResult | null {
  const status =
    action === 'reject' && proposal.status === 'rejected'
      ? 'rejected'
      : action === 'apply' && proposal.status === 'applied'
        ? 'applied'
        : action === 'apply' && proposal.status === 'satisfied'
          ? 'satisfied'
          : null
  if (status === null) return null
  return changeSetBatchItemResultSchema.parse({
    proposalId: proposal.proposalId,
    effectiveProposalId: proposal.proposalId,
    kind: proposal.kind,
    status,
    authoritativeStatus: proposal.status,
    message: null
  })
}

function parseIds(json: string): string[] {
  return changeSetBatchInputSchema.shape.proposalIds.parse(JSON.parse(json))
}

function parseResults(json: string): ChangeSetBatchItemResult[] {
  return changeSetBatchItemResultSchema.array().parse(JSON.parse(json))
}

function isStop(status: ChangeSetBatchItemResult['status']): boolean {
  return ['refresh_required', 'conflicted', 'failed'].includes(status)
}
