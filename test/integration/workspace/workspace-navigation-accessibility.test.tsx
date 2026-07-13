import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { navigationProject } from '../../fixtures/workspace/workspace-navigation-fixtures';
test('navigation exposes named category controls, current state, main content and Settings', () => {
  const view = render(
    <WorkspaceShell
      project={navigationProject}
      sections={
        <main aria-label="Section detail">
          <button type="button">Section item</button>
        </main>
      }
      knowledgeBase={<main aria-label="Knowledge Base detail" />}
      settings={(close) => (
        <main aria-label="Application settings">
          <button type="button" onClick={close}>
            Back to workspace
          </button>
        </main>
      )}
      onLeaveWorkspace={() => {}}
    />,
  );
  const categories = view.container.querySelector('nav[aria-label="Workspace categories"]');
  expect(categories).toBeTruthy();
  expect(
    categories?.querySelector('button[aria-label="Sections"]')?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(categories?.querySelector('button[aria-label="Knowledge Base"]')).toBeTruthy();
  expect(categories?.querySelector('button[aria-label="Settings"]')).toBeTruthy();
  expect(view.container.querySelector('main[aria-label="Section detail"]')).toBeTruthy();
});
