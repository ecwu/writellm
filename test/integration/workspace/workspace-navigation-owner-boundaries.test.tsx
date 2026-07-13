import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { WorkspaceLocationHeader } from '../../../src/renderer/workspace/components/WorkspaceLocationHeader';
import { navigationProject } from '../../fixtures/workspace/workspace-navigation-fixtures';
test('category, collapse and Settings navigation invoke no owner mutations', () => {
  let mutations = 0;
  const view = render(
    <WorkspaceShell
      project={navigationProject}
      sections={
        <>
          <WorkspaceLocationHeader project={navigationProject.displayName} category="Sections" />
          <button type="button" onClick={() => (mutations += 1)}>
            Owner mutation
          </button>
        </>
      }
      knowledgeBase={<p>Knowledge owner</p>}
      settings={(close) => (
        <main>
          <button type="button" onClick={close}>
            Back to workspace
          </button>
        </main>
      )}
      onLeaveWorkspace={() => {}}
    />,
  );
  fireEvent.click(view.getByRole('button', { name: 'Knowledge Base' }));
  fireEvent.click(view.getByRole('button', { name: 'Sections' }));
  fireEvent.click(view.getByRole('button', { name: 'Collapse sidebar' }));
  fireEvent.click(view.getByRole('button', { name: 'Settings' }));
  fireEvent.click(view.getByRole('button', { name: 'Back to workspace' }));
  expect(mutations).toBe(0);
});
