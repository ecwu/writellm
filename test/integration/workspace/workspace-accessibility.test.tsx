import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import {
  ObservableSlot,
  panels,
  project,
  status,
} from '../../fixtures/workspace/workspace-fixtures';

test('workspace exposes named navigation, region, status and controls', () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      project={project}
      workspaceSlot={<ObservableSlot />}
      panels={panels}
      statuses={[status()]}
      onLeaveWorkspace={() => {}}
    />,
  );
  for (const value of [
    'aria-label="Project navigation"',
    'aria-label="Workspace tools"',
    'tabindex="-1"',
    'aria-label="Workspace status"',
    'Drafting in progress',
  ])
    expect(html).toContain(value);
});
