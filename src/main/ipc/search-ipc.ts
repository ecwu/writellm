import { reportIpcFailure } from '../observability/ipc-context'
import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { knowledgeIpcEndpoints } from '../../shared/contracts/ipc-endpoints-knowledge'
import type { ProjectManager } from '../project/project-manager'
import { runCancellableProjectRequest } from '../project/project-operations'
import { resolveReadableCitation } from '../search/readable-citation-resolver'
import { createEndpointRegistrar } from './endpoint'

export function registerSearchIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  developmentUrl?: string
  ipc?: Pick<IpcMain, 'handle' | 'removeHandler'>
}): () => void {
  const ipc = options.ipc ?? ipcMain
  const handle = createEndpointRegistrar(ipc, {
    developmentUrl: options.developmentUrl,
    manager: options.manager
  })
  handle(knowledgeIpcEndpoints.search, async (input, context) => {
    if (!context.projectIndex.isRetrievalAvailable()) {
      throw new Error('Knowledge search is still preparing')
    }
    try {
      return await runCancellableProjectRequest(context, options.manager, (signal) =>
        context.retrieval.search(input, signal)
      )
    } catch (err) {
      reportIpcFailure(
        options.logger,
        {
          event: 'knowledge.search.failed',
          err,
          projectSessionId: input.projectSessionId
        },
        'Knowledge search failed'
      )
      throw new Error('Knowledge search could not be completed', { cause: err })
    }
  })
  handle(knowledgeIpcEndpoints.expandCitations, async (input, context) => {
    if (!context.projectIndex.isRetrievalAvailable()) {
      throw new Error('Knowledge citations are still preparing')
    }
    try {
      return await runCancellableProjectRequest(context, options.manager, (signal) =>
        context.retrieval.expand(input.citationIds, signal)
      )
    } catch (err) {
      reportIpcFailure(
        options.logger,
        {
          event: 'knowledge.citation_expansion.failed',
          err,
          projectSessionId: input.projectSessionId
        },
        'Knowledge citation expansion failed'
      )
      throw new Error('Knowledge citation could not be expanded', { cause: err })
    }
  })
  handle(knowledgeIpcEndpoints.resolveReadableCitation, async (input, context) => {
    const startedAt = Date.now()
    try {
      const result = await runCancellableProjectRequest(context, options.manager, (signal) =>
        resolveReadableCitation({
          database: context.database,
          retrieval: context.retrieval,
          retrievalAvailable: context.projectIndex.isRetrievalAvailable() === true,
          input,
          signal
        })
      )
      options.logger.info(
        {
          event: 'knowledge.readable_citation_resolution.completed',
          projectSessionId: input.projectSessionId,
          sectionRevisionId: input.sectionRevisionId,
          blockId: input.blockId,
          status: result.status,
          candidateCount:
            result.status === 'resolved'
              ? 1
              : result.status === 'ambiguous'
                ? result.citations.length
                : 0,
          durationMs: Date.now() - startedAt
        },
        'Resolved a readable manuscript citation'
      )
      return result
    } catch (err) {
      reportIpcFailure(
        options.logger,
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
    }
  })
  return () => {
    ipc.removeHandler(IPC_CHANNELS.knowledgeSearch)
    ipc.removeHandler(IPC_CHANNELS.knowledgeExpandCitations)
    ipc.removeHandler(IPC_CHANNELS.knowledgeResolveReadableCitation)
  }
}
