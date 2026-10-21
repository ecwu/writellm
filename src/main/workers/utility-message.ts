export interface SerializedUtilityError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly httpStatus?: number
  readonly providerCode?: string
}

export type ReconstructedUtilityError = Error & {
  status?: number
  providerCode?: string
}

/** Rebuild a bounded worker diagnostic without losing its error identity. */
export function reconstructUtilityError(
  input: SerializedUtilityError,
  options?: { cause?: unknown }
): ReconstructedUtilityError {
  const error = new Error(
    input.message,
    options === undefined || !('cause' in options) ? undefined : { cause: options.cause }
  ) as ReconstructedUtilityError
  error.name = input.name
  if (input.stack !== undefined) error.stack = input.stack
  if (input.httpStatus !== undefined) error.status = input.httpStatus
  if (input.providerCode !== undefined) error.providerCode = input.providerCode
  return error
}
