import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  citationFormatterRequestSchema,
  citationFormatterResponseSchema,
  type CitationFormatterRequest,
  type CitationFormatterResult
} from '../../shared/contracts/citation-formatting'
import type {
  PersistentUtilityProcess,
  UtilityMessageDecision
} from '../workers/persistent-utility-process'

export class CitationFormatterClient {
  constructor(
    private readonly worker: PersistentUtilityProcess,
    private readonly log: Pick<Logger, 'error'>
  ) {}

  format(
    input: Omit<CitationFormatterRequest, 'operation' | 'requestId'>,
    signal: AbortSignal
  ): Promise<CitationFormatterResult> {
    const request = citationFormatterRequestSchema.parse({
      ...input,
      operation: 'format_citations',
      requestId: randomUUID()
    })
    return this.worker.request({
      requestId: request.requestId,
      payload: request,
      signal,
      rejectOnAbort: abortError(),
      cancelPayload: {
        type: 'cancel',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId
      },
      onMessage: (raw): UtilityMessageDecision<CitationFormatterResult> => {
        const parsed = citationFormatterResponseSchema.safeParse(raw)
        if (
          !parsed.success ||
          parsed.data.requestId !== request.requestId ||
          parsed.data.projectSessionId !== request.projectSessionId ||
          parsed.data.snapshotHash !== request.snapshotHash
        ) {
          const err = parsed.success
            ? new Error('Citation formatter response capability mismatch')
            : parsed.error
          this.log.error(
            { event: 'reference.formatter_response.invalid', err, requestId: request.requestId },
            'Citation formatter response was invalid'
          )
          return {
            kind: 'reject',
            error: new Error('Citation formatter response was invalid', { cause: err }),
            terminate: true
          }
        }
        if (parsed.data.type === 'citation-format-error') {
          const err = new Error(parsed.data.error.message)
          err.name = parsed.data.error.name
          return { kind: 'reject', error: err }
        }
        return { kind: 'resolve', value: parsed.data }
      }
    })
  }
}

function abortError(): Error {
  const error = new Error('Citation formatting was superseded')
  error.name = 'AbortError'
  return error
}
