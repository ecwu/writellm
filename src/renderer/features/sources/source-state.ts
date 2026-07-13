import type {
  ImportOutcome,
  SourceError,
  SourceEvent,
  SourceSummary,
  SourcesApi,
} from '../../../shared/sources';

export type SourceCandidate = Extract<ImportOutcome, { candidateId: string }> & {
  status: 'queued' | 'possible-duplicate';
};
export type SourceLibraryState = {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  sources: SourceSummary[];
  candidates: SourceCandidate[];
  catalogRevision: number;
  nextCursor?: string;
  lastSequence: number;
  needsResync: boolean;
  importing: boolean;
  error?: SourceError;
};
export type SourceNavigationItem = Pick<
  SourceSummary,
  'revision' | 'displayName' | 'state' | 'progress' | 'eligibility' | 'retrying' | 'retryable'
> & { id: string };
export type SourceDetailViewState = {
  sourceId: string | null;
  sourceRevision: number;
  sourceVersionId: string | null;
  generation: number;
  phase: 'idle' | 'loading' | 'ready' | 'partial' | 'error';
  mode: 'original-pdf' | 'structured-markdown';
  detail: import('../../../shared/sources').SourceDetail | null;
  blocks: import('../../../shared/sources').BlockPreview[];
  nextCursor?: string;
  error?: SourceError;
};
export type SourceLibraryAction =
  | { type: 'reset' }
  | { type: 'load.start' }
  | {
      type: 'load.success';
      sources: SourceSummary[];
      catalogRevision: number;
      nextCursor?: string;
      append?: boolean;
    }
  | { type: 'load.error'; error: SourceError }
  | { type: 'import.start' }
  | { type: 'import.finish'; outcomes: ImportOutcome[] }
  | { type: 'event'; event: SourceEvent };

export const createSourceLibraryState = (): SourceLibraryState => ({
  phase: 'idle',
  sources: [],
  candidates: [],
  catalogRevision: 0,
  lastSequence: 0,
  needsResync: false,
  importing: false,
});

export const projectSourceNavigationItems = (
  sources: readonly SourceSummary[],
): SourceNavigationItem[] =>
  sources.map((source) => ({
    id: source.sourceId,
    revision: source.revision,
    displayName: source.displayName,
    state: source.state,
    progress: source.progress,
    eligibility: source.eligibility,
    retrying: source.retrying,
    retryable: source.retryable,
  }));

export const createSourceDetailViewState = (): SourceDetailViewState => ({
  sourceId: null,
  sourceRevision: 0,
  sourceVersionId: null,
  generation: 0,
  phase: 'idle',
  mode: 'structured-markdown',
  detail: null,
  blocks: [],
});

export function beginSourceDetailRequest(
  state: SourceDetailViewState,
  source: SourceSummary,
): SourceDetailViewState {
  const sameSource = state.sourceId === source.sourceId;
  return {
    ...state,
    sourceId: source.sourceId,
    sourceRevision: source.revision,
    generation: state.generation + 1,
    phase: 'loading',
    ...(sameSource
      ? {}
      : {
          sourceVersionId: null,
          mode: 'structured-markdown' as const,
          detail: null,
          blocks: [],
          nextCursor: undefined,
        }),
    error: undefined,
  };
}

export function applySourceDetailResult(
  state: SourceDetailViewState,
  input: {
    sourceId: string;
    generation: number;
    result: Awaited<ReturnType<SourcesApi['getSource']>>;
  },
): SourceDetailViewState {
  if (
    input.sourceId !== state.sourceId ||
    input.generation !== state.generation ||
    input.result.status !== 'ok'
  )
    return state;
  if (input.result.source.sourceVersionId !== input.result.sourceVersionId)
    return { ...state, phase: 'error', detail: null, blocks: [] };
  return {
    ...state,
    sourceRevision: input.result.source.revision,
    sourceVersionId: input.result.sourceVersionId,
    phase: input.result.source.state === 'partial' ? 'partial' : 'ready',
    detail: input.result.source,
    blocks: [...input.result.blocks].sort((a, b) => a.ordinal - b.ordinal),
    nextCursor: input.result.nextCursor,
    error: undefined,
  };
}

export function appendSourceDetailPage(
  state: SourceDetailViewState,
  input: {
    sourceId: string;
    sourceVersionId: string;
    generation: number;
    blocks: import('../../../shared/sources').BlockPreview[];
    nextCursor?: string;
  },
): SourceDetailViewState {
  if (
    input.sourceId !== state.sourceId ||
    input.sourceVersionId !== state.sourceVersionId ||
    input.generation !== state.generation
  )
    return state;
  const blocks = [...state.blocks, ...input.blocks].sort((a, b) => a.ordinal - b.ordinal);
  if (new Set(blocks.map((block) => block.chunkId)).size !== blocks.length) return state;
  return { ...state, blocks, nextCursor: input.nextCursor };
}

