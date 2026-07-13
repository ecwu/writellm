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
    <nav
      className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-5 py-4 max-[860px]:items-start"
      aria-label="Project navigation"
    >
      <div>
        <p className="m-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Current project
        </p>
        <h1 className="mt-1 text-xl font-medium">{project.displayName}</h1>
      </div>
      <Button type="button" variant="secondary" data-dialog-focus-fallback onClick={onLeave}>
        <ArrowLeft aria-hidden="true" focusable="false" />
        Back to projects
      </Button>
    </nav>
  );
}
