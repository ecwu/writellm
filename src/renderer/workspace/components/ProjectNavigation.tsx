import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { ProjectSnapshot } from '../../../shared/project';
export function ProjectNavigation({
  project,
  onLeave,
}: {
  project: ProjectSnapshot;
  onLeave(): void;
}) {
  return (
    <nav className="workspace-project-navigation" aria-label="Project navigation">
      <div>
        <p className="eyebrow">Current project</p>
        <h1>{project.displayName}</h1>
      </div>
      <Button type="button" variant="secondary" data-dialog-focus-fallback onClick={onLeave}>
        <ArrowLeft aria-hidden="true" focusable="false" />
        Back to projects
      </Button>
    </nav>
  );
}
