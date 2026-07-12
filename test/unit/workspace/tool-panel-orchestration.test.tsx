import { beforeEach, expect, test } from 'bun:test';
import '../../setup/renderer-dom';
import { fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { ObservableSlot, panels, project } from '../../fixtures/workspace/workspace-fixtures';

beforeEach(() => document.body.replaceChildren());

test('hover previews, panel entry cancels grace close, and click pins one panel', async () => {
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
  const sources = view.getByRole('button', { name: 'Sources' });
  fireEvent.pointerEnter(sources);
  const preview = view.getByRole('complementary', { name: 'Sources' });
  fireEvent.pointerLeave(sources);
  fireEvent.pointerEnter(preview);
  await new Promise((resolve) => setTimeout(resolve, 220));
  expect(view.getByText('Source panel content')).toBeTruthy();

  await user.click(sources);
  fireEvent.pointerLeave(sources);
  await new Promise((resolve) => setTimeout(resolve, 220));
  expect(view.getByText('Source panel content')).toBeTruthy();
  await user.click(view.getByRole('button', { name: 'Outline' }));
  expect(view.getAllByRole('complementary')).toHaveLength(1);
  expect(view.getByText('Outline panel content')).toBeTruthy();
});
