import { useState } from 'react';
import type { ProjectSnapshot } from '../shared/project';
import { LaunchPage } from './launch/LaunchPage';
import { defaultWorkspaceSlot, WorkspaceShell } from './workspace/WorkspaceShell';

export function App() {
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  if (!project) return <LaunchPage api={window.writellm} onProjectOpened={setProject} />;
  return <WorkspaceShell project={project} workspaceSlot={defaultWorkspaceSlot} panels={[]} statuses={[]} onLeaveWorkspace={() => setProject(null)} />;
}
