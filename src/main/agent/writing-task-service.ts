import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  createWritingTaskArgsSchema,
  createWritingTaskResultSchema,
  getWritingTaskResultSchema,
  updateWritingTaskArgsSchema,
  updateWritingTaskResultSchema,
  userUpdateWritingTaskInputSchema,
  writingTaskViewSchema,
  writingTaskPlanSchema,
  writingTaskRecordSchema,
  type WritingTaskRecord,
  type WritingTaskProgressState,
  type WritingTaskStep,
  type WritingTaskStepStatus
} from '../../shared/contracts/writing-task'
import type { ProjectDatabase } from '../project/project-database'
import type { AgentWritingTaskTable } from '../project/database-types'
import { AgentToolDomainError } from './read-tools'

interface TaskActor {
  agentSessionId: string
  agentRunId: string
}

export class WritingTaskService {
  constructor(
    private readonly options: {
      database: ProjectDatabase
      log: Pick<Logger, 'info' | 'error'>
      now?: () => Date
      createId?: () => string
    }
  ) {}

  get(agentSessionId: string) {
    return this.options.database.immediate((database) =>
      getWritingTaskResultSchema.parse({
        task: mapOptionalTask(
          database
            .prepare('SELECT * FROM agent_writing_tasks WHERE agent_session_id = ?')
            .get(agentSessionId) as AgentWritingTaskTable | undefined
        )
      })
    )
  }

