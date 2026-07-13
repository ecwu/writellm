import { isRecord } from './project.js';

export const SOURCE_SCHEMA_VERSION = 1 as const;
export const SOURCE_CATALOG_KIND = 'writellm.source-catalog' as const;
export const SOURCE_VERSION_KIND = 'writellm.source-version' as const;
export const SOURCE_JOB_KIND = 'writellm.source-job' as const;
export const SILICONFLOW_INDEX_PROFILE_ID = 'siliconflow-bge-m3-v1' as const;
export const SILICONFLOW_MODEL = 'BAAI/bge-m3' as const;
export const SILICONFLOW_VECTOR_DIMENSIONS = 1024 as const;

export const sourceChannels = {
  list: 'writellm:sources:list',
  importDialog: 'writellm:sources:import-dialog',
  get: 'writellm:sources:get',
  retry: 'writellm:sources:retry',
  remove: 'writellm:sources:remove',
  events: 'writellm:sources:events',
} as const;

export const sourceServiceChannels = {
  get: 'writellm:source-services:get',
  mineruSave: 'writellm:source-services:mineru-save',
  mineruRemove: 'writellm:source-services:mineru-remove',
  mineruValidate: 'writellm:source-services:mineru-validate',
  siliconflowSave: 'writellm:source-services:siliconflow-save',
  siliconflowRemove: 'writellm:source-services:siliconflow-remove',
  siliconflowValidate: 'writellm:source-services:siliconflow-validate',
} as const;

export type SourceErrorCode =
  | 'NO_ACTIVE_PROJECT'
  | 'SOURCE_INVALID_INPUT'
  | 'SOURCE_UNAUTHORIZED_SENDER'
  | 'SOURCE_CONFLICT'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_IMPORT_UNREADABLE'
  | 'SOURCE_UNSUPPORTED_PDF'
  | 'SOURCE_LIMIT_EXCEEDED'
  | 'SOURCE_DUPLICATE'
  | 'SOURCE_STORAGE_UNAVAILABLE'
  | 'SOURCE_RECOVERY_REQUIRED'
  | 'SOURCE_MINERU_NOT_CONFIGURED'
  | 'SOURCE_MINERU_AUTH'
  | 'SOURCE_MINERU_RATE_LIMITED'
  | 'SOURCE_MINERU_TEMPORARY'
  | 'SOURCE_MINERU_REJECTED'
  | 'SOURCE_MINERU_MALFORMED'
  | 'SOURCE_SILICONFLOW_NOT_CONFIGURED'
  | 'SOURCE_SILICONFLOW_AUTH'
  | 'SOURCE_SILICONFLOW_RATE_LIMITED'
  | 'SOURCE_SILICONFLOW_TEMPORARY'
  | 'SOURCE_INDEX_MODEL_UNAVAILABLE'
  | 'SOURCE_INDEX_MALFORMED'
  | 'SOURCE_INDEX_FAILED'
  | 'SOURCE_REFERENCED'
  | 'SOURCE_INTERNAL';

export type SourceError = {
  code: SourceErrorCode;
  messageKey: string;
  retryable: boolean;
  affectedChunkCount?: number;
};

export type SourceState = 'queued' | 'parsing' | 'indexing' | 'available' | 'partial' | 'failed';
export type SourceSummary = {
  sourceId: string;
  revision: number;
  displayName: string;
  sizeBytes: number;
  importedAt: string;
  state: SourceState;
  progress: { completed: number; total: number; stage: 'queued' | 'parsing' | 'indexing' };
  eligibility: { indexed: number; eligible: number; failed: number };
  retrying: boolean;
  retryable: boolean;
};
export type SourceDetail = SourceSummary & {
  parseSummary: { markdownAvailable: boolean; mediaCount: number; blockCount: number };
  failure?: {
    code: SourceErrorCode;
    messageKey: string;
    stage: 'import' | 'parse' | 'index' | 'remove';
  };
};
export type BlockPreview = {
  chunkId: string;
  ordinal: number;
  blockType: 'heading' | 'paragraph' | 'list' | 'table' | 'image' | 'formula' | 'other';
  markdown: string;
  media: Array<{ mediaId: string; alt: string; available: boolean }>;
  searchable: boolean;
};
export type SourceCandidateStatus =
  | 'queued'
  | 'possible-duplicate'
  | 'duplicate-confirmed'
  | 'accepted'
  | 'canceled'
  | 'failed';
