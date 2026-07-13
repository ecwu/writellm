import { expect, test } from 'bun:test';
import {
  createSourceLibraryState,
  sourceLibraryReducer,
} from '../../../src/renderer/features/sources/source-state';
import { sourceEventFixture, sourceFixture } from '../../fixtures/sources/source-fixtures';

test('pages sources, tracks candidates and requests authoritative reload on event gaps', () => {
  let state = createSourceLibraryState();
  state = sourceLibraryReducer(state, {
    type: 'load.success',
    sources: [sourceFixture()],
    catalogRevision: 1,
    nextCursor: '1',
  });
  state = sourceLibraryReducer(state, {
    type: 'load.success',
    sources: [sourceFixture({ sourceId: 'second' })],
    catalogRevision: 1,
    append: true,
  });
  expect(state.sources).toHaveLength(2);
  state = sourceLibraryReducer(state, {
    type: 'import.finish',
    outcomes: [{ status: 'queued', candidateId: 'c1', displayName: 'one.pdf' }],
  });
  expect(state.candidates).toHaveLength(1);
  state = sourceLibraryReducer(state, {
    type: 'event',
    event: sourceEventFixture({ sequence: 2 }),
  });
  expect(state.needsResync).toBe(true);
});

test('applies contiguous source and duplicate candidate events', () => {
  let state = { ...createSourceLibraryState(), phase: 'ready' as const };
  state = sourceLibraryReducer(state, { type: 'event', event: sourceEventFixture() });
  expect(state.sources).toHaveLength(1);
  state = sourceLibraryReducer(state, {
    type: 'import.finish',
    outcomes: [{ status: 'possible-duplicate', candidateId: 'c1', displayName: 'one.pdf' }],
  });
  state = sourceLibraryReducer(state, {
    type: 'event',
    event: sourceEventFixture({
      sequence: 2,
      type: 'candidate-updated',
      source: undefined,
      candidateId: 'c1',
      candidateStatus: 'duplicate-confirmed',
    }),
  });
  expect(state.candidates).toEqual([]);
});
