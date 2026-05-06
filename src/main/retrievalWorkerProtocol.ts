import type {
  KnowledgeRetrievalMode,
  KnowledgeRetrievalSettings,
  KnowledgeRetrievalTraceEvent,
  ModelEndpointSettings,
  RerankEndpointSettings,
  RetrievedKnowledgeSource
} from '../shared/types.js';

export type RetrievalWorkerRequest = {
  query: string;
  embeddingSettings: ModelEndpointSettings;
  chatSettings: ModelEndpointSettings;
  retrievalMode?: KnowledgeRetrievalMode;
  excludedItemIds?: string[];
  excludedChunkIds?: string[];
  maxChunks?: number;
  queries?: string[];
  runId?: string;
  rerankSettings?: RerankEndpointSettings;
  retrievalSettings?: KnowledgeRetrievalSettings;
};

export type RetrievalWorkerInboundMessage =
  | {
      type: 'retrieve';
      taskId: string;
      request: RetrievalWorkerRequest;
    }
  | {
      type: 'cancel';
      taskId: string;
    }
  | {
      type: 'shutdown';
    };

export type RetrievalWorkerOutboundMessage =
  | {
      type: 'trace';
      taskId: string;
      event: KnowledgeRetrievalTraceEvent;
    }
  | {
      type: 'result';
      taskId: string;
      sources: RetrievedKnowledgeSource[];
    }
  | {
      type: 'error';
      taskId: string;
      message: string;
    }
  | {
      type: 'canceled';
      taskId: string;
    };
