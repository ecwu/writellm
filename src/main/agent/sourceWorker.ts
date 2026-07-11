import { parentPort, workerData } from 'node:worker_threads';
import { WriteLLMDatabase } from '../database.js';
import { searchIndexedSources, SourceToolError } from './sourceService.js';
import type { SourceWorkerRequest, SourceWorkerResult } from './sourceWorkerProtocol.js';

const port = parentPort;
if (!port) {
  throw new Error('Pi source retrieval must run inside a worker thread.');
}

const request = workerData as SourceWorkerRequest;
const db = new WriteLLMDatabase(request.workspacePath, { startupMode: 'retrievalWorker' });

async function run(): Promise<void> {
  let result: SourceWorkerResult;
  try {
    const sources = await searchIndexedSources(db, {
      query: request.query,
      embedding: request.embedding,
      rerank: request.rerank,
      outboundDataPolicy: request.outboundDataPolicy,
      excludedItemIds: request.excludedItemIds,
      excludedChunkIds: request.excludedChunkIds,
      maxResults: request.maxResults
    });
    result = { type: 'result', sources };
  } catch (caught) {
    const failure = caught instanceof SourceToolError
      ? { category: caught.category, retryable: caught.retryable, cause: caught.message }
      : { category: 'local_search_failure' as const, retryable: true, cause: caught instanceof Error ? caught.message : String(caught) };
    result = { type: 'error', failure };
  } finally {
    db.close();
  }
  port!.postMessage(result);
}

void run();