export function sourceLibraryReducer(
  state: SourceLibraryState,
  action: SourceLibraryAction,
): SourceLibraryState {
  switch (action.type) {
    case 'reset':
      return createSourceLibraryState();
    case 'load.start':
      return { ...state, phase: 'loading', error: undefined };
    case 'load.error':
      return { ...state, phase: 'error', error: action.error };
    case 'load.success':
      return {
        ...state,
        phase: 'ready',
        sources: action.append ? dedupe([...state.sources, ...action.sources]) : action.sources,
        catalogRevision: action.catalogRevision,
        nextCursor: action.nextCursor,
        needsResync: false,
        error: undefined,
      };
    case 'import.start':
      return { ...state, importing: true };
    case 'import.finish':
      return {
        ...state,
        importing: false,
        candidates: [
          ...state.candidates,
          ...action.outcomes.filter(
            (outcome): outcome is SourceCandidate =>
              outcome.status === 'queued' || outcome.status === 'possible-duplicate',
          ),
        ],
      };
    case 'event': {
      const event = action.event;
      if (event.type === 'resync-required' || event.sequence !== state.lastSequence + 1)
        return { ...state, lastSequence: event.sequence, needsResync: true };
      if (event.type === 'source-upserted' && event.source)
        return {
          ...state,
          lastSequence: event.sequence,
          catalogRevision: event.catalogRevision,
          sources: dedupe([event.source, ...state.sources]),
        };
      if (event.type === 'source-removed' && event.source)
        return {
          ...state,
          lastSequence: event.sequence,
          catalogRevision: event.catalogRevision,
          sources: state.sources.filter((source) => source.sourceId !== event.source?.sourceId),
        };
      if (event.type === 'candidate-updated' && event.candidateId)
        return {
          ...state,
          lastSequence: event.sequence,
          catalogRevision: event.catalogRevision,
          candidates: ['accepted', 'canceled', 'duplicate-confirmed', 'failed'].includes(
            event.candidateStatus ?? '',
          )
            ? state.candidates.filter((candidate) => candidate.candidateId !== event.candidateId)
            : state.candidates,
        };
      return { ...state, lastSequence: event.sequence, catalogRevision: event.catalogRevision };
    }
  }
}

export async function loadSourceLibrary(
  api: SourcesApi,
  cursor?: string,
): Promise<Extract<SourceLibraryAction, { type: 'load.success' | 'load.error' }>> {
  try {
    const result = await api.listSources({ limit: 100, ...(cursor ? { cursor } : {}) });
    return result.status === 'ok'
      ? {
          type: 'load.success',
          sources: result.sources,
          catalogRevision: result.catalogRevision,
          nextCursor: result.nextCursor,
          append: Boolean(cursor),
        }
      : { type: 'load.error', error: result.error };
  } catch {
    return {
      type: 'load.error',
      error: { code: 'SOURCE_INTERNAL', messageKey: 'source.internal', retryable: true },
    };
  }
}

export type SourceErrorCopy = {
  message: string;
  action: 'settings' | 'retry' | 'remove';
};

export function sourceErrorCopy(error: Pick<SourceError, 'code'>): SourceErrorCopy {
  switch (error.code) {
    case 'SOURCE_MINERU_NOT_CONFIGURED':
    case 'SOURCE_SILICONFLOW_NOT_CONFIGURED':
      return {
        message: 'A required processing service is not configured. Add its credential in Settings.',
        action: 'settings',
      };
    case 'SOURCE_MINERU_AUTH':
    case 'SOURCE_SILICONFLOW_AUTH':
      return {
        message:
          'A processing service rejected its credential. Review the saved credential in Settings.',
        action: 'settings',
      };
    case 'SOURCE_MINERU_RATE_LIMITED':
    case 'SOURCE_SILICONFLOW_RATE_LIMITED':
      return {
        message:
          'A processing service is rate limiting requests. Automatic retry will continue when possible.',
        action: 'retry',
      };
    case 'SOURCE_MINERU_TEMPORARY':
    case 'SOURCE_SILICONFLOW_TEMPORARY':
    case 'SOURCE_INDEX_MODEL_UNAVAILABLE':
      return {
        message:
          'A processing service is temporarily unavailable. Automatic retry will continue when possible.',
        action: 'retry',
      };
    case 'SOURCE_IMPORT_UNREADABLE':
    case 'SOURCE_UNSUPPORTED_PDF':
      return {
        message:
          'This PDF could not be read in a supported form. Remove it and import a supported PDF.',
        action: 'remove',
      };
    case 'SOURCE_REFERENCED':
      return {
        message: 'This source is still cited by a chapter and cannot be removed.',
        action: 'remove',
      };
    case 'SOURCE_CONFLICT':
      return {
        message: 'The source changed while this action was running. Refresh it and try again.',
        action: 'retry',
      };
    case 'SOURCE_STORAGE_UNAVAILABLE':
    case 'SOURCE_RECOVERY_REQUIRED':
      return {
        message:
          'Source storage needs attention before processing can continue. Retry after the project is available.',
        action: 'retry',
      };
    default:
      return {
        message:
          'This source operation could not be completed safely. Retry it or remove the source.',
        action: 'retry',
      };
  }
}

export function sourceFailureStageLabel(stage: 'import' | 'parse' | 'index' | 'remove'): string {
  return stage === 'parse'
    ? 'Parsing'
    : stage === 'index'
      ? 'Indexing'
      : stage === 'import'
        ? 'Import'
        : 'Removal';
}

function dedupe(sources: SourceSummary[]): SourceSummary[] {
  return [...new Map(sources.map((source) => [source.sourceId, source])).values()];
}
