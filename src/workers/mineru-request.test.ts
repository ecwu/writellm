import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MineruUtilityRequest } from '../shared/contracts/mineru'
import { type MineruRequestError, runMineruRequest } from './mineru-request'

const directories: string[] = []
const allowArtifactUrl = async (): Promise<void> => undefined
const baseConfig = {
  role: 'mineru' as const,
  providerId: 'mineru' as const,
  baseUrl: 'https://mineru.example.test',
  model: 'vlm',
  timeoutMs: 5_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: 200
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('runMineruRequest', () => {
  it('allocates one authenticated v4 upload and returns the batch persistence barrier', async () => {
    const request: MineruUtilityRequest = {
      operation: 'allocate',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc501',
      config: baseConfig,
      credential: 'mineru-secret',
      parseTaskId: 'parse-task-1',
      fileName: 'source.pdf'
    }
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://mineru.example.test/api/v4/file-urls/batch')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer mineru-secret')
      expect(JSON.parse(String(init?.body))).toEqual({
        files: [{ name: 'source.pdf', data_id: 'parse-task-1' }],
        model_version: 'vlm'
      })
      return json({
        code: 0,
        msg: 'ok',
        trace_id: 'trace-1',
        data: {
          batch_id: 'remote-batch-1',
          file_urls: ['https://upload.example.test/object?signature=PRIVATE']
        }
      })
    })

    const result = await runMineruRequest(request, fetchMock)
    expect(result).toEqual({
      type: 'allocated',
      requestId: request.requestId,
      remoteTaskId: 'remote-batch-1',
      uploadUrl: 'https://upload.example.test/object?signature=PRIVATE',
      traceId: 'trace-1'
    })
  })

  it('uploads the immutable project original and downloads a bounded hashed archive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-mineru-http-'))
    directories.push(directory)
    const sourcePath = join(directory, 'source.pdf')
    const destinationPath = join(directory, 'result.zip')
    await writeFile(sourcePath, 'original-bytes')
    const uploadFetch = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.body === undefined || init.body === null) throw new Error('Upload body is missing')
      const chunks: Buffer[] = []
      for await (const chunk of init.body as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk))
      expect(Buffer.concat(chunks).toString()).toBe('original-bytes')
      expect(new Headers(init?.headers).has('content-type')).toBe(false)
      return new Response(null, { status: 200 })
    })
    const uploaded = await runMineruRequest(
      {
        operation: 'upload',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc502',
        uploadUrl: 'https://upload.example.test/object?signature=PRIVATE',
        sourcePath,
        expectedBytes: 14
      },
      uploadFetch,
      { validateArtifactUrl: allowArtifactUrl }
    )
    expect(uploaded).toMatchObject({ type: 'uploaded', byteSize: 14 })

    const downloaded = await runMineruRequest(
      {
        operation: 'download',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc503',
        downloadUrl: 'https://download.example.test/result.zip?signature=PRIVATE',
        destinationPath,
        maxBytes: 100
      },
      async () =>
        new Response('zip-bytes', {
          status: 200,
          headers: { 'content-length': '9', 'content-type': 'application/zip' }
        }),
      { validateArtifactUrl: allowArtifactUrl }
    )
    expect(downloaded).toMatchObject({
      type: 'downloaded',
      byteSize: 9,
      contentType: 'application/zip'
    })
    expect(await readFile(destinationPath, 'utf8')).toBe('zip-bytes')
    expect(JSON.stringify(downloaded)).not.toContain('signature')
  })

  it('polls the same batch/data ID and returns only bounded state and a signed download capability', async () => {
    const result = await runMineruRequest(
      {
        operation: 'poll',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc504',
        config: baseConfig,
        credential: 'mineru-secret',
        parseTaskId: 'parse-task-1',
        remoteTaskId: 'remote-batch-1'
      },
      async () =>
        json({
          code: 0,
          msg: 'ok',
          trace_id: 'trace-2',
          data: {
            batch_id: 'remote-batch-1',
            extract_result: [
              {
                file_name: 'source.pdf',
                data_id: 'parse-task-1',
                state: 'done',
                full_zip_url: 'https://download.example.test/result.zip?signature=PRIVATE',
                err_msg: ''
              }
            ]
          }
        })
    )
    expect(result).toMatchObject({
      type: 'polled',
      remoteState: 'done',
      downloadUrl: 'https://download.example.test/result.zip?signature=PRIVATE',
      traceId: 'trace-2'
    })
  })

  it('rejects an unsafe redirect hop before following it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-mineru-redirect-'))
    directories.push(directory)
    const destination = join(directory, 'result.zip')
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://remote.example.test/result.zip' }
        })
    )
    await expect(
      runMineruRequest(
        {
          operation: 'download',
          requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc506',
          downloadUrl: 'https://download.example.test/result.zip?signature=PRIVATE',
          destinationPath: destination,
          maxBytes: 100
        },
        fetchMock,
        {
          validateArtifactUrl: async (url) => {
            if (url.protocol !== 'https:') throw new Error('unsafe')
          }
        }
      )
    ).rejects.toMatchObject({ code: 'download_redirect_invalid', retryable: false })
  })

  it('classifies official auth/service codes without retaining provider response messages', async () => {
    const request: MineruUtilityRequest = {
      operation: 'allocate',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc505',
      config: baseConfig,
      credential: 'bad-secret',
      parseTaskId: 'parse-task-1',
      fileName: 'source.pdf'
    }
    const authError = await runMineruRequest(request, async () =>
      json({ code: 'A0202', msg: 'PRIVATE PROVIDER BODY' })
    ).catch((error: unknown) => error)
    expect(authError).toMatchObject({
      name: 'MineruRequestError',
      code: 'invalid_auth',
      retryable: false,
      providerCode: 'A0202'
    })
    expect((authError as MineruRequestError).message).not.toContain('PRIVATE')

    await expect(
      runMineruRequest(request, async () => json({ code: -60007, msg: 'PRIVATE BODY' }))
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true })

    await expect(
      runMineruRequest(
        request,
        async () =>
          new Response('x'.repeat(1024 * 1024 + 1), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      )
    ).rejects.toMatchObject({ code: 'response_too_large', retryable: false })
  })
})

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
