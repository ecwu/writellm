import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { SourceDetail } from '../../../src/renderer/features/sources/SourceDetail';
import type { SourcesApi } from '../../../src/shared/sources';
import { sourceFixture } from '../../fixtures/sources/source-fixtures';

test('renders ordered external markdown as safe text with media relationships and eligibility', async () => {
  const api = {
    getSource: async () => ({
      status: 'ok' as const,
      source: {
        ...sourceFixture(),
        parseSummary: { markdownAvailable: true, mediaCount: 1, blockCount: 2 },
      },
      blocks: [
        {
          chunkId: 'one',
          ordinal: 0,
          blockType: 'paragraph' as const,
          markdown: '<script>bad()</script>',
          media: [],
          searchable: true,
        },
        {
          chunkId: 'two',
          ordinal: 1,
          blockType: 'image' as const,
          markdown: 'Chart',
          media: [{ mediaId: 'media', alt: 'Chart', available: true }],
          searchable: false,
        },
      ],
    }),
  } as unknown as SourcesApi;
  const view = render(<SourceDetail api={api} source={sourceFixture()} onBack={() => undefined} />);
  await waitFor(() => expect(view.getByText('<script>bad()</script>')).toBeInTheDocument());
  expect(view.container.querySelector('script')).toBeNull();
  expect(view.getByAltText('Chart')).toHaveAttribute(
    'src',
    expect.stringContaining('writellm-source://'),
  );
  expect(view.getByText(/Not yet searchable/)).toBeInTheDocument();
});

test('refreshes same-revision processing progress and clears a stale failure after manual retry', async () => {
  const failed = sourceFixture({
    state: 'failed',
    retryable: true,
    progress: { completed: 42, total: 100, stage: 'parsing' },
  });
  let current = {
    ...failed,
    sourceVersionId: 'version',
    failure: {
      code: 'SOURCE_MINERU_TEMPORARY' as const,
      messageKey: 'sources.error.mineruTemporary',
      stage: 'parse' as const,
    },
    parseSummary: {
      markdownAvailable: false,
      originalPreviewAvailable: true,
      mediaCount: 0,
      blockCount: 0,
      indexedBlockCount: 0,
      failedBlockCount: 0,
      incompleteBlockCount: 0,
    },
  };
  const api = {
    getSource: async () => ({
      status: 'ok' as const,
      source: current,
      sourceVersionId: current.sourceVersionId,
      blocks: [],
    }),
    retrySource: async () => {
      current = {
        ...current,
        state: 'parsing' as const,
        retryable: false,
        retrying: true,
        failure: undefined,
      };
      return { status: 'accepted' as const, source: current };
    },
  } as unknown as SourcesApi;
  const view = render(<SourceDetail api={api} source={failed} onBack={() => undefined} />);
  await waitFor(() => expect(view.getByText('Processing failure')).toBeInTheDocument());
  expect(view.getByText(/Automatic attempts ended/)).toBeInTheDocument();
  fireEvent.click(view.getByRole('button', { name: /Retry failed work/ }));
  await waitFor(() => expect(view.queryByText('Processing failure')).not.toBeInTheDocument());
  expect(view.getByText('Retrying parsing')).toBeInTheDocument();
  expect(view.getByText(/42% parsed; automatic retry is active/)).toBeInTheDocument();

  current = {
    ...current,
    progress: { completed: 67, total: 100, stage: 'parsing' },
  };
  view.rerender(
    <SourceDetail
      api={api}
      source={{ ...failed, state: 'parsing', retrying: true, progress: current.progress }}
      onBack={() => undefined}
    />,
  );
  await waitFor(() => expect(view.getByText(/67% parsed/)).toBeInTheDocument());
});
