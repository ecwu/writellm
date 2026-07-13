import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextNavigationList } from '../../../src/renderer/workspace/components/ContextNavigationList';
import { WorkspaceDetail } from '../../../src/renderer/workspace/components/WorkspaceDetail';
import { WorkspaceNavigationFrame } from '../../../src/renderer/workspace/components/WorkspaceNavigationFrame';
import { sectionNavigationItems } from '../../fixtures/workspace/workspace-navigation-fixtures';

test('frame exposes owner slots, landmarks, independent regions, and inert Settings state', () => {
  const html = renderToStaticMarkup(
    <WorkspaceNavigationFrame
      settingsOpen
      sidebarExpanded
      compactPane="list"
      onToggleSidebar={() => {}}
      rail={<nav aria-label="Workspace categories" />}
      context={
        <ContextNavigationList
          label="Sections"
          items={sectionNavigationItems}
          selectedId={null}
          onSelect={() => {}}
        />
      }
      detail={<WorkspaceDetail label="Section detail">detail</WorkspaceDetail>}
      settings={<main aria-label="Application settings">settings</main>}
    />,
  );
  expect(html).toContain('Workspace categories');
  expect(html).toContain('Sections list');
  expect(html).toContain('Section detail content');
  expect(html).toContain('Application settings');
  expect(html).toContain('inert=""');
  expect(html).not.toContain('sidebar_state');
  expect(html).not.toContain('localStorage');
  expect(html).not.toContain('Control+B');
});
