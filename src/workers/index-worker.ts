import {
  indexUtilityInitSchema,
  indexUtilityRequestSchema,
  indexUtilityResponseSchema,
  type IndexUtilityResponse,
  type IndexUtilityResponseBody
} from '../shared/contracts/indexing'
import { open } from 'node:fs/promises'
import { IndexDatabase } from './index-database'
import { createPortLogger } from './shared/port-logger'
import { extractUtilityRequestId as extractRequestId } from './shared/utility-message'

const parentPort = process.parentPort
if (parentPort === undefined) throw new Error('Index utility requires an Electron parent port')

let database: IndexDatabase | undefined
let initialized = false
let projectSessionId = ''
let queue = Promise.resolve()
let utilityLog: ReturnType<typeof createPortLogger> | undefined

parentPort.on('message', (event) => {
  if (!initialized) {
    initialized = true
    const port = event.ports[0]
    if (port === undefined) throw new Error('Index utility requires a logging port')
    const input = indexUtilityInitSchema.parse(event.data)
    projectSessionId = input.projectSessionId
    const log = createPortLogger(
      port,
      { processRole: 'index-worker', subsystem: 'index', component: 'database' },
      { projectId: input.projectId, projectSessionId: input.projectSessionId }
    )
    utilityLog = log
    try {
      database = new IndexDatabase(input.indexPath, input.extensionPath)
      log('info', 'index.utility.ready', 'Index utility initialized', {
        integrityMode: database.startupReport.integrityMode,
        integrityDurationMs: database.startupReport.integrityDurationMs,
        removedIndexGenerationCount: database.startupReport.cleanup.indexGenerations,
        removedEmbeddingGenerationCount: database.startupReport.cleanup.embeddingGenerations,
        removedOrphanFtsRowCount: database.startupReport.cleanup.orphanFtsRows,
        removedOrphanVectorTableCount: database.startupReport.cleanup.orphanVectorTables,
        removedEmbeddingCacheRowCount: database.startupReport.cleanup.embeddingCacheRows
      })
      parentPort.postMessage(
        indexUtilityResponseSchema.parse({
          type: 'ready',
          requestId: input.requestId,
          projectSessionId,
          snapshot: database.inspect()
        })
      )
    } catch (err) {
      log(
        'error',
        'index.utility.initialization_failed',
        'Index utility initialization failed',
        {},
        err
      )
      parentPort.postMessage(errorResponse(input.requestId, err, input.projectSessionId))
      setImmediate(() => process.exit(1))
    }
    return
  }

  queue = queue.then(async () => {
    let requestId = extractRequestId(event.data)
    try {
      const request = indexUtilityRequestSchema.parse(event.data)
      requestId = request.requestId
      if (database === undefined) throw new Error('Index utility is not initialized')
      let response: IndexUtilityResponseBody
      switch (request.operation) {
        case 'build': {
          const result = await database.build(request)
          await crashOnceForTest()
          response = { type: 'built', requestId, ...result }
          break
        }
        case 'activate':
          response = {
            type: 'activated',
            requestId,
            generationId: request.generationId,
            snapshot: database.activate(request.generationId)
          }
          break
        case 'inspect':
          response = { type: 'snapshot', requestId, snapshot: database.inspect() }
          break
        case 'retrieval-state':
          response = { type: 'retrieval-state', requestId, ...database.retrievalState() }
          break
        case 'fts-candidates':
          response = {
            type: 'fts-candidates',
            requestId,
            values: database.searchFts(request.query, request.limit, request.filters, request.mode)
          }
          break
        case 'hydrate-candidates':
          response = {
            type: 'hydrated-candidates',
            requestId,
            values: database.hydrateCandidates(request.chunkIds, request.filters)
          }
          break
        case 'expand-citations':
          response = {
            type: 'expanded-citations',
            requestId,
            values: database.expandCitations(request.citationIds)
          }
          break
        case 'embedding-inputs': {
          const result = database.embeddingInputs(
            request.indexGenerationId,
            request.offset,
            request.limit,
            request.contractSha256,
            request.dimension
          )
          response = { type: 'embedding-inputs', requestId, ...result }
          break
        }
        case 'inspect-knowledge-mapping':
          response = {
            type: 'knowledge-mapping',
            requestId,
            ...database.inspectKnowledgeMapping({
              knowledgeItemId: request.knowledgeItemId,
              parseRevisionId: request.parseRevisionId,
              pageIndex: request.pageIndex,
              fallbackBlockOrdinals: request.fallbackBlockOrdinals
            })
          }
          break
        case 'begin-vectors':
          response = {
            type: 'vectors-begun',
            requestId,
            alreadyActive: database.beginEmbedding(request.contract)
          }
          break
        case 'clear-embedding-cache':
          response = {
            type: 'embedding-cache-cleared',
            requestId,
            count: database.clearEmbeddingCache(
              request.indexGenerationId,
              request.contractSha256,
              request.knowledgeItemId
            )
          }
          break
        case 'upsert-vectors':
          database.upsertVectors(request.embeddingGenerationId, request.values)
          response = { type: 'vectors-upserted', requestId, count: request.values.length }
          break
        case 'activate-vectors':
          database.activateEmbedding(request.embeddingGenerationId, request.contractSha256)
          response = { type: 'vectors-activated', requestId }
          break
        case 'query-vectors':
          response = {
            type: 'vector-candidates',
            requestId,
            values: database.queryVectors(
              request.embeddingGenerationId,
              request.vector,
              request.limit,
              request.filters
            )
          }
          break
        case 'delete-vectors':
          database.deleteVectors(request.embeddingGenerationId)
          response = { type: 'vectors-deleted', requestId }
          break
        case 'close':
          database.close()
          response = { type: 'closed', requestId }
          break
      }
      parentPort.postMessage(indexUtilityResponseSchema.parse({ ...response, projectSessionId }))
      if (request.operation === 'close') setImmediate(() => process.exit(0))
    } catch (err) {
      utilityLog?.('error', 'index.utility.request_failed', 'Index utility request failed', {}, err)
      parentPort.postMessage(errorResponse(requestId, err, projectSessionId))
    }
  })
})

function errorResponse(
  requestId: string,
  input: unknown,
  projectSessionId: string
): IndexUtilityResponse {
  const error = input instanceof Error ? input : new Error('Index utility failed', { cause: input })
  return indexUtilityResponseSchema.parse({
    type: 'error',
    requestId,
    projectSessionId,
    error: {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack })
    }
  })
}

async function crashOnceForTest(): Promise<void> {
  const marker = process.env['WRITELLM_E2E_INDEX_CRASH_ONCE']
  if (marker === undefined) return
  try {
    const handle = await open(marker, 'wx', 0o600)
    await handle.close()
    process.exit(91)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
}
