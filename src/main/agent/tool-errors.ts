export class AgentToolDomainError extends Error {
  constructor(
    readonly code:
      | 'invalid_arguments'
      | 'unauthorized'
      | 'unavailable'
      | 'not_found'
      | 'conflict'
      | 'stale_cursor'
      | 'result_too_large'
      | 'deadline_exceeded'
      | 'aborted'
      | 'internal',
    message: string,
    readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AgentToolDomainError'
  }
}
