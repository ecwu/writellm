import type { ProjectSnapshot } from '../../../shared/project';
import { Button } from '@/components/ui/button';
export function ProjectNavigation({ project, onLeave }: { project: ProjectSnapshot; onLeave(): void }) {
  return <header className="workspace-project-navigation" aria-label="Project navigation"><div><p className="eyebrow">Current project</p><h1>{project.displayName}</h1></div><Button type="button" variant="secondary" onClick={onLeave}>Back to projects</Button></header>;
}
