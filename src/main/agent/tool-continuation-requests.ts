import type { Logger } from 'pino'
import type {
  ModelRequestRepository,
  StartModelRequestInput
} from '../providers/model-request-repository'

interface ToolContinuation {
  repository: ModelRequestRepository
  log: Pick<Logger, 'error'>
  request: Omit<StartModelRequestInput, 'operation' | 'inputItems' | 'request'>
  continuationId: string
  pendingModelRequestIds: Set<string>
  canSend(): boolean
  send(modelRequestId: string): void
}

export class ToolContinuationRequests {
  readonly #inFlight = new Set<Promise<void>>()
  #closed = false

  async authorize(input: ToolContinuation): Promise<void> {
    if (this.#closed || !input.canSend()) return
    const operation = this.#saveAndSend(input)
    this.#inFlight.add(operation)
    try {
      await operation
    } finally {
      this.#inFlight.delete(operation)
    }
  }

  async close(): Promise<void> {
    this.#closed = true
    await Promise.allSettled(this.#inFlight)
  }

  async #saveAndSend(input: ToolContinuation): Promise<void> {
    const { repository, request, pendingModelRequestIds, continuationId } = input
    const { modelRequestId, retention } = await repository.start({
      ...request,
      operation: 'agent',
      request: {
        delivery: 'tool_continuation',
        ...(request.retention === 'metadata_only' ? {} : { continuationId })
      },
      inputItems: 1
    })
    // Settlement waits for this operation before it reads the pending IDs.
    pendingModelRequestIds.add(modelRequestId)
    if (this.#closed || !input.canSend()) return
    try {
      input.send(modelRequestId)
    } catch (err) {
      input.log.error(
        {
          event: 'agent.run.tool_continuation_delivery_failed',
          err,
          modelRequestId,
          continuationId
        },
        'Failed to deliver an Agent tool continuation authorization'
      )
      await repository.abort(modelRequestId, 'authorization_delivery_failed', undefined, retention)
      pendingModelRequestIds.delete(modelRequestId)
      throw err
    }
  }
}
