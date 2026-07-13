import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { SourceDetail } from '../../../src/renderer/features/sources/SourceDetail';
import type { SourcesApi } from '../../../src/shared/sources';
import { sourceFixture } from '../../fixtures/sources/source-fixtures';

test('retries, confirms destructive impact, reports references and returns after removal', async () => {
  cleanup();
  const source = sourceFixture({ state: 'failed', retryable: true });
  let removed = false,
    back = false;
  const api = {
    getSource: async () => ({
      status: 'ok' as const,
      source: {
        ...source,
        parseSummary: { markdownAvailable: false, mediaCount: 0, blockCount: 0 },
      },
      blocks: [],
    }),
    retrySource: async () => ({
      status: 'accepted' as const,
      source: { ...source, revision: 2, retrying: true },
    }),
    removeSource: async (input: { confirmationToken?: string }) => {
      if (!input.confirmationToken)
        return {
          status: 'confirmation-required' as const,
          source,
          confirmationToken: 'token',
          impact: { activeJobCount: 1, searchableBlockCount: 2 },
        };
      removed = true;
      return { status: 'removed' as const, sourceId: source.sourceId, catalogRevision: 2 };
    },
  } as unknown as SourcesApi;
  const view = render(
    <SourceDetail
      api={api}
      source={source}
      onBack={() => {
        back = true;
      }}
    />,
  );
  await waitFor(() =>
    expect(view.getByRole('button', { name: /Retry failed work/ })).toBeEnabled(),
  );
  fireEvent.click(view.getByRole('button', { name: /Retry failed work/ }));
  await waitFor(() =>
    expect(view.getByText(/Loading structured preview|structured blocks/)).toBeInTheDocument(),
  );
  fireEvent.click(view.getByRole('button', { name: /^Remove source$/ }));
  await waitFor(() => expect(view.getByText(/supersedes 1 active jobs/)).toBeInTheDocument());
  const removeButtons = view.getAllByRole('button', { name: /^Remove source$/ });
  const confirm = removeButtons.at(-1);
  if (!confirm) throw new Error('confirmation action missing');
  fireEvent.click(confirm);
  await waitFor(() => expect(removed && back).toBe(true));
});
