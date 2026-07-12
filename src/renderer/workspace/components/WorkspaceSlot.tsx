import { forwardRef, type ReactNode } from 'react';
import type { ProjectSnapshot } from '../../../shared/project';
export const WorkspaceSlot = forwardRef<
  HTMLElement,
  { project: ProjectSnapshot; children: ReactNode }
>(({ project, children }, ref) => (
  <main
    ref={ref}
    tabIndex={-1}
    className="workspace-slot"
    aria-label={`Workspace for ${project.displayName}`}
    data-project-id={project.projectId}
  >
    {children}
  </main>
));
WorkspaceSlot.displayName = 'WorkspaceSlot';
