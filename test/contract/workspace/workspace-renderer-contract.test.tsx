import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { ObservableSlot, panels, project, status } from '../../fixtures/workspace/workspace-fixtures';
test('workspace renderer contract exposes named regions without IPC', () => { const html = renderToStaticMarkup(<WorkspaceShell project={project} workspaceSlot={<ObservableSlot />} panels={panels} statuses={[status()]} onLeaveWorkspace={() => {}} />); for (const value of ['Project navigation', 'Workspace tools', `Workspace for ${project.displayName}`, 'Workspace status', project.displayName]) expect(html).toContain(value); expect(html).not.toContain('Unavailable future tool'); });
