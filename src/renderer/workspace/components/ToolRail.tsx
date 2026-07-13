import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { TooltipTrigger } from '@/components/ui/tooltip';
import type { ToolPanelDescriptor } from '../workspaceSession';
export function ToolRail({
  panels,
  activePanelId,
  registerTrigger,
  onPreview,
  onLeave,
  onPin,
}: {
  panels: readonly ToolPanelDescriptor[];
  activePanelId: string | null;
  registerTrigger(id: string, node: HTMLButtonElement | null): void;
  onPreview(id: string): void;
  onLeave(event: ReactPointerEvent): void;
  onPin(id: string): void;
}) {
  return (
    <nav className="workspace-tool-rail" aria-label="Workspace tools">
      {panels
        .filter((panel) => !panel.disabled)
        .map((panel) => {
          const Icon = panel.icon;
          return (
            <TooltipTrigger key={panel.id} content={`Open ${panel.label}`}>
              <Button
                ref={(node) => registerTrigger(panel.id, node)}
                type="button"
                variant="secondary"
                aria-pressed={activePanelId === panel.id}
                onPointerEnter={() => onPreview(panel.id)}
                onPointerLeave={onLeave}
                onClick={() => onPin(panel.id)}
              >
                <Icon aria-hidden="true" focusable="false" />
                {panel.label}
              </Button>
            </TooltipTrigger>
          );
        })}
    </nav>
  );
}
