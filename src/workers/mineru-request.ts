import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, rm } from 'node:fs/promises'
import { z } from 'zod'
import type {
  MineruRemoteState,
  MineruUtilityRequest,
  MineruUtilityResponse
} from '../shared/contracts/mineru'
import { runKnowledgeNormalizer } from './knowledge-normalizer'
import {
  fetchConfiguredEndpoint,
  fetchPublicHttps,
  OutboundHttpPolicyError,
  readBoundedText,
  type ArtifactUrlValidator
} from './outbound-http'

const MAX_API_BODY_BYTES = 1024 * 1024

export class MineruRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly httpStatus?: number,
    readonly providerCode?: string,
    options?: ErrorOptions
  ) {
    super('MinerU request failed', options)
    this.name = 'MineruRequestError'
  }
}

const envelopeSchema = z.object({
  code: z.union([z.number(), z.string()]),
  msg: z.unknown().optional(),
  trace_id: z.string().max(256).optional(),
  data: z.unknown().optional()
})

const allocateDataSchema = z.object({
  batch_id: z.string().min(1).max(256),
  file_urls: z.array(z.url().max(16_384)).length(1)
})

const pollDataSchema = z.object({
  batch_id: z.string().min(1).max(256),
  extract_result: z
    .array(
      z.object({
        file_name: z.string().max(1_024).optional(),
        data_id: z.string().max(256).optional(),
        state: z.enum(['waiting-file', 'pending', 'running', 'converting', 'done', 'failed']),
        full_zip_url: z.url().max(16_384).optional(),
        err_msg: z.unknown().optional(),
        extract_progress: z
          .object({
            extracted_pages: z.number().int().nonnegative().optional(),
            total_pages: z.number().int().positive().optional(),
            start_time: z.unknown().optional()
          })
          .optional()
      })
    )
    .min(1)
    .max(50)
})

export async function runMineruRequest(
  request: MineruUtilityRequest,
  fetchImplementation: typeof fetch = fetch,
  security: { validateArtifactUrl?: ArtifactUrlValidator } = {}
): Promise<Exclude<MineruUtilityResponse, { type: 'error' }>> {
  switch (request.operation) {
    case 'allocate':
      return allocate(request, fetchImplementation)
    case 'upload':
      return upload(request, fetchImplementation, security.validateArtifactUrl)
    case 'poll':
      return poll(request, fetchImplementation)
    case 'download':
      return download(request, fetchImplementation, security.validateArtifactUrl)
    case 'normalize':
      return runKnowledgeNormalizer(request)
  }
}

async function allocate(
  request: Extract<MineruUtilityRequest, { operation: 'allocate' }>,
  fetchImplementation: typeof fetch
): Promise<Exclude<MineruUtilityResponse, { type: 'error' }>> {
  if (request.config.role !== 'mineru') throw new Error('MinerU provider role is required')
  const response = await fetchConfiguredEndpoint(
    new URL('/api/v4/file-urls/batch', request.config.baseUrl),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.credential}`,
        'X-Idempotency-Key': request.parseTaskId,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        files: [{ name: request.fileName, data_id: request.parseTaskId }],
        model_version: request.config.model
      })
    },
    fetchImplementation
  )
  const envelope = await readEnvelope(response)
  const data = allocateDataSchema.parse(envelope.data)
  return {
    type: 'allocated',
    requestId: request.requestId,
    remoteTaskId: data.batch_id,
    uploadUrl: data.file_urls[0] as string,
    traceId: envelope.trace_id ?? null
  }
}

async function upload(
  request: Extract<MineruUtilityRequest, { operation: 'upload' }>,
  fetchImplementation: typeof fetch,
  validateArtifactUrl?: ArtifactUrlValidator
): Promise<Exclude<MineruUtilityResponse, { type: 'error' }>> {
  const before = await lstat(request.sourcePath)
  if (!before.isFile() || before.isSymbolicLink() || before.size !== request.expectedBytes) {
    throw new MineruRequestError('source_changed', false)
  }
  let response: Response
  try {
    response = await fetchPublicHttps(
      request.uploadUrl,
      {
        method: 'PUT',
        body: createReadStream(request.sourcePath) as never,
        duplex: 'half'
      } as RequestInit,
      { fetchImplementation, validateUrl: validateArtifactUrl, maxRedirects: 0 }
    )
  } catch (err) {
    throw new MineruRequestError('upload_url_invalid', false, undefined, undefined, {
      cause: err
    })
  }
  if (!response.ok) {
    throw httpError(response.status)
  }
  const after = await lstat(request.sourcePath)
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new MineruRequestError('source_changed', false)
  }
  return { type: 'uploaded', requestId: request.requestId, byteSize: before.size }
}

async function poll(
  request: Extract<MineruUtilityRequest, { operation: 'poll' }>,
  fetchImplementation: typeof fetch
): Promise<Exclude<MineruUtilityResponse, { type: 'error' }>> {
  if (request.config.role !== 'mineru') throw new Error('MinerU provider role is required')
  const response = await fetchConfiguredEndpoint(
    new URL(
      `/api/v4/extract-results/batch/${encodeURIComponent(request.remoteTaskId)}`,
      request.config.baseUrl
    ),
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${request.credential}`, Accept: 'application/json' }
    },
    fetchImplementation
  )
  const envelope = await readEnvelope(response)
  const data = pollDataSchema.parse(envelope.data)
  if (data.batch_id !== request.remoteTaskId) {
    throw new MineruRequestError('remote_id_mismatch', false)
  }
  const result =
    data.extract_result.find((entry) => entry.data_id === request.parseTaskId) ??
    (data.extract_result.length === 1 ? data.extract_result[0] : undefined)
  if (result === undefined) throw new MineruRequestError('remote_result_missing', true)
  const downloadUrl = result.state === 'done' ? result.full_zip_url : undefined
  if (result.state === 'done' && downloadUrl === undefined) {
    throw new MineruRequestError('download_url_missing', true)
  }
  return {
    type: 'polled',
    requestId: request.requestId,
    remoteState: result.state as MineruRemoteState,
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
    traceId: envelope.trace_id ?? null,
    extractedPages: result.extract_progress?.extracted_pages ?? null,
    totalPages: result.extract_progress?.total_pages ?? null,
    remoteErrorCode: result.state === 'failed' ? 'remote_parse_failed' : null
  }
}

