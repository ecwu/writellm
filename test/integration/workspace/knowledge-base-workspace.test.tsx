import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { KnowledgeBaseWorkspace } from '../../../src/renderer/features/sources/KnowledgeBaseWorkspace';
import type { BlockPreview, SourceDetail, SourcesApi } from '../../../src/shared/sources';
import {
  blockFixture,
  FIXTURE_VERSION_ID,
  sourceFixture,
} from '../../fixtures/sources/source-fixtures';

const sources = ['queued', 'parsing', 'indexing', 'partial', 'available', 'failed'].map(
  (state, index) =>
    sourceFixture({
      sourceId: `source-${state}`,
      displayName: `${state}.pdf`,
      state,
      revision: index + 1,
      retryable: state === 'failed',
      progress: {
        completed: index,
        total: 6,
        stage: state === 'queued' ? 'queued' : state === 'parsing' ? 'parsing' : 'indexing',
      },
    }),
);
const api: SourcesApi = {
  listSources: async () => ({ status: 'ok', sources, catalogRevision: 1 }),
  importSourcesFromDialog: async () => ({ status: 'canceled' }),
  getSource: async ({ sourceId }) => {
    const summary = sources.find((source) => source.sourceId === sourceId);
    if (!summary)
      return {
        status: 'error',
        error: { code: 'SOURCE_NOT_FOUND', messageKey: 'source.not-found', retryable: false },
      };
    const source: SourceDetail = {
      ...summary,
      sourceVersionId: FIXTURE_VERSION_ID,
      parseSummary: {
        markdownAvailable: true,
        originalPreviewAvailable: true,
        mediaCount: 0,
        blockCount: 3,
        indexedBlockCount: summary.eligibility.indexed,
        failedBlockCount: summary.eligibility.failed,
        incompleteBlockCount: 3,
      },
    };
    const block: BlockPreview = {
      chunkId: blockFixture().chunkId,
      ordinal: 0,
      blockType: 'paragraph',
      markdown: '<script>not active</script>',
      media: [{ mediaId: 'missing', alt: 'Missing', available: false }],
      searchable: false,
    };
    return { status: 'ok', source, sourceVersionId: FIXTURE_VERSION_ID, blocks: [block] };
  },
  retrySource: async () => ({
    status: 'error',
    error: { code: 'SOURCE_CONFLICT', messageKey: 'x', retryable: true },
  }),
  removeSource: async () => ({ status: 'conflict', catalogRevision: 1 }),
  subscribeSourceEvents: () => () => {},
};
test('Knowledge Base lists every owner state and renders reconciled current-version detail safely', async () => {
  const view = render(<KnowledgeBaseWorkspace api={api} projectName="Project" />);
  await waitFor(() => expect(view.getByText('queued.pdf')).toBeTruthy());
  for (const name of [
    'queued.pdf',
    'parsing.pdf',
    'indexing.pdf',
    'partial.pdf',
    'available.pdf',
    'failed.pdf',
  ])
    expect(view.getByText(name)).toBeTruthy();
  const parsingProgress = view.getByRole('progressbar', {
    name: 'Parsing progress for parsing.pdf',
  });
  expect(parsingProgress.getAttribute('value')).toBe('1');
  expect(parsingProgress.getAttribute('max')).toBe('6');
  expect(view.getByText('1 processed, 5 remaining')).toBeTruthy();
  expect(
    view.getByRole('progressbar', { name: 'Indexing progress for indexing.pdf' }),
  ).toBeTruthy();
  expect(view.getByText('0 searchable, 0 failed, 0 remaining')).toBeTruthy();
  expect(parsingProgress.closest('[role="status"], [role="alert"]')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /partial.pdf/ }));
  await waitFor(() => expect(view.getByText('Processed Markdown')).toBeTruthy());
  expect(view.getByText('<script>not active</script>')).toBeTruthy();
  expect(view.getByText('Referenced media is unavailable.')).toBeTruthy();
  expect(view.getByText('Limited to indexed blocks')).toBeTruthy();
});
