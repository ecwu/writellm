import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { APP_URL } from '../../shared/security/urls'
import type { ManuscriptAssetService } from './asset-service'

type Capability = {
  previewId: string
  projectSessionId: string
  assetId: string
  assets: ManuscriptAssetService
}

export class ManuscriptAssetCapabilities {
  readonly #capabilities = new Map<string, Capability>()

  constructor(
    private readonly options: {
      isSessionActive(projectSessionId: string): boolean
      log: Pick<Logger, 'info' | 'warn' | 'error'>
    }
  ) {}

  issue(input: Omit<Capability, 'previewId'>): { url: string } {
    const existing = [...this.#capabilities.values()].find(
      (value) =>
        value.projectSessionId === input.projectSessionId && value.assetId === input.assetId
    )
    if (existing !== undefined) return { url: `${APP_URL}project-asset/${existing.previewId}` }
    const previewId = randomUUID()
    this.#capabilities.set(previewId, { previewId, ...input })
    const session = [...this.#capabilities.values()].filter(
      (value) => value.projectSessionId === input.projectSessionId
    )
    for (const stale of session.slice(0, Math.max(0, session.length - 10_000))) {
      this.#capabilities.delete(stale.previewId)
    }
    this.options.log.info(
      {
        event: 'manuscript.asset_preview.issued',
        projectSessionId: input.projectSessionId,
        assetId: input.assetId
      },
      'Manuscript asset preview capability issued'
    )
    return { url: `${APP_URL}project-asset/${previewId}` }
  }

  revokeSession(projectSessionId: string): void {
    for (const [previewId, value] of this.#capabilities) {
      if (value.projectSessionId === projectSessionId) this.#capabilities.delete(previewId)
    }
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url)
    if (url.hostname !== 'bundle' || !url.pathname.startsWith('/project-asset/')) return null
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    const capability = this.#capabilities.get(url.pathname.slice('/project-asset/'.length))
    if (capability === undefined || !this.options.isSessionActive(capability.projectSessionId)) {
      return new Response('Not found', { status: 404 })
    }
    try {
      const { row, bytes } = await capability.assets.readVerified(capability.assetId)
      const body = request.method === 'HEAD' ? null : Uint8Array.from(bytes).buffer
      return new Response(body, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Length': String(row.byte_size),
          'Content-Type': row.mime_type,
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch (err) {
      this.options.log.error(
        {
          event: 'manuscript.asset_preview.failed',
          err,
          projectSessionId: capability.projectSessionId,
          assetId: capability.assetId
        },
        'Manuscript asset preview failed'
      )
      return new Response('Not found', { status: 404 })
    }
  }
}
