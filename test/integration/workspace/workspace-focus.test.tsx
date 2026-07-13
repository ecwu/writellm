import { beforeEach, expect, test } from 'bun:test';
import '../../setup/renderer-dom';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { ObservableSlot, panels, project } from '../../fixtures/workspace/workspace-fixtures';

beforeEach(() => document.body.replaceChildren());

test('pinned panel keeps trigger focus and Escape restores it', async () => {
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
  const trigger = view.getByRole('button', { name: 'Sources' });
  await user.click(trigger);
  expect(document.activeElement).toBe(trigger);
  expect(view.getByText('Source panel content')).toBeTruthy();
  await user.keyboard('{Escape}');
  await Promise.resolve();
  expect(view.queryByText('Source panel content')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('Escape falls back to the named workspace when the trigger disappears', async () => {
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
  await user.click(view.getByRole('button', { name: 'Sources' }));
  view.rerender(
    <WorkspaceShell
      project={project}
      workspaceSlot={<ObservableSlot />}
      panels={panels.filter((panel) => panel.id !== 'sources')}
      statuses={[]}
      onLeaveWorkspace={() => {}}
    />,
  );
  await user.keyboard('{Escape}');
  await Promise.resolve();
  expect(document.activeElement).toBe(
    view.getByRole('main', { name: `Workspace for ${project.displayName}` }),
  );
  expect(document.activeElement).not.toBe(document.body);
});

test('guarded leave uses the shared modal focus, inert, Escape, and restore contract', async () => {
  const user = userEvent.setup({ document });
  const view = render(
    <WorkspaceShell
      project={project}
      workspaceSlot={<ObservableSlot />}
      panels={panels}
      statuses={[]}
      onLeaveWorkspace={() => {}}
      leaveGuard={{
        ownerId: 'writing-orientation',
        dirty: true,
        save: async () => ({ ok: true }),
        discard: () => {},
      }}
    />,
  );
  const back = view.getByRole('button', { name: 'Back to projects' });
  await user.click(back);
  await Promise.resolve();
  const dialog = view.getByRole('dialog', { name: 'Unsaved writing orientation' });
  expect(dialog).toBeTruthy();
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'Save and leave' }));
  expect(view.container.hasAttribute('data-base-ui-inert')).toBeTrue();
  await user.keyboard('{Escape}');
  await Promise.resolve();
  expect(view.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(back));
  expect(view.container.hasAttribute('data-base-ui-inert')).toBeFalse();
});
