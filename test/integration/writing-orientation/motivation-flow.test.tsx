import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WritingOrientationPanel } from '../../../src/renderer/features/writing-orientation/WritingOrientationPanel';
import { emptyDocument } from '../../fixtures/writing-orientation/orientation-fixtures';

test('motivation stays mounted after failure and an unchanged retry reuses its mutation', async () => {
  const user = userEvent.setup({ document });
  const saved = {
    ...emptyDocument(),
    revision: 1,
    updatedAt: '2026-07-12T00:00:00.000Z',
    motivation: { problem: 'A real problem', targetReaders: '', desiredOutcome: '' },
  };
  const inputs: Array<{ mutationId: string }> = [];
  const api = {
    load: async () => ({ ok: true as const, value: emptyDocument() }),
    save: async (input: { mutationId: string }) => {
      inputs.push(input);
      return inputs.length === 1
        ? {
            ok: false as const,
            error: {
              code: 'GIT_INITIALIZATION_FAILED' as const,
              message: 'Retry history setup.',
              retryable: true,
            },
          }
        : { ok: true as const, value: { document: saved, createdItemIds: [] } };
    },
    deleteOutlineItem: async () => {
      throw new Error('not used');
    },
  };
  const view = render(<WritingOrientationPanel api={api as never} />);
  const problem = await view.findByLabelText('Problem to solve');
  await user.type(problem, 'A real problem');
  await user.click(view.getByRole('button', { name: 'Save' }));
  expect(await view.findByText('Retry history setup.')).toBeTruthy();
  expect(problem).toHaveValue('A real problem');
  await user.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.getByText('Saved')).toBeTruthy());
  expect(inputs).toHaveLength(2);
  expect(inputs[1]!.mutationId).toBe(inputs[0]!.mutationId);
});
