import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TooltipTrigger } from '@/components/ui/tooltip';
import { X } from 'lucide-react';
import type { ToolPanelDescriptor } from '../workspaceSession';
export function ToolPanelHost({
  panel,
  onEnter,
  onLeave,
  onClose,
}: {
  panel: ToolPanelDescriptor | null;
  onEnter(): void;
  onLeave(event: ReactPointerEvent): void;
  onClose(): void;
}) {
  if (!panel) return null;
  const titleId = `tool-panel-${panel.id}-title`;
  return (
    <aside
      className="workspace-tool-panel"
      aria-labelledby={titleId}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="workspace-panel-heading">
        <h2 id={titleId}>{panel.label}</h2>
        <TooltipTrigger content={`Close ${panel.label}`}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={`Close ${panel.label}`}
          >
            <X aria-hidden="true" focusable="false" />
          </Button>
        </TooltipTrigger>
      </div>
      <ScrollArea className="workspace-panel-scroll">{panel.render()}</ScrollArea>
    </aside>
  );
}
