import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { Logger } from 'pino'
import { APP_URL } from '../../shared/security/urls'

const MAX_RANGE_BYTES = 8 * 1024 * 1024
const MAX_PDF_BYTES = 250 * 1024 * 1024

type Capability = {
  previewId: string
  projectSessionId: string
  knowledgeItemId: string
  absolutePath: string
  byteSize: number
  sourceSha256: string
}

export class PdfPreviewCapabilities {
  readonly #capabilities = new Map<string, Capability>()

  constructor(
    private readonly options: {
      isSessionActive: (projectSessionId: string) => boolean
      developmentUrl?: string
      log: Pick<Logger, 'info' | 'warn' | 'error'>
    }
  ) {}

  issue(input: Omit<Capability, 'previewId'>): {
    previewId: string
    url: string
    byteSize: number
  } {
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > MAX_PDF_BYTES
    ) {
      throw new Error('PDF preview size is invalid')
    }
    const previewId = randomUUID()
    this.#capabilities.set(previewId, { previewId, ...input })
    const sessionCapabilities = [...this.#capabilities.values()].filter(
      (value) => value.projectSessionId === input.projectSessionId
    )
    for (const stale of sessionCapabilities.slice(0, Math.max(0, sessionCapabilities.length - 8))) {
      this.#capabilities.delete(stale.previewId)
    }
    this.options.log.info(
      {
        event: 'knowledge.pdf_preview.issued',
        projectSessionId: input.projectSessionId,
        knowledgeItemId: input.knowledgeItemId,
        byteSize: input.byteSize
      },
      'PDF preview capability issued'
    )
    return { previewId, url: `${APP_URL}project-pdf/${previewId}`, byteSize: input.byteSize }
  }

  revoke(previewId: string, projectSessionId: string): void {
    const value = this.#capabilities.get(previewId)
    if (value?.projectSessionId !== projectSessionId) return
    this.#capabilities.delete(previewId)
    this.options.log.info(
      {
        event: 'knowledge.pdf_preview.revoked',
        projectSessionId,
        knowledgeItemId: value.knowledgeItemId
      },
      'PDF preview capability revoked'
    )
  }

  revokeSession(projectSessionId: string): void {
    for (const [previewId, value] of this.#capabilities) {
      if (value.projectSessionId !== projectSessionId) continue
      this.#capabilities.delete(previewId)
      this.options.log.info(
        {
          event: 'knowledge.pdf_preview.revoked',
          projectSessionId,
          knowledgeItemId: value.knowledgeItemId
        },
        'PDF preview capability revoked'
      )
    }
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url)
    if (url.hostname !== 'bundle' || !url.pathname.startsWith('/project-pdf/')) return null
    const previewId = url.pathname.slice('/project-pdf/'.length)
    const capability = this.#capabilities.get(previewId)
    if (capability === undefined || !this.options.isSessionActive(capability.projectSessionId)) {
      return new Response('Not found', { status: 404 })
    }
    try {
      const file = await stat(capability.absolutePath)
      if (!file.isFile() || file.size !== capability.byteSize)
        return new Response('Not found', { status: 404 })
      const handle = await open(capability.absolutePath, 'r')
      try {
        const header = Buffer.alloc(5)
        await handle.read(header, 0, header.length, 0)
        if (header.toString() !== '%PDF-') return new Response('Not found', { status: 404 })
      } finally {
        await handle.close()
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
      }
      const baseHeaders: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/pdf'
      }
      const origin = request.headers.get('origin')
      if (
        origin !== null &&
        this.options.developmentUrl !== undefined &&
        URL.canParse(origin) &&
        URL.canParse(this.options.developmentUrl) &&
        new URL(origin).origin === new URL(this.options.developmentUrl).origin
      ) {
        baseHeaders['Access-Control-Allow-Origin'] = origin
        baseHeaders.Vary = 'Origin'
      }
      const range = parseRange(request.headers.get('range'), file.size)
      if (range === 'invalid') {
        this.options.log.warn(
          {
            event: 'knowledge.pdf_preview.range_failed',
            projectSessionId: capability.projectSessionId,
            knowledgeItemId: capability.knowledgeItemId
          },
          'Invalid PDF preview range'
        )
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${file.size}` }
        })
      }
      if (range === null) {
        return new Response(
          request.method === 'HEAD'
            ? null
            : (Readable.toWeb(createReadStream(capability.absolutePath)) as BodyInit),
          {
            status: 200,
            headers: { ...baseHeaders, 'Content-Length': String(file.size) }
          }
        )
      }
      const length = range.end - range.start + 1
      return new Response(
        request.method === 'HEAD'
          ? null
          : (Readable.toWeb(
              createReadStream(capability.absolutePath, { start: range.start, end: range.end })
            ) as BodyInit),
        {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(length),
            'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`
          }
        }
      )
    } catch (err) {
      this.options.log.error(
        {
          event: 'knowledge.pdf_preview.range_failed',
          err,
          projectSessionId: capability.projectSessionId,
          knowledgeItemId: capability.knowledgeItemId
        },
        'PDF preview range read failed'
      )
      return new Response('PDF preview unavailable', { status: 404 })
    }
  }
}

function parseRange(
  value: string | null,
  byteSize: number
): { start: number; end: number } | null | 'invalid' {
  if (value === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (match === null) return 'invalid'
  if (match[1] === '' && match[2] === '') return 'invalid'
  const suffixLength = match[1] === '' ? Number(match[2]) : null
  const start =
    suffixLength === null
      ? Number(match[1])
      : Math.max(0, byteSize - Math.min(byteSize, suffixLength))
  const requestedEnd =
    suffixLength === null
      ? match[2] === ''
        ? byteSize - 1
        : Number(match[2])
      : suffixLength === 0
        ? byteSize - 1
        : start + suffixLength - 1
  const end = Math.min(requestedEnd, byteSize - 1)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return 'invalid'
  if (end - start + 1 > MAX_RANGE_BYTES) return 'invalid'
  return { start, end }
}
