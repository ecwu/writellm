import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { SourceLibrary } from '../../../src/renderer/features/sources/SourceLibrary';
import type { SourcesApi } from '../../../src/shared/sources';
import { sourceFixture } from '../../fixtures/sources/source-fixtures';

test('loads sources and acknowledges imports without blocking the library', async () => {
  let listener: Parameters<SourcesApi['subscribeSourceEvents']>[1] = () => undefined;
  const api: SourcesApi = {
    listSources: async () => ({ status: 'ok', sources: [sourceFixture()], catalogRevision: 1 }),
    importSourcesFromDialog: async () => ({
      status: 'accepted',
      catalogRevision: 1,
      outcomes: [{ status: 'queued', candidateId: 'candidate', displayName: 'new.pdf' }],
    }),
    getSource: async () => ({
      status: 'error',
      error: { code: 'SOURCE_NOT_FOUND', messageKey: 'x', retryable: false },
    }),
    retrySource: async () => ({
      status: 'error',
      error: { code: 'SOURCE_NOT_FOUND', messageKey: 'x', retryable: false },
    }),
    removeSource: async () => ({
      status: 'candidate-canceled',
      candidateId: 'candidate',
      catalogRevision: 1,
    }),
    subscribeSourceEvents: (_input, next) => {
      listener = next;
      return () => undefined;
    },
  };
  const view = render(<SourceLibrary api={api} />);
  await waitFor(() => expect(view.getByText('Research paper.pdf')).toBeInTheDocument());
  fireEvent.click(view.getByRole('button', { name: /Import PDFs/i }));
  expect(await view.findByText('new.pdf')).toBeInTheDocument();
  act(() =>
    listener({
      sequence: 1,
      catalogRevision: 2,
      type: 'candidate-updated',
      candidateId: 'candidate',
      candidateStatus: 'accepted',
    }),
  );
  await waitFor(() => expect(view.queryByText('new.pdf')).not.toBeInTheDocument());
});
