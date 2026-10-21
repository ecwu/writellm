/** Create the standard error used when a cancellable operation stops. */
export function createAbortError(
  message = 'The operation was aborted',
  options?: ErrorOptions
): Error {
  const error = new Error(message, options)
  error.name = 'AbortError'
  return error
}

/** Return true when an operation failed because its cancellation signal fired. */
export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError'
}
