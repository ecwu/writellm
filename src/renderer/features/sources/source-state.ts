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
export type SourceLibraryAction =
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

export function sourceLibraryReducer(
  state: SourceLibraryState,
  action: SourceLibraryAction,
): SourceLibraryState {
  switch (action.type) {
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
}

function dedupe(sources: SourceSummary[]): SourceSummary[] {
  return [...new Map(sources.map((source) => [source.sourceId, source])).values()];
}
