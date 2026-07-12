import { beforeEach, expect, test } from 'bun:test';
import '../../setup/renderer-dom';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { ObservableSlot, panels, project } from '../../fixtures/workspace/workspace-fixtures';

beforeEach(() => document.body.replaceChildren());

test('panel switching preserves workspace DOM, text selection, and scroll context', async () => {
  const user = userEvent.setup({ document });
  const view = render(
    <WorkspaceShell
      project={project}
      workspaceSlot={<ObservableSlot />}
      panels={panels}
      statuses={[]}
      onLeaveWorkspace={() => {}}
    />,
  );
  const slot = view.getByTestId('observable-slot');
  const input = view.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement;
  input.value = 'In-flight draft';
  input.setSelectionRange(3, 9);
  slot.scrollTop = 240;

  await user.click(view.getByRole('button', { name: 'Sources' }));
  expect(view.getByText('Source panel content')).toBeTruthy();
  await user.click(view.getByRole('button', { name: 'Outline' }));
  expect(view.getByText('Outline panel content')).toBeTruthy();
  expect(view.queryByText('Source panel content')).toBeNull();
  await user.click(view.getByRole('button', { name: 'Close Outline' }));

  const currentInput = view.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement;
  expect(view.getByTestId('observable-slot')).toBe(slot);
  expect(currentInput).toBe(input);
  expect(currentInput.value).toBe('In-flight draft');
  expect([currentInput.selectionStart, currentInput.selectionEnd]).toEqual([3, 9]);
  expect(slot.scrollTop).toBe(240);
});

test('status updates do not remount the workspace slot', () => {
  const view = render(
    <WorkspaceShell
      project={project}
      workspaceSlot={<ObservableSlot />}
      panels={panels}
      statuses={[]}
      onLeaveWorkspace={() => {}}
    />,
  );
  const slot = view.getByTestId('observable-slot');
  view.rerender(
    <WorkspaceShell
      project={project}
      workspaceSlot={<ObservableSlot />}
      panels={panels}
      statuses={[
        {
          sourceId: 'writer',
          sequence: 1,
          state: 'error',
          severity: 'error',
          message: 'Write failed safely',
        },
      ]}
      onLeaveWorkspace={() => {}}
    />,
  );
  expect(view.getByTestId('observable-slot')).toBe(slot);
  expect(view.getByRole('alert').textContent).toContain('Write failed safely');
});
