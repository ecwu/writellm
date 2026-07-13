import { describe, expect, test } from 'bun:test';
import {
  appendSourceDetailPage,
  applySourceDetailResult,
  beginSourceDetailRequest,
  createSourceDetailViewState,
} from '../../../src/renderer/features/sources/source-state';
import {
  blockFixture,
  FIXTURE_VERSION_ID,
  sourceFixture,
} from '../../fixtures/sources/source-fixtures';

const detail = {
  ...sourceFixture({ state: 'partial' }),
  sourceVersionId: FIXTURE_VERSION_ID,
  parseSummary: {
    markdownAvailable: true,
    originalPreviewAvailable: true,
    mediaCount: 0,
    blockCount: 2,
    indexedBlockCount: 1,
    failedBlockCount: 0,
    incompleteBlockCount: 1,
  },
};
describe('source detail view fencing', () => {
  test('accepts only current generation and consistent detail/page version', () => {
    let state = beginSourceDetailRequest(createSourceDetailViewState(), sourceFixture());
    const generation = state.generation;
    const stale = applySourceDetailResult(state, {
      sourceId: 'other',
      generation,
      result: { status: 'ok', source: detail, sourceVersionId: FIXTURE_VERSION_ID, blocks: [] },
    });
    expect(stale).toBe(state);
    state = applySourceDetailResult(state, {
      sourceId: detail.sourceId,
      generation,
      result: {
        status: 'ok',
        source: detail,
        sourceVersionId: FIXTURE_VERSION_ID,
        blocks: [blockFixture()],
      },
    });
    expect(state.phase).toBe('partial');
    expect(
      appendSourceDetailPage(state, {
        sourceId: detail.sourceId,
        sourceVersionId: 'stale',
        generation,
        blocks: [],
      }),
    ).toBe(state);
  });
  test('preserves loaded content and mode while refreshing the same source revision', () => {
    let state = beginSourceDetailRequest(createSourceDetailViewState(), sourceFixture());
    state = applySourceDetailResult(state, {
      sourceId: detail.sourceId,
      generation: state.generation,
      result: {
        status: 'ok',
        source: detail,
        sourceVersionId: FIXTURE_VERSION_ID,
        blocks: [blockFixture()],
      },
    });
    state = { ...state, mode: 'original-pdf' };
    const refreshed = beginSourceDetailRequest(state, sourceFixture({ revision: 2 }));
    expect(refreshed.detail).toBe(state.detail);
    expect(refreshed.blocks).toEqual(state.blocks);
    expect(refreshed.sourceVersionId).toBe(FIXTURE_VERSION_ID);
    expect(refreshed.mode).toBe('original-pdf');
  });
  test('rejects mixed detail and response version identities', () => {
    const state = beginSourceDetailRequest(createSourceDetailViewState(), sourceFixture());
    const next = applySourceDetailResult(state, {
      sourceId: detail.sourceId,
      generation: state.generation,
      result: { status: 'ok', source: detail, sourceVersionId: 'different', blocks: [] },
    });
    expect(next.phase).toBe('error');
    expect(next.detail).toBeNull();
  });
});
