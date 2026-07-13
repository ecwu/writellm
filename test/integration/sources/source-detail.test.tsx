import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
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
