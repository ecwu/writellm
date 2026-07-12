import { useMemo, useState } from 'react';
import type { ProjectSnapshot } from '../shared/project';
import { LaunchPage } from './launch/LaunchPage';
import { defaultWorkspaceSlot, WorkspaceShell } from './workspace/WorkspaceShell';
import type { WorkspaceLeaveGuard } from './workspace/WorkspaceShell';
import { WritingOrientationPanel } from './features/writing-orientation/WritingOrientationPanel';

export function App() {
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  const [leaveGuard, setLeaveGuard] = useState<WorkspaceLeaveGuard | undefined>();
  const api = window.writellmWritingOrientation;
  const panels = useMemo(() => [{ id: 'writing-orientation', label: 'Writing orientation', iconLabel: 'Plan', render: () => <WritingOrientationPanel api={api} onLeaveGuardChange={setLeaveGuard} /> }], [api]);
  if (!project) return <LaunchPage api={window.writellm} onProjectOpened={setProject} />;
  return <WorkspaceShell project={project} workspaceSlot={defaultWorkspaceSlot} panels={panels} statuses={[]} leaveGuard={leaveGuard} onLeaveWorkspace={() => { setLeaveGuard(undefined); setProject(null); }} />;
}