  create(rawArgs: unknown, actor: TaskActor) {
    const args = createWritingTaskArgsSchema.parse(rawArgs)
    const startedAt = Date.now()
    try {
      const result = this.options.database.immediate((database) => {
        assertActor(database, actor)
        const duplicateRefs = new Set<string>()
        const createdStepRefs: Record<string, string> = {}
        const steps: WritingTaskStep[] = args.steps.map((step, index) => {
          if (duplicateRefs.has(step.clientRef)) {
            throw new AgentToolDomainError(
              'conflict',
              `Expected unique writing-task clientRef values; duplicate found at steps[${index}]. Call get_writing_task, replace that clientRef, and retry once`
            )
          }
          duplicateRefs.add(step.clientRef)
          const stepId = this.#createId()
          createdStepRefs[step.clientRef] = stepId
          return {
            stepId,
            title: step.title,
            status: index === 0 ? 'active' : 'pending',
            statusReason: null
          }
        })
        const taskId = this.#createId()
        const now = this.#now()
        const plan = writingTaskPlanSchema.parse({ schemaVersion: 1, steps })
        try {
          database
            .prepare(
              `INSERT INTO agent_writing_tasks (
                 writing_task_id, agent_session_id, objective, plan_version, plan_json,
                 created_by_agent_run_id, created_at, updated_at
               ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
            )
            .run(
              taskId,
              actor.agentSessionId,
              args.objective,
              JSON.stringify(plan),
              actor.agentRunId,
              now,
              now
            )
          database
            .prepare(
              `UPDATE agent_runs
                  SET writing_task_id = ?, writing_task_step_id = ?
                WHERE agent_run_id = ? AND agent_session_id = ? AND status = 'running'`
            )
            .run(taskId, steps[0]?.stepId ?? null, actor.agentRunId, actor.agentSessionId)
        } catch (err) {
          if (isUniqueConstraint(err)) {
            throw new AgentToolDomainError(
              'conflict',
              'This Agent conversation already has a writing task'
            )
          }
          throw err
        }
        return createWritingTaskResultSchema.parse({
          task: mapTask(requireTask(database, taskId)),
          createdStepRefs
        })
      })
      this.options.log.info(
        {
          event: 'agent.writing_task.created',
          agentSessionId: actor.agentSessionId,
          agentRunId: actor.agentRunId,
          writingTaskId: result.task.taskId,
          stepCount: result.task.plan.steps.length,
          durationMs: Date.now() - startedAt
        },
        'Agent writing task created'
      )
      return result
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.writing_task.create_failed',
          err,
          agentSessionId: actor.agentSessionId,
          agentRunId: actor.agentRunId
        },
        'Agent writing task creation failed'
      )
      throw err
    }
  }

  update(rawArgs: unknown, actor: TaskActor) {
    const args = updateWritingTaskArgsSchema.parse(rawArgs)
    const startedAt = Date.now()
    try {
      const result = this.options.database.immediate((database) => {
        assertActor(database, actor)
        return this.#applyUpdate(database, args, actor.agentSessionId)
      })
      this.options.log.info(
        {
          event: 'agent.writing_task.updated',
          agentSessionId: actor.agentSessionId,
          agentRunId: actor.agentRunId,
          writingTaskId: result.task.taskId,
          planVersion: result.task.planVersion,
          stepCount: result.task.plan.steps.length,
          durationMs: Date.now() - startedAt
        },
        'Agent writing task updated'
      )
      return result
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.writing_task.update_failed',
          err,
          agentSessionId: actor.agentSessionId,
          agentRunId: actor.agentRunId,
          writingTaskId: args.taskId
        },
        'Agent writing task update failed'
      )
      throw err
    }
  }

  updateByUser(rawInput: unknown) {
    const input = userUpdateWritingTaskInputSchema.parse(rawInput)
    const startedAt = Date.now()
    try {
      const result = this.options.database.immediate((database) => {
        const session = database
          .prepare('SELECT status FROM agent_sessions WHERE agent_session_id = ?')
          .get(input.agentSessionId) as { status: 'active' | 'archived' } | undefined
        if (session?.status !== 'active') {
          throw new AgentToolDomainError('unauthorized', 'Writing task conversation is not active')
        }
        if (
          database
            .prepare(
              `SELECT 1 FROM agent_runs
                WHERE agent_session_id = ? AND status = 'running'`
            )
            .get(input.agentSessionId) !== undefined
        ) {
          throw new AgentToolDomainError(
            'conflict',
            'Stop the active Agent run before revising its plan'
          )
        }
        const args = updateWritingTaskArgsSchema.parse({
          taskId: input.taskId,
          expectedPlanVersion: input.expectedPlanVersion,
          objective: input.objective,
          steps: input.steps.map((step) => {
            if ('stepId' in step) return step
            const clientRef = this.#createId()
            return { ...step, clientRef }
          })
        })
        return this.#applyUpdate(database, args, input.agentSessionId)
      })
      this.options.log.info(
        {
          event: 'agent.writing_task.user_updated',
          agentSessionId: input.agentSessionId,
          writingTaskId: result.task.taskId,
          planVersion: result.task.planVersion,
          stepCount: result.task.plan.steps.length
        },
        'User revised Agent writing task'
      )
      return this.getView(input.agentSessionId)
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.writing_task.user_update_failed',
          err,
          agentSessionId: input.agentSessionId,
          writingTaskId: input.taskId,
          durationMs: Date.now() - startedAt
        },
        'User writing task revision failed'
      )
      throw err
    }
  }

  getView(agentSessionId: string, database?: Database.Database) {
    const read = (native: Database.Database) => {
      const task = mapOptionalTask(
        native
          .prepare('SELECT * FROM agent_writing_tasks WHERE agent_session_id = ?')
          .get(agentSessionId) as AgentWritingTaskTable | undefined
      )
      if (task === null) return null
      const runs = native
        .prepare(
          `WITH ranked_runs AS (
             SELECT agent_run_id, writing_task_step_id, status,
                    COUNT(*) OVER (PARTITION BY writing_task_step_id) AS run_count,
                    ROW_NUMBER() OVER (
                      PARTITION BY writing_task_step_id
                      ORDER BY started_at DESC, agent_run_id DESC
                    ) AS rank
               FROM agent_runs
              WHERE writing_task_id = ? AND writing_task_step_id IS NOT NULL
           )
           SELECT agent_run_id, writing_task_step_id, status, run_count
             FROM ranked_runs WHERE rank = 1`
        )
        .all(task.taskId) as Array<{
        agent_run_id: string
        writing_task_step_id: string
        status: 'running' | 'completed' | 'interrupted' | 'failed'
        run_count: number
      }>
      const proposals = native
        .prepare(
          `SELECT writing_task_step_id,
                  COUNT(*) AS proposal_count,
                  SUM(CASE WHEN status IN ('applied', 'satisfied') THEN 1 ELSE 0 END)
                    AS successful_effect_count,
                  SUM(CASE WHEN status IN ('pending', 'generating', 'approved') THEN 1 ELSE 0 END)
                    AS pending_effect_count,
                  SUM(CASE WHEN status NOT IN (
                    'applied', 'satisfied', 'pending', 'generating', 'approved'
                  ) THEN 1 ELSE 0 END) AS adverse_effect_count
             FROM mutation_proposals
            WHERE writing_task_id = ? AND writing_task_step_id IS NOT NULL
            GROUP BY writing_task_step_id`
        )
        .all(task.taskId) as Array<{
        writing_task_step_id: string
        proposal_count: number
        successful_effect_count: number
        pending_effect_count: number
        adverse_effect_count: number
      }>
      const runsByStep = new Map(runs.map((run) => [run.writing_task_step_id, run]))
      const proposalsByStep = new Map(
        proposals.map((proposal) => [proposal.writing_task_step_id, proposal])
      )
      const progressSteps = task.plan.steps.map((step) => {
        const latestRun = runsByStep.get(step.stepId)
        const effect = proposalsByStep.get(step.stepId)
        const proposalCount = effect?.proposal_count ?? 0
        const successfulEffectCount = effect?.successful_effect_count ?? 0
        const pendingEffectCount = effect?.pending_effect_count ?? 0
        const adverseEffectCount = effect?.adverse_effect_count ?? 0
        const state = reconcileStepState({
          planStatus: step.status,
          latestRunStatus: latestRun?.status ?? null,
          proposalCount,
          successfulEffectCount,
          pendingEffectCount,
          adverseEffectCount
        })
        return {
          stepId: step.stepId,
          state,
          runCount: latestRun?.run_count ?? 0,
          proposalCount,
          successfulEffectCount,
          pendingEffectCount,
          adverseEffectCount,
          latestRunId: latestRun?.agent_run_id ?? null,
          note: progressNote(state)
        }
      })
      return writingTaskViewSchema.parse({
        ...task,
        progress: {
          currentStepId: task.plan.steps.find((step) => step.status === 'active')?.stepId ?? null,
          completedCount: progressSteps.filter((step) =>
            ['verified_complete', 'reported_complete', 'skipped'].includes(step.state)
          ).length,
          remainingCount: progressSteps.filter(
            (step) => !['verified_complete', 'reported_complete', 'skipped'].includes(step.state)
          ).length,
          hasDisagreement: progressSteps.some((step) => step.state === 'disagreement'),
          steps: progressSteps
        }
      })
    }
    return database === undefined ? this.options.database.immediate(read) : read(database)
  }

  activeCorrelation(
    agentSessionId: string,
    database?: Database.Database
  ): { taskId: string; stepId: string } | null {
    const result =
      database === undefined
        ? this.get(agentSessionId).task
        : mapOptionalTask(
            database
              .prepare('SELECT * FROM agent_writing_tasks WHERE agent_session_id = ?')
              .get(agentSessionId) as AgentWritingTaskTable | undefined
          )
    if (result === null) return null
    const active = result.plan.steps.find((step) => step.status === 'active')
    return active === undefined ? null : { taskId: result.taskId, stepId: active.stepId }
  }

  #now(): string {
    return (this.options.now?.() ?? new Date()).toISOString()
  }

  #createId(): string {
    return this.options.createId?.() ?? randomUUID()
  }

  #applyUpdate(
    database: Database.Database,
    args: ReturnType<typeof updateWritingTaskArgsSchema.parse>,
    agentSessionId: string
  ) {
    const current = mapTask(requireTask(database, args.taskId))
    if (current.agentSessionId !== agentSessionId) {
      throw new AgentToolDomainError('unauthorized', 'Writing task belongs to another conversation')
    }
    if (current.planVersion !== args.expectedPlanVersion) {
      throw new AgentToolDomainError(
        'conflict',
        `Expected writing-task plan version ${args.expectedPlanVersion}, actual version is ${current.planVersion}`
      )
    }
    const currentById = new Map(current.plan.steps.map((step) => [step.stepId, step]))
    const seenExisting = new Set<string>()
    const seenRefs = new Set<string>()
    const createdStepRefs: Record<string, string> = {}
    const steps: WritingTaskStep[] = args.steps.map((candidate, index) => {
      if ('stepId' in candidate) {
        if (seenExisting.has(candidate.stepId)) {
          throw new AgentToolDomainError('conflict', 'Writing task step IDs must be unique')
        }
        seenExisting.add(candidate.stepId)
        const previous = currentById.get(candidate.stepId)
        if (previous === undefined) {
          throw new AgentToolDomainError('not_found', 'Writing task step does not exist')
        }
        assertStepTransition(previous, candidate.status, candidate.title)
        return { ...candidate }
      }
      if (seenRefs.has(candidate.clientRef)) {
        throw new AgentToolDomainError(
          'conflict',
          `Expected unique writing-task clientRef values; duplicate found at steps[${index}]`
        )
      }
      seenRefs.add(candidate.clientRef)
      const stepId = this.#createId()
      createdStepRefs[candidate.clientRef] = stepId
      return { stepId, title: candidate.title, status: candidate.status, statusReason: null }
    })
    if (seenExisting.size !== currentById.size) {
      throw new AgentToolDomainError(
        'conflict',
        'Writing task steps cannot be removed; mark an obsolete step skipped'
      )
    }
    const plan = writingTaskPlanSchema.parse({ schemaVersion: 1, steps })
    const nextVersion = current.planVersion + 1
    const now = this.#now()
    const changed = database
      .prepare(
        `UPDATE agent_writing_tasks
            SET objective = ?, plan_version = ?, plan_json = ?, updated_at = ?
          WHERE writing_task_id = ? AND agent_session_id = ? AND plan_version = ?`
      )
      .run(
        args.objective,
        nextVersion,
        JSON.stringify(plan),
        now,
        args.taskId,
        agentSessionId,
        args.expectedPlanVersion
      ).changes
    if (changed !== 1) {
      throw new AgentToolDomainError('conflict', 'Writing task plan changed; read it and retry')
    }
    return updateWritingTaskResultSchema.parse({
      task: mapTask(requireTask(database, args.taskId)),
      createdStepRefs
    })
  }
}

function reconcileStepState(input: {
  planStatus: WritingTaskStepStatus
  latestRunStatus: 'running' | 'completed' | 'interrupted' | 'failed' | null
  proposalCount: number
  successfulEffectCount: number
  pendingEffectCount: number
  adverseEffectCount: number
}): WritingTaskProgressState {
  if (input.planStatus === 'skipped') return 'skipped'
  if (input.planStatus === 'blocked') return 'blocked'
  if (input.planStatus === 'completed') {
    if (input.proposalCount === 0) {
      return input.latestRunStatus === 'failed' || input.latestRunStatus === 'interrupted'
        ? 'disagreement'
        : 'reported_complete'
    }
    if (input.pendingEffectCount > 0 || input.adverseEffectCount > 0) return 'disagreement'
    return input.successfulEffectCount === input.proposalCount
      ? 'verified_complete'
      : 'disagreement'
  }
  if (input.planStatus === 'pending') {
    return input.proposalCount > 0 || input.latestRunStatus !== null ? 'disagreement' : 'pending'
  }
  if (input.pendingEffectCount > 0) return 'awaiting_review'
  if (input.adverseEffectCount > 0) return 'disagreement'
  if (input.latestRunStatus === 'running') return 'in_progress'
  if (input.latestRunStatus === 'interrupted') return 'stopped'
  if (input.latestRunStatus === 'failed') return 'failed'
  return 'ready'
}

function progressNote(state: WritingTaskProgressState): string {
  const notes: Record<WritingTaskProgressState, string> = {
    pending: 'Planned; no correlated Agent work has started.',
    ready: 'Current step is ready to continue.',
    in_progress: 'A correlated Agent run is active.',
    awaiting_review: 'A correlated manuscript effect is awaiting review or generation.',
    verified_complete: 'All correlated manuscript effects were applied or already satisfied.',
    reported_complete: 'Reported complete; this step produced no manuscript proposal to verify.',
    stopped: 'The latest correlated Agent run was stopped and can be resumed.',
    failed: 'The latest correlated Agent run failed and can be retried.',
    blocked: 'The plan records this step as blocked.',
    skipped: 'The plan records this step as intentionally skipped.',
    disagreement:
      'Plan state and authoritative run or proposal outcomes disagree; revise or resume.'
  }
  return notes[state]
}

function assertActor(database: Database.Database, actor: TaskActor): void {
  const exists = database
    .prepare(
      `SELECT 1 FROM agent_runs
        WHERE agent_run_id = ? AND agent_session_id = ? AND status = 'running'`
    )
    .get(actor.agentRunId, actor.agentSessionId)
  if (exists === undefined) {
    throw new AgentToolDomainError('unauthorized', 'Writing task actor run is not active')
  }
}

function assertStepTransition(
  previous: WritingTaskStep,
  nextStatus: WritingTaskStepStatus,
  nextTitle: string
): void {
  const allowed: Record<WritingTaskStepStatus, readonly WritingTaskStepStatus[]> = {
    pending: ['pending', 'active', 'skipped', 'blocked'],
    active: ['active', 'completed', 'skipped', 'blocked'],
    completed: ['completed'],
    skipped: ['skipped'],
    blocked: ['blocked', 'active', 'skipped']
  }
  if (!allowed[previous.status].includes(nextStatus)) {
    throw new AgentToolDomainError(
      'conflict',
      `Writing task step cannot move from ${previous.status} to ${nextStatus}`
    )
  }
  if (
    (previous.status === 'completed' || previous.status === 'skipped') &&
    previous.title !== nextTitle
  ) {
    throw new AgentToolDomainError('conflict', 'Terminal writing task steps are immutable')
  }
}

function requireTask(database: Database.Database, taskId: string): AgentWritingTaskTable {
  const row = database
    .prepare('SELECT * FROM agent_writing_tasks WHERE writing_task_id = ?')
    .get(taskId) as AgentWritingTaskTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Writing task does not exist')
  return row
}

function mapOptionalTask(row: AgentWritingTaskTable | undefined): WritingTaskRecord | null {
  return row === undefined ? null : mapTask(row)
}

function mapTask(row: AgentWritingTaskTable): WritingTaskRecord {
  return writingTaskRecordSchema.parse({
    taskId: row.writing_task_id,
    agentSessionId: row.agent_session_id,
    objective: row.objective,
    planVersion: row.plan_version,
    plan: JSON.parse(row.plan_json),
    createdByAgentRunId: row.created_by_agent_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}

function isUniqueConstraint(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/u.test(err.message)
}
