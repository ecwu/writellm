import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { TooltipTrigger } from '@/components/ui/tooltip';
import type { ToolPanelDescriptor } from '../workspaceSession';
export function ToolRail({ panels, activePanelId, registerTrigger, onPreview, onLeave, onPin }: { panels: readonly ToolPanelDescriptor[]; activePanelId: string | null; registerTrigger(id: string, node: HTMLButtonElement | null): void; onPreview(id: string): void; onLeave(event: ReactPointerEvent): void; onPin(id: string): void }) {
  return <nav className="workspace-tool-rail" aria-label="Workspace tools">{panels.filter(panel => !panel.disabled).map(panel => <TooltipTrigger key={panel.id} content={panel.label}><Button ref={(node) => registerTrigger(panel.id, node)} type="button" variant="secondary" aria-pressed={activePanelId === panel.id} onPointerEnter={() => onPreview(panel.id)} onPointerLeave={onLeave} onClick={() => onPin(panel.id)}>{panel.label}</Button></TooltipTrigger>)}</nav>;
}