export type SourceEvent = {
  sequence: number;
  catalogRevision: number;
  type: 'source-upserted' | 'source-removed' | 'candidate-updated' | 'resync-required';
  source?: SourceSummary;
  candidateId?: string;
  candidateStatus?: SourceCandidateStatus;
};

export type ListSourcesRequest = { cursor?: string; limit: number };
export type ListSourcesResult =
  | { status: 'ok'; sources: SourceSummary[]; nextCursor?: string; catalogRevision: number }
  | { status: 'error'; error: SourceError };
export type ImportOutcome =
  | { status: 'queued' | 'possible-duplicate'; candidateId: string; displayName: string }
  | { status: 'rejected'; displayName: string; error: SourceError };
export type ImportSourcesResult =
  | { status: 'canceled' }
  | { status: 'accepted'; outcomes: ImportOutcome[]; catalogRevision: number }
  | { status: 'conflict'; catalogRevision: number }
  | { status: 'error'; error: SourceError };
export type GetSourceResult =
  | { status: 'ok'; source: SourceDetail; blocks: BlockPreview[]; nextCursor?: string }
  | { status: 'error'; error: SourceError };
export type RetrySourceResult =
  | { status: 'accepted'; source: SourceSummary }
  | { status: 'conflict'; currentSource?: SourceSummary; catalogRevision: number }
  | { status: 'error'; error: SourceError };

export type CancelImportRequest = {
  target: 'candidate';
  candidateId: string;
  expectedCatalogRevision: number;
};
export type RemoveSourceRequest = {
  target: 'source';
  sourceId: string;
  expectedSourceRevision: number;
  confirmationToken?: string;
};
export type SourceRemovalRequest = CancelImportRequest | RemoveSourceRequest;
export type RemoveSourceResult =
  | { status: 'candidate-canceled'; candidateId: string; catalogRevision: number }
  | {
      status: 'confirmation-required';
      source: SourceSummary;
      confirmationToken: string;
      impact: { activeJobCount: number; searchableBlockCount: number };
    }
  | { status: 'removed'; sourceId: string; catalogRevision: number }
  | { status: 'referenced'; source: SourceSummary }
  | { status: 'conflict'; currentSource?: SourceSummary; catalogRevision: number }
  | { status: 'error'; error: SourceError };

export type ServiceProvider = 'mineru' | 'siliconflow';
export type SourceServiceSummary = {
  provider: ServiceProvider;
  revision: string | null;
  configured: boolean;
  available: boolean;
  validation: {
    status: 'never' | 'running' | 'succeeded' | 'failed';
    completedAt?: string;
    code?: SourceErrorCode;
  };
};
export type SaveServiceCredentialInput = { expectedRevision: string | null; credential: string };
export type ServiceRevisionInput = { expectedRevision: string };
export type GetServiceStatusResult =
  | { status: 'ok'; mineru: SourceServiceSummary; siliconflow: SourceServiceSummary }
  | { status: 'error'; error: SourceError };
export type ServiceMutationResult =
  | { status: 'saved' | 'removed'; summary: SourceServiceSummary }
  | { status: 'conflict'; currentSummary: SourceServiceSummary }
  | { status: 'error'; error: SourceError; currentSummary?: SourceServiceSummary };
export type ValidateServiceResult =
  | { status: 'completed' | 'stale'; summary: SourceServiceSummary }
  | { status: 'error'; error: SourceError; currentSummary?: SourceServiceSummary };

