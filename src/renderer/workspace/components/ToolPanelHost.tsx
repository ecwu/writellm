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
      className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] border-l bg-card max-[860px]:max-h-[40vh] max-[860px]:border-t max-[860px]:border-l-0"
      aria-labelledby={titleId}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="flex items-center justify-between gap-4 border-b p-4">
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
      <ScrollArea className="min-h-0 p-4">{panel.render()}</ScrollArea>
    </aside>
  );
}
