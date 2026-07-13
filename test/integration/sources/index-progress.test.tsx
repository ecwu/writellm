import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import { SourceLibrary } from '../../../src/renderer/features/sources/SourceLibrary';
import type { SourcesApi } from '../../../src/shared/sources';
import { sourceFixture } from '../../fixtures/sources/source-fixtures';

test('presents searchable, partial, failed and retrying progress without provider internals', async () => {
  const source = sourceFixture({
    state: 'partial',
    progress: { completed: 500, total: 500, stage: 'indexing' },
    eligibility: { indexed: 475, eligible: 500, failed: 25 },
    retrying: true,
    retryable: true,
  });
  const api = {
    listSources: async () => ({ status: 'ok' as const, sources: [source], catalogRevision: 1 }),
    subscribeSourceEvents: () => () => undefined,
  } as unknown as SourcesApi;
  const view = render(<SourceLibrary api={api} />);
  await waitFor(() => expect(view.getByText('475 of 500 blocks searchable')).toBeInTheDocument());
  expect(view.container.textContent).not.toContain('SiliconFlow');
  expect(view.container.textContent).not.toContain('vector');
});
