import { randomUUID } from 'node:crypto'
import { utilityProcess } from 'electron'
import type { Logger } from 'pino'
import {
  mineruUtilityRequestSchema,
  mineruUtilityResponseSchema,
  type MineruUtilityRequest
} from '../../shared/contracts/mineru'
import type { MineruProviderConfig } from '../../shared/contracts/providers'
import type { UtilityProcessFactory } from '../providers/provider-probe-client'
import {
  PersistentUtilityProcess,
  type UtilityMessageDecision
} from '../workers/persistent-utility-process'
import type {
  MineruAllocatedResult,
  MineruDownloadedResult,
  MineruGateway,
  MineruNormalizedResult,
  MineruPolledResult,
  MineruSuccessResponse
} from './mineru-gateway'

export class MineruGatewayError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly httpStatus?: number,
    readonly providerCode?: string,
    options?: ErrorOptions
  ) {
    super('MinerU utility request failed', options)
    this.name = 'MineruGatewayError'
  }
}

export class MineruClient implements MineruGateway {
  readonly #worker: PersistentUtilityProcess

  constructor(
    modulePath: string,
    private readonly log: Logger,
    processFactory: UtilityProcessFactory = utilityProcess,
    sharedWorker?: PersistentUtilityProcess
  ) {
    this.#worker =
      sharedWorker ??
      new PersistentUtilityProcess({
        modulePath,
        serviceName: 'writellm-background-worker',
        log,
        factory: processFactory
      })
  }

  terminateAll(): void {
    this.#worker.terminate()
  }

  async allocate(
    config: MineruProviderConfig,
    credential: string,
    input: { parseTaskId: string; fileName: string },
    signal: AbortSignal
  ): Promise<MineruAllocatedResult> {
    const response = await this.#run(
      { operation: 'allocate', requestId: randomUUID(), config, credential, ...input },
      signal
    )
    if (response.type !== 'allocated') throw new Error('MinerU allocate response type mismatch')
    return {
      remoteTaskId: response.remoteTaskId,
      uploadUrl: response.uploadUrl,
      traceId: response.traceId
    }
  }

  async upload(
    input: { uploadUrl: string; sourcePath: string; expectedBytes: number },
    signal: AbortSignal
  ): Promise<void> {
    const response = await this.#run(
      { operation: 'upload', requestId: randomUUID(), ...input },
      signal
    )
    if (response.type !== 'uploaded' || response.byteSize !== input.expectedBytes) {
      throw new Error('MinerU upload response did not match the source')
    }
  }

  async poll(
    config: MineruProviderConfig,
    credential: string,
    input: { parseTaskId: string; remoteTaskId: string },
    signal: AbortSignal
  ): Promise<MineruPolledResult> {
    const response = await this.#run(
      { operation: 'poll', requestId: randomUUID(), config, credential, ...input },
      signal
    )
    if (response.type !== 'polled') throw new Error('MinerU poll response type mismatch')
    const { type: _, requestId: __, ...result } = response
    return result
  }

  async download(
    input: { downloadUrl: string; destinationPath: string; maxBytes: number },
    signal: AbortSignal
  ): Promise<MineruDownloadedResult> {
    const response = await this.#run(
      { operation: 'download', requestId: randomUUID(), ...input },
      signal
    )
    if (response.type !== 'downloaded') throw new Error('MinerU download response type mismatch')
    const { type: _, requestId: __, ...result } = response
    return result
  }

  async normalize(
    input: Omit<
      Extract<MineruUtilityRequest, { operation: 'normalize' }>,
      'operation' | 'requestId'
    >,
    signal: AbortSignal
  ): Promise<MineruNormalizedResult> {
    const response = await this.#run(
      { operation: 'normalize', requestId: randomUUID(), ...input },
      signal
    )
    if (response.type !== 'normalized') throw new Error('MinerU normalize response type mismatch')
    const { type: _, requestId: __, ...result } = response
    return result
  }

  #run(request: MineruUtilityRequest, signal: AbortSignal): Promise<MineruSuccessResponse> {
    if (signal.aborted) return Promise.reject(abortError())
    const parsedRequest = mineruUtilityRequestSchema.parse(request)
    return this.#worker.request({
      requestId: parsedRequest.requestId,
      payload: parsedRequest,
      signal,
      rejectOnAbort: abortError(),
      onMessage: (raw) => this.#handleResponse(raw, parsedRequest.requestId)
    })
  }

  #handleResponse(raw: unknown, requestId: string): UtilityMessageDecision<MineruSuccessResponse> {
    const parsed = mineruUtilityResponseSchema.safeParse(raw)
    if (!parsed.success || parsed.data.requestId !== requestId) {
      const err = parsed.success ? new Error('MinerU response request ID mismatch') : parsed.error
      this.log.error(
        { event: 'mineru.utility.response_invalid', err, requestId },
        'MinerU utility returned an invalid response'
      )
      return {
        kind: 'reject',
        error: new Error('MinerU utility returned an invalid response'),
        terminate: true
      }
    }
    const response = parsed.data
    if (response.type === 'error') {
      const err = reconstructError(response.error)
      this.log.error(
        { event: 'mineru.utility.failed', err, requestId },
        'MinerU utility request failed'
      )
      return { kind: 'reject', error: err }
    }
    return { kind: 'resolve', value: response }
  }
}

function reconstructError(input: {
  name: string
  message: string
  stack?: string
  httpStatus?: number
  providerCode?: string
  retryable: boolean
}): MineruGatewayError {
  const cause = new Error(input.message)
  cause.name = input.name
  if (input.stack !== undefined) cause.stack = input.stack
  return new MineruGatewayError(input.retryable, input.httpStatus, input.providerCode, { cause })
}

function abortError(): Error {
  const error = new Error('MinerU utility request aborted')
  error.name = 'AbortError'
  return error
}
