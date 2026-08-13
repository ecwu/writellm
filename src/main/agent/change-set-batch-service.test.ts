import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ApproveMutationProposalResult,
  MutationProposalRecord
} from '../../shared/contracts/agent-mutations'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { WritingTaskService } from './writing-task-service'
import { ChangeSetBatchService } from './change-set-batch-service'

const directories: string[] = []
const log = pino({ level: 'silent' })
const projectId = '019d0000-0000-7000-8000-000000000500'
const projectSessionId = '019d0000-0000-7000-8000-000000000501'
const sessionId = '019d0000-0000-7000-8000-000000000502'
const runId = '019d0000-0000-7000-8000-000000000503'
const stepRef = '019d0000-0000-7000-8000-000000000504'
const commandId = '019d0000-0000-7000-8000-000000000505'

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('ChangeSetBatchService', () => {
  it('orders existing authorities, stops on conflict, and returns the same durable partial receipt', async () => {
    const database = await createProject()
    seedActor(database)
    const task = new WritingTaskService({ database, log }).create(
      { objective: 'Revise the manuscript', steps: [{ clientRef: stepRef, title: 'Revise' }] },
      { agentSessionId: sessionId, agentRunId: runId }
    ).task
    const section = proposal(
      '019d0000-0000-7000-8000-000000000506',
      'section_patch',
      task.taskId,
      0
    )
    const outline = proposal(
      '019d0000-0000-7000-8000-000000000507',
      'outline_patch',
      task.taskId,
      1
    )
    const brief = proposal('019d0000-0000-7000-8000-000000000508', 'brief_update', task.taskId, 2)
    const proposals = [section, outline, brief]
    seedProposalRows(database, proposals)
    const approve = vi.fn(async (input: { proposalId: string }) => {
      const current = proposals.find((item) => item.proposalId === input.proposalId)
      if (current === undefined) throw new Error('missing')
      if (current.kind === 'outline_patch') {
        current.status = 'conflicted'
        return {
          outcome: 'conflict',
          proposal: current,
          conflict: { code: 'target_changed', message: 'Outline changed.' },
          sectionChanged: null,
          warnings: []
        } satisfies ApproveMutationProposalResult
      }
      current.status = 'applied'
      return {
        outcome: 'applied',
        proposal: current,
        sectionChanged: null,
        warnings: []
      } satisfies ApproveMutationProposalResult
    })
    const recordDecision = vi.fn(async () => undefined)
    const service = new ChangeSetBatchService({
      projectSessionId,
      database,
      mutations: { list: () => proposals, approve } as never,
      recordDecision,
      log
    })
    const input = {
      projectSessionId,
      agentSessionId: sessionId,
      taskId: task.taskId,
      commandId,
      action: 'apply' as const,
      proposalIds: proposals.map((item) => item.proposalId),
      rejectReason: null,
      createCheckpoint: true
    }
    const first = await service.execute(input, async () => 'created')

    expect(approve.mock.calls.map(([value]) => value.proposalId)).toEqual([
      brief.proposalId,
      outline.proposalId
    ])
    expect(first).toMatchObject({
      status: 'partial',
      checkpointStatus: 'created',
      completedCount: 2,
      remainingCount: 1,
      items: [
        { proposalId: brief.proposalId, status: 'applied' },
        { proposalId: outline.proposalId, status: 'conflicted' },
        { proposalId: section.proposalId, status: 'skipped' }
      ],
      review: { reconciled: false, appliedCount: 1, adverseCount: 2 }
    })
    const repeated = await new ChangeSetBatchService({
      projectSessionId,
      database,
      mutations: { list: () => proposals, approve } as never,
      recordDecision,
      log
    }).execute(input, async () => {
      throw new Error('A completed checkpoint must not repeat')
    })
    expect(repeated).toEqual(first)
    expect(approve).toHaveBeenCalledTimes(2)
  })

  it('reconciles an applied effect after a crash and resumes without applying it twice', async () => {
    const database = await createProject()
    seedActor(database)
    const task = new WritingTaskService({ database, log }).create(
      { objective: 'Revise the manuscript', steps: [{ clientRef: stepRef, title: 'Revise' }] },
      { agentSessionId: sessionId, agentRunId: runId }
    ).task
    const item = proposal('019d0000-0000-7000-8000-000000000509', 'brief_update', task.taskId, 0)
    item.status = 'applied'
    const ordered = [item.proposalId]
    const input = {
      projectSessionId,
      agentSessionId: sessionId,
      taskId: task.taskId,
      commandId,
      action: 'apply' as const,
      proposalIds: ordered,
      rejectReason: null,
      createCheckpoint: false
    }
    const fingerprint = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256')
        .update(
          JSON.stringify({
            taskId: task.taskId,
            agentSessionId: sessionId,
            action: 'apply',
            ordered,
            rejectReason: null,
            createCheckpoint: false
          })
        )
        .digest('hex')
    )
    database.immediate((native) => {
      const now = new Date().toISOString()
      native
        .prepare(
          `INSERT INTO agent_change_set_commands (
             command_id, writing_task_id, agent_session_id, request_fingerprint, action,
             ordered_proposal_ids_json, reject_reason, checkpoint_status, checkpoint_requested,
             next_index, results_json, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'apply', ?, NULL, 'not_requested', 0, 0, '[]', 'running', ?, ?)`
        )
        .run(commandId, task.taskId, sessionId, fingerprint, JSON.stringify(ordered), now, now)
    })
    const approve = vi.fn()
    const recordDecision = vi.fn(async () => undefined)
    const result = await new ChangeSetBatchService({
      projectSessionId,
      database,
      mutations: { list: () => [item], approve } as never,
      recordDecision,
      log
    }).execute(input, async () => 'not_requested')

    expect(result).toMatchObject({ status: 'completed', completedCount: 1, remainingCount: 0 })
    expect(approve).not.toHaveBeenCalled()
    expect(recordDecision).toHaveBeenCalledOnce()

    item.status = 'undone'
    const afterUndo = await new ChangeSetBatchService({
      projectSessionId,
      database,
      mutations: { list: () => [item], approve } as never,
      recordDecision,
      log
    }).execute(input, async () => 'not_requested')
    expect(afterUndo).toMatchObject({
      status: 'completed',
      items: [{ status: 'applied', authoritativeStatus: 'undone' }],
      review: { reconciled: false, adverseCount: 1 }
    })
    expect(approve).not.toHaveBeenCalled()
  })
})

