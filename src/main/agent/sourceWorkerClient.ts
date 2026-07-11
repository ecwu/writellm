import { Worker } from 'node:worker_threads';
import type { SourceEvidence, SourceSearchOptions } from './sourceService.js';
import { SourceToolError } from './sourceService.js';
import type { SourceWorkerRequest, SourceWorkerResult } from './sourceWorkerProtocol.js';

const SOURCE_WORKER_TIMEOUT_MS = 45_000;

export function searchIndexedSourcesInWorker(
  workspacePath: string,
  options: SourceSearchOptions
): Promise<SourceEvidence[]> {
  if (options.abortSignal?.aborted) {
    return Promise.reject(new SourceToolError('canceled', false, 'Source retrieval was canceled.'));
  }

  const request: SourceWorkerRequest = {
    workspacePath,
    query: options.query,
    embedding: options.embedding,
    rerank: options.rerank,
    outboundDataPolicy: options.outboundDataPolicy,
    excludedItemIds: options.excludedItemIds,
    excludedChunkIds: options.excludedChunkIds,
    maxResults: options.maxResults
  };

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sourceWorker.js', import.meta.url), {
      workerData: request,
      execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type'))
    });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.abortSignal?.removeEventListener('abort', abort);
      action();
      void worker.terminate();
    };
    const abort = () => finish(() => reject(new SourceToolError('canceled', false, 'Source retrieval was canceled.')));
    const timeout = setTimeout(() => {
      finish(() => reject(new SourceToolError('retrieval_timeout', true, 'Source retrieval exceeded its 45-second time budget.')));
    }, SOURCE_WORKER_TIMEOUT_MS);

    options.abortSignal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: SourceWorkerResult) => {
      if (message.type === 'result') {
        finish(() => resolve(message.sources));
      } else {
        finish(() => reject(new SourceToolError(message.failure.category, message.failure.retryable, message.failure.cause)));
      }
    });
    worker.once('error', (error) => {
      finish(() => reject(new SourceToolError('local_search_failure', true, `Source worker failed: ${error.message}`)));
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        finish(() => reject(new SourceToolError('local_search_failure', true, `Source worker exited with code ${code}.`)));
      }
    });
  });
}