export interface SourcesApi {
  listSources(input: ListSourcesRequest): Promise<ListSourcesResult>;
  importSourcesFromDialog(input: { expectedCatalogRevision: number }): Promise<ImportSourcesResult>;
  getSource(input: { sourceId: string; cursor?: string; limit: number }): Promise<GetSourceResult>;
  retrySource(input: {
    sourceId: string;
    expectedSourceRevision: number;
  }): Promise<RetrySourceResult>;
  removeSource(input: SourceRemovalRequest): Promise<RemoveSourceResult>;
  subscribeSourceEvents(
    input: { afterSequence: number },
    listener: (event: SourceEvent) => void,
  ): () => void;
}
export interface SourceServicesApi {
  getServiceStatus(): Promise<GetServiceStatusResult>;
  saveMinerUCredential(input: SaveServiceCredentialInput): Promise<ServiceMutationResult>;
  removeMinerUCredential(input: ServiceRevisionInput): Promise<ServiceMutationResult>;
  validateMinerUCredential(input: ServiceRevisionInput): Promise<ValidateServiceResult>;
  saveSiliconFlowCredential(input: SaveServiceCredentialInput): Promise<ServiceMutationResult>;
  removeSiliconFlowCredential(input: ServiceRevisionInput): Promise<ServiceMutationResult>;
  validateSiliconFlowCredential(input: ServiceRevisionInput): Promise<ValidateServiceResult>;
}

const invalid = (): SourceError => ({
  code: 'SOURCE_INVALID_INPUT',
  messageKey: 'sources.error.invalidInput',
  retryable: false,
});
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const boundedId = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  !hasControlCharacter(value);
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