async function createProject(): Promise<ProjectDatabase> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-change-set-'))
  directories.push(parent)
  const projectRoot = join(parent, 'Change set.writellm')
  await mkdir(projectRoot)
  return initializeProjectDatabase({
    projectRoot,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId,
      createdAt: '2026-08-13T00:00:00.000Z'
    },
    applicationVersion: 'test',
    log
  })
}

function seedActor(database: ProjectDatabase): void {
  database.immediate((native) => {
    const now = '2026-08-13T00:00:00.000Z'
    native
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version, status,
           created_at, updated_at, archived_at
         ) VALUES (?, 'Task', 'test', 3, 'active', ?, ?, NULL)`
      )
      .run(sessionId, now, now)
    native
      .prepare(
        `INSERT INTO agent_runs (
           agent_run_id, agent_session_id, status, provider_id, model_id,
           provider_fingerprint, model_fingerprint, editor_context_json, error_json,
           started_at, completed_at, created_at, updated_at
         ) VALUES (?, ?, 'running', 'provider', 'model', ?, ?, '{}', NULL, ?, NULL, ?, ?)`
      )
      .run(runId, sessionId, 'a'.repeat(64), 'b'.repeat(64), now, now, now)
  })
}

function proposal(
  proposalId: string,
  kind: MutationProposalRecord['kind'],
  taskId: string,
  offset: number
): MutationProposalRecord {
  return {
    proposalId,
    agentSessionId: sessionId,
    agentRunId: runId,
    agentToolCallId: `tool-${offset}`,
    kind,
    payload: {} as MutationProposalRecord['payload'],
    status: 'pending',
    decisionAt: null,
    appliedRevisionId: null,
    appliedBriefVersion: null,
    appliedOutlineVersion: null,
    undoRevisionId: null,
    replacesProposalId: null,
    rejectedReason: null,
    writingTaskId: taskId,
    writingTaskStepId: null,
    createdAt: `2026-08-13T00:00:0${offset}.000Z`,
    updatedAt: `2026-08-13T00:00:0${offset}.000Z`
  }
}

function seedProposalRows(database: ProjectDatabase, proposals: MutationProposalRecord[]): void {
  database.immediate((native) => {
    const baseRevisionId = native
      .prepare('SELECT current_revision_id FROM sections LIMIT 1')
      .pluck()
      .get() as string
    for (const [index, proposal] of proposals.entries()) {
      const eventId = `change-set-event-${index}`
      native
        .prepare(
          `INSERT INTO agent_events (
             agent_event_id, agent_session_id, agent_run_id, sequence, type, payload_json, created_at
           ) VALUES (?, ?, ?, ?, 'tool_call', '{}', ?)`
        )
        .run(eventId, sessionId, runId, index + 1, proposal.createdAt)
      native
        .prepare(
          `INSERT INTO mutation_proposals (
             mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
             agent_tool_call_id, kind, payload_json, base_revision_id, base_brief_version,
             base_outline_version, status, writing_task_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, 'pending', ?, ?, ?)`
        )
        .run(
          proposal.proposalId,
          sessionId,
          runId,
          eventId,
          proposal.agentToolCallId,
          proposal.kind,
          proposal.kind === 'section_patch' || proposal.kind === 'generated_image_insert'
            ? baseRevisionId
            : null,
          proposal.kind === 'brief_update' ? 1 : null,
          proposal.kind === 'outline_patch' ? 1 : null,
          proposal.writingTaskId,
          proposal.createdAt,
          proposal.updatedAt
        )
    }
  })
}
