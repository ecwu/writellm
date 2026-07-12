import type { ChapterError } from '../../../shared/chapters';
export type ChapterDraftState = {
  baseRevision: number;
  localGeneration: number;
  persistedGeneration: number;
  saveStatus: 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';
  submittedGeneration?: number;
  queued: boolean;
  lastError?: ChapterError;
};
export type ChapterDraftAction =
  | { type: 'edit' }
  | { type: 'save.start' }
  | { type: 'save.success'; revision: number; generation: number }
  | { type: 'save.failure'; error: ChapterError }
  | { type: 'conflict'; error: ChapterError }
  | { type: 'acknowledge'; revision: number }
  | { type: 'reload'; revision: number };
export const createChapterDraftState = (revision: number): ChapterDraftState => ({
  baseRevision: revision,
  localGeneration: 0,
  persistedGeneration: 0,
  saveStatus: 'saved',
  queued: false,
});
export function chapterDraftReducer(
  state: ChapterDraftState,
  action: ChapterDraftAction,
): ChapterDraftState {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        localGeneration: state.localGeneration + 1,
        saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
        queued: state.saveStatus === 'saving' || state.queued,
      };
    case 'save.start':
      return state.saveStatus === 'saving'
        ? { ...state, queued: true }
        : {
            ...state,
            saveStatus: 'saving',
            submittedGeneration: state.localGeneration,
            queued: false,
            lastError: undefined,
          };
    case 'save.success': {
      const dirty = state.localGeneration > action.generation;
      return {
        ...state,
        baseRevision: action.revision,
        persistedGeneration: action.generation,
        saveStatus: dirty ? 'dirty' : 'saved',
        submittedGeneration: undefined,
        queued: dirty,
        lastError: undefined,
      };
    }
    case 'save.failure':
      return {
        ...state,
        saveStatus: 'failed',
        submittedGeneration: undefined,
        lastError: action.error,
      };
    case 'conflict':
      return {
        ...state,
        saveStatus: 'conflict',
        submittedGeneration: undefined,
        lastError: action.error,
      };
    case 'acknowledge':
      return { ...state, baseRevision: action.revision, saveStatus: 'dirty', lastError: undefined };
    case 'reload':
      return { ...createChapterDraftState(action.revision) };
  }
}
export const chapterIsDirty = (state: ChapterDraftState) =>
  state.localGeneration !== state.persistedGeneration;
