import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import {
  initializeProjectDatabase,
  openProjectDatabase,
  type ProjectDatabase
} from '../project/project-database'
import { AgentToolDomainError } from './read-tools'
import { WritingTaskService } from './writing-task-service'

const directories: string[] = []
const log = pino({ level: 'silent' })
const projectId = '019d0000-0000-7000-8000-000000000200'
const sessionId = '019d0000-0000-7000-8000-000000000201'
const runId = '019d0000-0000-7000-8000-000000000202'
const firstRef = '019d0000-0000-7000-8000-000000000203'
const secondRef = '019d0000-0000-7000-8000-000000000204'

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('WritingTaskService', () => {
  it('creates one conversation task, preserves stable IDs, and advances versions exactly once', async () => {
    const { database } = await createProject()
    seedActor(database)
    const service = new WritingTaskService({ database, log })
    const created = service.create(
      {
        objective: 'Revise the complete manuscript.',
        steps: [
          { clientRef: firstRef, title: 'Inspect the outline' },
          { clientRef: secondRef, title: 'Revise the sections' }
        ]
      },
      { agentSessionId: sessionId, agentRunId: runId }
    )
    expect(created.task.planVersion).toBe(1)
    expect(created.task.plan.steps.map((step) => step.status)).toEqual(['active', 'pending'])
    expect(service.activeCorrelation(sessionId)).toEqual({
      taskId: created.task.taskId,
      stepId: created.createdStepRefs[firstRef]
    })
    expect(() =>
      service.create(
        { objective: 'Duplicate', steps: [{ clientRef: firstRef, title: 'Duplicate' }] },
        { agentSessionId: sessionId, agentRunId: runId }
      )
    ).toThrow(AgentToolDomainError)

    const firstStepId = created.createdStepRefs[firstRef]
    const secondStepId = created.createdStepRefs[secondRef]
    if (firstStepId === undefined || secondStepId === undefined) throw new Error('Missing step IDs')
    const updated = service.update(
      {
        taskId: created.task.taskId,
        expectedPlanVersion: 1,
        objective: created.task.objective,
        steps: [
          {
            stepId: firstStepId,
            title: 'Inspect the outline',
            status: 'completed',
            statusReason: null
          },
          {
            stepId: secondStepId,
            title: 'Revise the sections',
            status: 'active',
            statusReason: null
          }
        ]
      },
      { agentSessionId: sessionId, agentRunId: runId }
    )
    expect(updated.task.planVersion).toBe(2)
    expect(updated.task.plan.steps.map((step) => step.stepId)).toEqual([firstStepId, secondStepId])
    expect(() =>
      service.update(
        {
          taskId: created.task.taskId,
          expectedPlanVersion: 1,
          objective: created.task.objective,
          steps: updated.task.plan.steps
        },
        { agentSessionId: sessionId, agentRunId: runId }
      )
    ).toThrow(/changed/u)
    database.close()
  })

  it('survives archive and database reopen while rejecting terminal rollback', async () => {
    const { database, projectRoot, manifest } = await createProject()
    seedActor(database)
    const service = new WritingTaskService({ database, log })
    const created = service.create(
      { objective: 'Finish one step.', steps: [{ clientRef: firstRef, title: 'Finish' }] },
      { agentSessionId: sessionId, agentRunId: runId }
    )
    const stepId = created.createdStepRefs[firstRef]
    if (stepId === undefined) throw new Error('Missing step ID')
    const completed = service.update(
      {
        taskId: created.task.taskId,
        expectedPlanVersion: 1,
        objective: created.task.objective,
        steps: [{ stepId, title: 'Finish', status: 'completed', statusReason: null }]
      },
      { agentSessionId: sessionId, agentRunId: runId }
    )
    expect(() =>
      service.update(
        {
          taskId: created.task.taskId,
          expectedPlanVersion: completed.task.planVersion,
          objective: created.task.objective,
          steps: [{ stepId, title: 'Finish', status: 'active', statusReason: null }]
        },
        { agentSessionId: sessionId, agentRunId: runId }
      )
    ).toThrow(/cannot move/u)
    database.immediate((native) =>
      native
        .prepare(
          "UPDATE agent_sessions SET status = 'archived', archived_at = ?, updated_at = ? WHERE agent_session_id = ?"
        )
        .run('2026-08-13T00:01:00.000Z', '2026-08-13T00:01:00.000Z', sessionId)
    )
    database.close()

    const reopened = await openProjectDatabase({
      projectRoot,
      manifest,
      applicationVersion: 'test',
      log
    })
    expect(new WritingTaskService({ database: reopened, log }).get(sessionId).task).toMatchObject({
      taskId: created.task.taskId,
      planVersion: 2,
      plan: { steps: [{ stepId, status: 'completed' }] }
    })
    reopened.close()
  })

  it('derives failure from correlated runs and permits a durable idle user revision', async () => {
    const { database } = await createProject()
    seedActor(database)
    const service = new WritingTaskService({ database, log })
    const created = service.create(
      { objective: 'Revise safely.', steps: [{ clientRef: firstRef, title: 'Revise' }] },
      { agentSessionId: sessionId, agentRunId: runId }
    )
    const stepId = created.createdStepRefs[firstRef]
    if (stepId === undefined) throw new Error('Missing step ID')
    expect(
      database.immediate((native) =>
        native
          .prepare(
            'SELECT writing_task_id, writing_task_step_id FROM agent_runs WHERE agent_run_id = ?'
          )
          .get(runId)
      )
    ).toEqual({ writing_task_id: created.task.taskId, writing_task_step_id: stepId })
    database.immediate((native) =>
      native
        .prepare(
          `UPDATE agent_runs
              SET status = 'failed', error_json = '{"code":"provider_failed"}',
                  completed_at = ?, updated_at = ?
            WHERE agent_run_id = ?`
        )
        .run('2026-08-13T00:02:00.000Z', '2026-08-13T00:02:00.000Z', runId)
    )
    expect(service.getView(sessionId)?.progress.steps[0]).toMatchObject({
      stepId,
      state: 'failed',
      runCount: 1
    })

    const revised = service.updateByUser({
      projectSessionId: projectId,
      agentSessionId: sessionId,
      taskId: created.task.taskId,
      expectedPlanVersion: 1,
      objective: 'Revise safely and verify.',
      steps: [{ stepId, title: 'Revise and verify', status: 'active', statusReason: null }]
    })
    expect(revised).toMatchObject({
      taskId: created.task.taskId,
      planVersion: 2,
      objective: 'Revise safely and verify.',
      plan: { steps: [{ stepId, title: 'Revise and verify' }] },
      progress: { steps: [{ state: 'failed' }] }
    })
    database.close()
  })

  it('reconciles pending and rejected manuscript effects instead of trusting plan completion', async () => {
    const { database } = await createProject()
    seedActor(database)
    const service = new WritingTaskService({ database, log })
    const created = service.create(
      {
        objective: 'Update the outline.',
        steps: [{ clientRef: firstRef, title: 'Update outline' }]
      },
      { agentSessionId: sessionId, agentRunId: runId }
    )
    const stepId = created.createdStepRefs[firstRef]
    if (stepId === undefined) throw new Error('Missing step ID')
    database.immediate((native) => {
      const now = '2026-08-13T00:01:00.000Z'
      native
        .prepare(
          `INSERT INTO agent_events (
             agent_event_id, agent_session_id, agent_run_id, sequence, type, payload_json, created_at
           ) VALUES ('event-task-proposal', ?, ?, 1, 'tool_call', '{}', ?)`
        )
        .run(sessionId, runId, now)
      native
        .prepare(
          `INSERT INTO mutation_proposals (
             mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
             agent_tool_call_id, kind, payload_json, base_outline_version, status,
             writing_task_id, writing_task_step_id, created_at, updated_at
           ) VALUES ('proposal-task', ?, ?, 'event-task-proposal', 'call-task',
             'outline_patch', '{}', 1, 'pending', ?, ?, ?, ?)`
        )
        .run(sessionId, runId, created.task.taskId, stepId, now, now)
    })
    expect(service.getView(sessionId)?.progress.steps[0]?.state).toBe('awaiting_review')

    service.update(
      {
        taskId: created.task.taskId,
        expectedPlanVersion: 1,
        objective: created.task.objective,
        steps: [{ stepId, title: 'Update outline', status: 'completed', statusReason: null }]
      },
      { agentSessionId: sessionId, agentRunId: runId }
    )
    expect(service.getView(sessionId)?.progress.steps[0]?.state).toBe('disagreement')
    database.immediate((native) =>
      native
        .prepare(
          `UPDATE mutation_proposals
              SET status = 'rejected', decision_at = ?, rejected_reason = 'Revise the structure',
                  updated_at = ?
            WHERE mutation_proposal_id = 'proposal-task'`
        )
        .run('2026-08-13T00:02:00.000Z', '2026-08-13T00:02:00.000Z')
    )
    expect(service.getView(sessionId)?.progress).toMatchObject({
      hasDisagreement: true,
      steps: [{ state: 'disagreement', adverseEffectCount: 1 }]
    })
    database.close()
  })
})

