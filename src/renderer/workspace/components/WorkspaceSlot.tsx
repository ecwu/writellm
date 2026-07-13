import { forwardRef, type ReactNode } from 'react';
import type { ProjectSnapshot } from '../../../shared/project';
export const WorkspaceSlot = forwardRef<
  HTMLElement,
  { project: ProjectSnapshot; children: ReactNode }
>(({ project, children }, ref) => (
  <main
    ref={ref}
    tabIndex={-1}
    className="min-h-0 min-w-0 overflow-auto p-[clamp(1rem,3vw,2rem)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    aria-label={`Workspace for ${project.displayName}`}
    data-project-id={project.projectId}
  >
    {children}
  </main>
));
WorkspaceSlot.displayName = 'WorkspaceSlot';