async function download(
  request: Extract<MineruUtilityRequest, { operation: 'download' }>,
  fetchImplementation: typeof fetch,
  validateArtifactUrl?: ArtifactUrlValidator
): Promise<Exclude<MineruUtilityResponse, { type: 'error' }>> {
  let response: Response
  try {
    response = await fetchPublicHttps(
      request.downloadUrl,
      { method: 'GET' },
      { fetchImplementation, validateUrl: validateArtifactUrl, maxRedirects: 3 }
    )
  } catch (err) {
    throw new MineruRequestError('download_redirect_invalid', false, undefined, undefined, {
      cause: err
    })
  }
  if (!response.ok || response.body === null) throw httpError(response.status)
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isSafeInteger(length) || length <= 0 || length > request.maxBytes) {
      throw new MineruRequestError('download_size_invalid', false, response.status)
    }
  }
  const handle = await open(request.destinationPath, 'wx', 0o600)
  const hash = createHash('sha256')
  let byteSize = 0
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk)
      byteSize += bytes.byteLength
      if (byteSize > request.maxBytes) {
        throw new MineruRequestError('download_too_large', false, response.status)
      }
      hash.update(bytes)
      await handle.write(bytes)
    }
    if (byteSize === 0) throw new MineruRequestError('download_empty', true, response.status)
    await handle.sync()
  } catch (err) {
    const cleanupErrors: unknown[] = []
    try {
      await handle.close()
    } catch (closeErr) {
      cleanupErrors.push(closeErr)
    }
    try {
      await rm(request.destinationPath, { force: true })
    } catch (removeErr) {
      cleanupErrors.push(removeErr)
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([err, ...cleanupErrors], 'MinerU download and cleanup failed', {
        cause: err
      })
    }
    throw err
  }
  await handle.close()
  return {
    type: 'downloaded',
    requestId: request.requestId,
    sha256: hash.digest('hex'),
    byteSize,
    contentType: response.headers.get('content-type')?.slice(0, 200) ?? null
  }
}

async function readEnvelope(response: Response): Promise<z.infer<typeof envelopeSchema>> {
  if (!response.ok) throw httpError(response.status)
  let text: string
  try {
    text = await readBoundedText(response, MAX_API_BODY_BYTES)
  } catch (err) {
    if (err instanceof OutboundHttpPolicyError && err.code === 'response_too_large') {
      throw new MineruRequestError('response_too_large', false, response.status, undefined, {
        cause: err
      })
    }
    throw err
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    throw new MineruRequestError('response_malformed', false, response.status, undefined, {
      cause: err
    })
  }
  const envelope = envelopeSchema.parse(value)
  if (String(envelope.code) !== '0') {
    const providerCode = String(envelope.code).slice(0, 100)
    throw new MineruRequestError(
      classifyProviderCode(providerCode),
      isRetryableProviderCode(providerCode),
      response.status,
      providerCode
    )
  }
  return envelope
}

function httpError(status: number): MineruRequestError {
  if (status === 401 || status === 403) {
    return new MineruRequestError('invalid_auth', false, status)
  }
  return new MineruRequestError(
    status === 429 ? 'rate_limited' : status >= 500 ? 'provider_unavailable' : 'http_rejected',
    status === 408 || status === 429 || status >= 500,
    status
  )
}

function classifyProviderCode(code: string): string {
  if (code === 'A0202' || code === 'A0211') return 'invalid_auth'
  if (['-10001', '-60001', '-60007', '-60008', '-60009', '-60010', '-60022'].includes(code)) {
    return 'provider_unavailable'
  }
  return 'provider_rejected'
}

function isRetryableProviderCode(code: string): boolean {
  return ['-10001', '-60001', '-60007', '-60008', '-60009', '-60010', '-60022'].includes(code)
}
