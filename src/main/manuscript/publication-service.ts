import { createHash } from 'node:crypto'
import type { Logger } from 'pino'
import {
  buildPublicationAssembly,
  publicationPreview,
  type PublicationAssembly,
  type PublicationAsset,
  type PublicationOptions,
  type PublicationPreview
} from '../../shared/contracts/publication'
import { normalizeCitationTitle } from '../../shared/readable-citation'
import type { ProjectContext } from '../project/project-context'

const PAGE_SIZE = 100
const MAX_ASSETS = 10_000

export class PublicationService {
  constructor(private readonly log: Pick<Logger, 'info' | 'error'>) {}

  async assemble(
    context: ProjectContext,
    options?: Partial<PublicationOptions>
  ): Promise<PublicationAssembly> {
    const startedAt = Date.now()
    try {
      const manuscript = context.manuscript.assemble()
      const references = context.manuscript.getReferenceIndex()
      const assets: PublicationAsset[] = []
      let cursor: string | undefined
      do {
        const page = await context.manuscriptAssets.listWorkspace({
          projectSessionId: context.projectSessionId,
          usage: 'used',
          source: 'all',
          ...(cursor === undefined ? {} : { cursor }),
          limit: PAGE_SIZE
        })
        assets.push(
          ...page.items.map((item) => ({
            assetId: item.assetId,
            logicalUrl: item.logicalUrl,
            mimeType: item.mimeType,
            byteSize: item.byteSize,
            width: item.width,
            height: item.height,
            availability: item.availability
          }))
        )
        if (assets.length > MAX_ASSETS) throw new Error('Publication references too many assets')
        cursor = page.nextCursor ?? undefined
      } while (cursor !== undefined)
      const availableReferenceTitles = context.database.immediate(
        (database) =>
          new Set(
            (
              database
                .prepare("SELECT display_name FROM knowledge_items WHERE state = 'stored'")
                .pluck()
                .all() as string[]
            ).map(normalizeCitationTitle)
          )
      )
      const assembly = buildPublicationAssembly({
        manuscript,
        references,
        assets,
        availableReferenceTitles,
        options,
        hash: (value) => createHash('sha256').update(value).digest('hex')
      })
      this.log.info(
        {
          event: 'manuscript.publication_assembly.completed',
          projectId: context.manifest.projectId,
          manuscriptId: assembly.manuscriptId,
          sourceHash: assembly.sourceHash,
          nodeCount: assembly.nodes.length,
          assetCount: assembly.assets.length,
          findingCount: assembly.findings.length,
          ready: assembly.ready,
          durationMs: Date.now() - startedAt
        },
        'Publication assembly completed'
      )
      return assembly
    } catch (err) {
      this.log.error(
        {
          event: 'manuscript.publication_assembly.failed',
          err,
          projectId: context.manifest.projectId,
          durationMs: Date.now() - startedAt
        },
        'Publication assembly failed'
      )
      throw new Error('Publication assembly failed', { cause: err })
    }
  }

  async preview(
    context: ProjectContext,
    options?: Partial<PublicationOptions>
  ): Promise<PublicationPreview> {
    return publicationPreview(await this.assemble(context, options))
  }
}
