import type { Logger } from 'pino'

export const PROJECT_INTERACTIVE_MODEL_LIMIT = 3

export type ProjectInteractiveWorkKind = 'agent_run' | 'agent_compaction' | 'notebook_turn'

export class ProjectInteractiveModelCapacityError extends Error {
  constructor() {
    super(
      `Up to ${PROJECT_INTERACTIVE_MODEL_LIMIT} Agent or Notebook tasks can work at once. Stop one or wait for it to finish.`
    )
    this.name = 'ProjectInteractiveModelCapacityError'
  }
}

interface InteractiveReservation {
  ownerId: string
  kind: ProjectInteractiveWorkKind
}

export class ProjectInteractiveModelLimiter {
  readonly #reservations = new Map<string, InteractiveReservation>()

  constructor(
    private readonly projectId: string,
    private readonly log: Pick<Logger, 'info' | 'warn'>
  ) {}

  acquire(input: {
    workId: string
    ownerId: string
    kind: ProjectInteractiveWorkKind
    signal?: AbortSignal
  }): void {
    input.signal?.throwIfAborted()
    if (this.#reservations.has(input.workId)) {
      throw new Error('Interactive model work ID is already reserved')
    }
    if (this.#reservations.size >= PROJECT_INTERACTIVE_MODEL_LIMIT) {
      this.log.warn(
        {
          event: 'agent.interactive_model_slot.rejected',
          projectId: this.projectId,
          workId: input.workId,
          ownerId: input.ownerId,
          kind: input.kind,
          activeCount: this.#reservations.size,
          concurrencyLimit: PROJECT_INTERACTIVE_MODEL_LIMIT
        },
        'Project interactive model slot rejected'
      )
      throw new ProjectInteractiveModelCapacityError()
    }
    this.#reservations.set(input.workId, { ownerId: input.ownerId, kind: input.kind })
    this.log.info(
      {
        event: 'agent.interactive_model_slot.acquired',
        projectId: this.projectId,
        workId: input.workId,
        ownerId: input.ownerId,
        kind: input.kind,
        activeCount: this.#reservations.size,
        concurrencyLimit: PROJECT_INTERACTIVE_MODEL_LIMIT
      },
      'Project interactive model slot acquired'
    )
  }

  release(workId: string): void {
    const reservation = this.#reservations.get(workId)
    if (reservation === undefined) return
    this.#reservations.delete(workId)
    this.log.info(
      {
        event: 'agent.interactive_model_slot.released',
        projectId: this.projectId,
        workId,
        ownerId: reservation.ownerId,
        kind: reservation.kind,
        activeCount: this.#reservations.size,
        concurrencyLimit: PROJECT_INTERACTIVE_MODEL_LIMIT
      },
      'Project interactive model slot released'
    )
  }

  activeCount(): number {
    return this.#reservations.size
  }
}