export function parseListSourcesRequest(value: unknown): ListSourcesRequest | SourceError {
  if (!isRecord(value)) return invalid();
  const keys = value.cursor === undefined ? ['limit'] : ['cursor', 'limit'];
  if (
    !exact(value, keys) ||
    !Number.isInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 100
  )
    return invalid();
  if (value.cursor !== undefined && !boundedId(value.cursor)) return invalid();
  return value.cursor === undefined
    ? { limit: value.limit as number }
    : { cursor: value.cursor as string, limit: value.limit as number };
}
export function parseImportSourcesRequest(
  value: unknown,
): { expectedCatalogRevision: number } | SourceError {
  return isRecord(value) &&
    exact(value, ['expectedCatalogRevision']) &&
    revision(value.expectedCatalogRevision)
    ? { expectedCatalogRevision: value.expectedCatalogRevision as number }
    : invalid();
}
export function parseGetSourceRequest(
  value: unknown,
): { sourceId: string; cursor?: string; limit: number } | SourceError {
  if (!isRecord(value)) return invalid();
  const keys = value.cursor === undefined ? ['sourceId', 'limit'] : ['sourceId', 'cursor', 'limit'];
  if (
    !exact(value, keys) ||
    !boundedId(value.sourceId) ||
    !Number.isInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 100 ||
    (value.cursor !== undefined && !boundedId(value.cursor))
  )
    return invalid();
  return {
    sourceId: value.sourceId as string,
    limit: value.limit as number,
    ...(value.cursor === undefined ? {} : { cursor: value.cursor as string }),
  };
}
export function parseRetrySourceRequest(
  value: unknown,
): { sourceId: string; expectedSourceRevision: number } | SourceError {
  return isRecord(value) &&
    exact(value, ['sourceId', 'expectedSourceRevision']) &&
    boundedId(value.sourceId) &&
    revision(value.expectedSourceRevision)
    ? {
        sourceId: value.sourceId as string,
        expectedSourceRevision: value.expectedSourceRevision as number,
      }
    : invalid();
}
export function parseSourceSubscriptionRequest(
  value: unknown,
): { afterSequence: number } | SourceError {
  return isRecord(value) && exact(value, ['afterSequence']) && revision(value.afterSequence)
    ? { afterSequence: value.afterSequence as number }
    : invalid();
}
export function parseSaveServiceCredentialInput(
  value: unknown,
): SaveServiceCredentialInput | SourceError {
  if (!isRecord(value) || !exact(value, ['expectedRevision', 'credential'])) return invalid();
  if (value.expectedRevision !== null && !boundedId(value.expectedRevision)) return invalid();
  if (
    typeof value.credential !== 'string' ||
    value.credential.length < 1 ||
    value.credential.length > 4096 ||
    value.credential.trim().length === 0 ||
    hasControlCharacter(value.credential)
  )
    return invalid();
  return {
    expectedRevision: value.expectedRevision as string | null,
    credential: value.credential,
  };
}
export function parseServiceRevisionInput(value: unknown): ServiceRevisionInput | SourceError {
  return isRecord(value) && exact(value, ['expectedRevision']) && boundedId(value.expectedRevision)
    ? { expectedRevision: value.expectedRevision as string }
    : invalid();
}
export function parseCancelImportRequest(value: unknown): CancelImportRequest | SourceError {
  return isRecord(value) &&
    exact(value, ['target', 'candidateId', 'expectedCatalogRevision']) &&
    value.target === 'candidate' &&
    boundedId(value.candidateId) &&
    revision(value.expectedCatalogRevision)
    ? {
        target: 'candidate',
        candidateId: value.candidateId as string,
        expectedCatalogRevision: value.expectedCatalogRevision as number,
      }
    : invalid();
}
export function parseRemoveSourceRequest(value: unknown): RemoveSourceRequest | SourceError {
  if (!isRecord(value)) return invalid();
  const keys =
    value.confirmationToken === undefined
      ? ['target', 'sourceId', 'expectedSourceRevision']
      : ['target', 'sourceId', 'expectedSourceRevision', 'confirmationToken'];
  if (
    !exact(value, keys) ||
    value.target !== 'source' ||
    !boundedId(value.sourceId) ||
    !revision(value.expectedSourceRevision)
  )
    return invalid();
  if (value.confirmationToken !== undefined && !boundedId(value.confirmationToken))
    return invalid();
  return {
    target: 'source',
    sourceId: value.sourceId as string,
    expectedSourceRevision: value.expectedSourceRevision as number,
    ...(value.confirmationToken === undefined
      ? {}
      : { confirmationToken: value.confirmationToken as string }),
  };
}
export function parseSourceRemovalRequest(value: unknown): SourceRemovalRequest | SourceError {
  if (!isRecord(value)) return invalid();
  return value.target === 'candidate'
    ? parseCancelImportRequest(value)
    : parseRemoveSourceRequest(value);
}
export function parseSourceEvent(value: unknown): SourceEvent | null {
  if (
    !isRecord(value) ||
    !revision(value.sequence) ||
    (value.sequence as number) < 1 ||
    !revision(value.catalogRevision)
  )
    return null;
  if (
    !['source-upserted', 'source-removed', 'candidate-updated', 'resync-required'].includes(
      String(value.type),
    )
  )
    return null;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'sequence',
          'catalogRevision',
          'type',
          'source',
          'candidateId',
          'candidateStatus',
        ].includes(key),
    )
  )
    return null;
  return value as SourceEvent;
}
export function redactSourceError(
  _error: unknown,
  code: SourceErrorCode,
  retryable = false,
): SourceError {
  const names: Partial<Record<SourceErrorCode, string>> = {
    SOURCE_INTERNAL: 'sources.error.internal',
    SOURCE_STORAGE_UNAVAILABLE: 'sources.error.storageUnavailable',
    SOURCE_MINERU_TEMPORARY: 'sources.error.mineruTemporary',
    SOURCE_SILICONFLOW_TEMPORARY: 'sources.error.siliconflowTemporary',
  };
  return { code, messageKey: names[code] ?? `sources.error.${code.toLowerCase()}`, retryable };
}
