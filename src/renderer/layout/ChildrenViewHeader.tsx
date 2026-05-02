
import { GitBranch, List } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import type { ChildViewMode } from '../app/types';

export function ViewModeToggle({
  mode,
  onModeChange
}: {
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
}) {
  return (
    <div className="view-mode-toggle" role="group" aria-label="Children view mode">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'graph' ? 'default' : 'outline'}
            size="icon-sm"
            onClick={() => onModeChange('graph')}
            aria-label="Graph view"
            title="Graph view"
          >
            <GitBranch />
            <span className="sr-only">Graph</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Graph</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'list' ? 'default' : 'outline'}
            size="icon-sm"
            onClick={() => onModeChange('list')}
            aria-label="List view"
            title="List view"
          >
            <List />
            <span className="sr-only">List</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>List</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ChildrenViewHeader({
  title,
  detail,
  mode,
  onModeChange
}: {
  title: string;
  detail: string;
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
}) {
  return (
    <div className="children-view-header">
      <div className="children-view-title">
        <h1>{title}</h1>
        <p className="muted">{detail}</p>
      </div>
      <ViewModeToggle mode={mode} onModeChange={onModeChange} />
    </div>
  );
}
