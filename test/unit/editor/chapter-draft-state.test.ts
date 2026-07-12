import { describe, expect, test } from 'bun:test';
import {
  chapterDraftReducer,
  createChapterDraftState,
} from '../../../src/renderer/features/editor/chapter-draft-state';

describe('chapter draft state', () => {
  test('does not mark newer edits saved by an older request', () => {
    let state = createChapterDraftState(0);
    state = chapterDraftReducer(state, { type: 'edit' });
    state = chapterDraftReducer(state, { type: 'save.start' });
    state = chapterDraftReducer(state, { type: 'edit' });
    state = chapterDraftReducer(state, { type: 'save.success', revision: 1, generation: 1 });
    expect(state.saveStatus).toBe('dirty');
    expect(state.persistedGeneration).toBe(1);
  });
  test('keeps current conflict draft dirty at acknowledged revision', () => {
    let state = chapterDraftReducer(createChapterDraftState(0), { type: 'edit' });
    state = chapterDraftReducer(state, {
      type: 'conflict',
      error: { code: 'REVISION_CONFLICT', message: 'changed', retryable: true },
    });
    state = chapterDraftReducer(state, { type: 'acknowledge', revision: 2 });
    expect(state.saveStatus).toBe('dirty');
    expect(state.baseRevision).toBe(2);
  });
});
