import type { ModelEndpointSettings, RerankEndpointSettings } from '../../shared/types.js';
import type { OutboundDataPolicySnapshot } from '../llmSettings.js';
import type { SourceEvidence, SourceToolFailureCategory } from './sourceService.js';

export type SourceWorkerRequest = {
  workspacePath: string;
  query: string;
  embedding: ModelEndpointSettings;
  rerank?: RerankEndpointSettings;
  outboundDataPolicy: OutboundDataPolicySnapshot;
  excludedItemIds?: string[];
  excludedChunkIds?: string[];
  maxResults?: number;
};

export type SourceWorkerResult =
  | { type: 'result'; sources: SourceEvidence[] }
  | {
      type: 'error';
      failure: {
        category: SourceToolFailureCategory;
        retryable: boolean;
        cause: string;
      };
    };
