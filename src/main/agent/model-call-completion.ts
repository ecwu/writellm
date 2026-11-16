import type { AgentRuntimeEvent } from '../../shared/contracts/agent'
import type {
  ModelRequestRepository,
  SafeModelRequestError
} from '../providers/model-request-repository'

export type ModelCallFinishedEvent = Extract<AgentRuntimeEvent, { type: 'model_call_finished' }>

/** Persist completion without changing either caller's retention or retry policy. */
export async function completeModelCall(
  repository: Pick<ModelRequestRepository, 'succeed' | 'abort' | 'fail'>,
  event: ModelCallFinishedEvent,
  policy: 'writing' | 'notebook'
): Promise<SafeModelRequestError | null> {
  const retention = policy === 'notebook' ? 'metadata_only' : 'standard'
  if (event.outcome === 'succeeded') {
    await repository.succeed(
      event.modelRequestId,
      { metadata: event.metadata, outputItems: 1 },
      retention
    )
    return null
  }
  if (event.outcome === 'aborted') {
    await repository.abort(event.modelRequestId, 'aborted', event.metadata, retention)
    return { code: 'aborted', retryable: false }
  }

  // Writing timeouts historically retain no completion metadata or HTTP status.
  const writingTimeout = policy === 'writing' && event.outcome === 'timed_out'
  const statusRetryable = event.httpStatus === 429 || (event.httpStatus ?? 0) >= 500
  const error: SafeModelRequestError = {
    code:
      event.outcome === 'timed_out'
        ? 'provider_timeout'
        : (event.failureCode ?? 'provider_request_failed'),
    retryable:
      event.outcome === 'timed_out' ||
      (policy === 'notebook'
        ? event.retryable === true || statusRetryable
        : (event.retryable ?? statusRetryable)),
    ...(writingTimeout || event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus })
  }
  await repository.fail(
    event.modelRequestId,
    error,
    writingTimeout ? undefined : event.metadata,
    retention
  )
  return error
}
