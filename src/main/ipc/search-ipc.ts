import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  citationExpansionInputSchema,
  citationExpansionResultSchema,
  knowledgeSearchInputSchema,
  knowledgeSearchResultSchema,
  readableCitationResolutionInputSchema,
  readableCitationResolutionResultSchema
} from '../../shared/contracts/search'
import type { ProjectManager } from '../project/project-manager'
import { resolveReadableCitation } from '../search/readable-citation-resolver'
import { authorizeSender } from './authorize-sender'

export function registerSearchIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: Pick<IpcMain, 'handle' | 'removeHandler'>
}): () => void {
  const ipc = options.ipc ?? ipcMain
  ipc.handle(IPC_CHANNELS.knowledgeSearch, async (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = knowledgeSearchInputSchema.parse(rawInput)
    const context = options.manager.assertActiveSession(input.projectSessionId)
    if (context.retrieval === null) throw new Error('Knowledge search is unavailable')
    if (!context.projectIndex?.isRetrievalAvailable()) {
      throw new Error('Knowledge search is still preparing')
    }
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    try {
      const result = await context.retrieval.search(input, controller.signal)
      options.manager.assertActiveSession(input.projectSessionId)
      return knowledgeSearchResultSchema.parse(result)
    } catch (err) {
      options.logger.error(
        {
          event: 'knowledge.search.failed',
          err,
          projectSessionId: input.projectSessionId
        },
        'Knowledge search failed'
      )
      throw new Error('Knowledge search could not be completed', { cause: err })
    } finally {
      release?.()
    }
  })
  ipc.handle(IPC_CHANNELS.knowledgeExpandCitations, async (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = citationExpansionInputSchema.parse(rawInput)
    const context = options.manager.assertActiveSession(input.projectSessionId)
    if (context.retrieval === null) throw new Error('Citation expansion is unavailable')
    if (!context.projectIndex?.isRetrievalAvailable()) {
      throw new Error('Knowledge citations are still preparing')
    }
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    try {
      const result = await context.retrieval.expand(input.citationIds, controller.signal)
      options.manager.assertActiveSession(input.projectSessionId)
      return citationExpansionResultSchema.parse(result)
    } catch (err) {
      options.logger.error(
        {
          event: 'knowledge.citation_expansion.failed',
          err,
          projectSessionId: input.projectSessionId
        },
        'Knowledge citation expansion failed'
      )
      throw new Error('Knowledge citation could not be expanded', { cause: err })
    } finally {
      release?.()
    }
  })
  ipc.handle(IPC_CHANNELS.knowledgeResolveReadableCitation, async (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = readableCitationResolutionInputSchema.parse(rawInput)
    const context = options.manager.assertActiveSession(input.projectSessionId)
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    const startedAt = Date.now()
    try {
      const result = await resolveReadableCitation({
        database: context.database,
        retrieval: context.retrieval,
        retrievalAvailable: context.projectIndex?.isRetrievalAvailable() === true,
        input,
        signal: controller.signal
      })
      options.manager.assertActiveSession(input.projectSessionId)
      const parsed = readableCitationResolutionResultSchema.parse(result)
      options.logger.info(
        {
          event: 'knowledge.readable_citation_resolution.completed',
          projectSessionId: input.projectSessionId,
          sectionRevisionId: input.sectionRevisionId,
          blockId: input.blockId,
          status: parsed.status,
          candidateCount:
            parsed.status === 'resolved'
              ? 1
              : parsed.status === 'ambiguous'
                ? parsed.citations.length
                : 0,
          durationMs: Date.now() - startedAt
        },
        'Resolved a readable manuscript citation'
      )
      return parsed
    } catch (err) {
      options.logger.error(
        {
          event: 'knowledge.readable_citation_resolution.failed',
          err,
          projectSessionId: input.projectSessionId,
          sectionRevisionId: input.sectionRevisionId,
          blockId: input.blockId,
          durationMs: Date.now() - startedAt
        },
        'Readable manuscript citation resolution failed'
      )
      throw new Error('Readable citation could not be resolved', { cause: err })
    } finally {
      release?.()
    }
  })
  return () => {
    ipc.removeHandler(IPC_CHANNELS.knowledgeSearch)
    ipc.removeHandler(IPC_CHANNELS.knowledgeExpandCitations)
    ipc.removeHandler(IPC_CHANNELS.knowledgeResolveReadableCitation)
  }
}
