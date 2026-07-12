import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { ObservableSlot, panels, project } from '../../fixtures/workspace/workspace-fixtures';

test('exact project identity and all stable shell regions render', () => {
  const html = renderToStaticMarkup(
    <WorkspaceShell
      project={project}
      workspaceSlot={<ObservableSlot />}
      panels={panels}
      statuses={[]}
      onLeaveWorkspace={() => {}}
    />,
  );
  expect(html).toContain(`data-project-id="${project.projectId}"`);
  for (const name of [
    project.displayName,
    'Back to projects',
    'Workspace tools',
    'Workspace status',
  ])
    expect(html).toContain(name);
});
