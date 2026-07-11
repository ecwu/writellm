import { parentPort, workerData } from 'node:worker_threads';
import { WriteLLMDatabase } from './database.js';
import {
  retrieveKnowledgeSources,
  retrieveKnowledgeSourcesV2
} from './knowledgeIndex.js';
import type {
  RetrievalWorkerInboundMessage,
  RetrievalWorkerOutboundMessage
} from './retrievalWorkerProtocol.js';

type RetrievalWorkerData = {
  workspacePath: string;
};

const port = parentPort;
if (!port) {
  throw new Error('Retrieval worker must run inside a worker thread.');
}

const { workspacePath } = workerData as RetrievalWorkerData;
const db = new WriteLLMDatabase(workspacePath, { startupMode: 'retrievalWorker' });
const taskControllers = new Map<string, AbortController>();

function post(message: RetrievalWorkerOutboundMessage): void {
  port!.postMessage(message);
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

async function runRetrieval(message: Extract<RetrievalWorkerInboundMessage, { type: 'retrieve' }>): Promise<void> {
  const controller = new AbortController();
  taskControllers.set(message.taskId, controller);
  const request = message.request;

  try {
    const sources = request.retrievalMode === 'sourcev2'
      ? await retrieveKnowledgeSourcesV2(
          db,
          request.embeddingSettings,
          request.chatSettings,
          request.query,
          {
            excludedItemIds: request.excludedItemIds,
            excludedChunkIds: request.excludedChunkIds,
            maxChunks: request.maxChunks,
            queries: request.queries,
            runId: request.runId,
            rerankSettings: request.rerankSettings,
            retrievalSettings: request.retrievalSettings,
            outboundDataPolicy: {
              externalProcessingEnabled: request.externalProcessingEnabled
            },
            abortSignal: controller.signal,
            onTrace: (event) => {
              post({ type: 'trace', taskId: message.taskId, event });
            }
          }
        )
      : await retrieveKnowledgeSources(
          db,
          request.embeddingSettings,
          request.query,
          {
            excludedItemIds: request.excludedItemIds,
            excludedChunkIds: request.excludedChunkIds,
            maxChunks: request.maxChunks,
            queries: request.queries,
            rerankSettings: request.rerankSettings,
            retrievalSettings: request.retrievalSettings,
            outboundDataPolicy: {
              externalProcessingEnabled: request.externalProcessingEnabled
            },
            abortSignal: controller.signal
          }
        );

    if (controller.signal.aborted) {
      post({ type: 'canceled', taskId: message.taskId });
      return;
    }
    post({ type: 'result', taskId: message.taskId, sources });
  } catch (caught) {
    if (controller.signal.aborted) {
      post({ type: 'canceled', taskId: message.taskId });
      return;
    }
    post({ type: 'error', taskId: message.taskId, message: errorMessage(caught) });
  } finally {
    taskControllers.delete(message.taskId);
  }
}

port.on('message', (message: RetrievalWorkerInboundMessage) => {
  if (message.type === 'retrieve') {
    void runRetrieval(message);
    return;
  }
  if (message.type === 'cancel') {
    taskControllers.get(message.taskId)?.abort(new Error('Retrieval canceled.'));
    return;
  }
  if (message.type === 'shutdown') {
    for (const controller of taskControllers.values()) {
      controller.abort(new Error('Retrieval worker shutting down.'));
    }
    db.close();
    process.exit(0);
  }
});
