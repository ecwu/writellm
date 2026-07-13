import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import {
  navigationProject,
  PersistentOwnerFixture,
} from '../../fixtures/workspace/workspace-navigation-fixtures';
function SecretOwner({ close }: { close(): void }) {
  const [secret, setSecret] = useState('');
  return (
    <main aria-label="Application settings">
      <h1 data-settings-heading tabIndex={-1}>
        Application-level Settings
      </h1>
      <label>
        Write-only credential
        <input value={secret} onChange={(event) => setSecret(event.target.value)} />
      </label>
      <button type="button" onClick={close}>
        Back to workspace
      </button>
    </main>
  );
}
test('Settings keeps project panes mounted/inert, clears write-only drafts and restores focus', () => {
  const view = render(
    <WorkspaceShell
      project={navigationProject}
      sections={<PersistentOwnerFixture />}
      knowledgeBase={<p>Knowledge</p>}
      settings={(close) => <SecretOwner close={close} />}
      onLeaveWorkspace={() => {}}
    />,
  );
  const settingsTrigger = view.getByRole('button', { name: 'Settings' });
  fireEvent.click(settingsTrigger);
  const project = view.container.querySelector('.workspace-navigation-project')!;
  expect(project.hasAttribute('inert')).toBeTrue();
  fireEvent.change(view.getByRole('textbox', { name: 'Write-only credential' }), {
    target: { value: 'must-clear' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Back to workspace' }));
  expect(project.hasAttribute('inert')).toBeFalse();
  fireEvent.click(settingsTrigger);
  expect(
    (view.getByRole('textbox', { name: 'Write-only credential' }) as HTMLInputElement).value,
  ).toBe('');
});