async function createProject(): Promise<{
  database: ProjectDatabase
  projectRoot: string
  manifest: {
    format: 'writellm-project'
    formatVersion: 1
    projectId: string
    createdAt: string
  }
}> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-task-'))
  directories.push(parent)
  const projectRoot = join(parent, 'Task.writellm')
  await mkdir(projectRoot)
  const manifest = {
    format: 'writellm-project' as const,
    formatVersion: 1 as const,
    projectId,
    createdAt: '2026-08-13T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log
  })
  return { database, projectRoot, manifest }
}

function seedActor(database: ProjectDatabase): void {
  database.immediate((native) => {
    const now = '2026-08-13T00:00:00.000Z'
    native
      .prepare(`INSERT INTO agent_sessions (
        agent_session_id, title, pi_runtime_version, event_schema_version, status,
        created_at, updated_at, archived_at
      ) VALUES (?, 'Task', 'test', 3, 'active', ?, ?, NULL)`)
      .run(sessionId, now, now)
    native
      .prepare(`INSERT INTO agent_runs (
        agent_run_id, agent_session_id, status, provider_id, model_id,
        provider_fingerprint, model_fingerprint, editor_context_json, error_json,
        started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, 'running', 'provider', 'model', ?, ?, '{}', NULL, ?, NULL, ?, ?)`)
      .run(runId, sessionId, 'a'.repeat(64), 'b'.repeat(64), now, now, now)
  })
}
