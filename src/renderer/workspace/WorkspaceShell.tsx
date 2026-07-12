import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { ProjectSnapshot } from '../../shared/project';
import { EmptyState } from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/button';
import { ProjectNavigation } from './components/ProjectNavigation';
import { ToolPanelHost } from './components/ToolPanelHost';
import { ToolRail } from './components/ToolRail';
import { WorkspaceSlot } from './components/WorkspaceSlot';
import { WorkspaceStatusRegion } from './components/WorkspaceStatusRegion';
import { createWorkspaceSession, selectPrimaryStatus, workspaceSessionReducer, type OwnerStatusSummary, type ToolPanelDescriptor } from './workspaceSession';

export type WorkspaceShellProps = {
  project: ProjectSnapshot;
  workspaceSlot: ReactNode;
  panels: readonly ToolPanelDescriptor[];
  statuses: readonly OwnerStatusSummary[];
  onLeaveWorkspace(): void;
  leaveGuard?: WorkspaceLeaveGuard;
};
export type WorkspaceLeaveGuard = { ownerId: 'writing-orientation'; dirty: boolean; save(): Promise<{ ok: true } | { ok: false; message: string }>; discard(): void };

export function WorkspaceShell({ project, workspaceSlot, panels, statuses, onLeaveWorkspace, leaveGuard }: WorkspaceShellProps) {
  const [session, dispatch] = useReducer(workspaceSessionReducer, { project, statuses }, ({ project: initialProject, statuses: initialStatuses }) => {
    let initial = createWorkspaceSession(initialProject);
    for (const summary of initialStatuses) initial = workspaceSessionReducer(initial, { type: 'status.receive', summary });
    return initial;
  });
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const slotRef = useRef<HTMLElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRegions = useRef(0);
  const returnKey = useRef<string | null>(null);
  const receivedStatusIds = useRef(new Set(statuses.map(summary => summary.sourceId)));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const requestLeave = () => { if (!leaveGuard?.dirty) onLeaveWorkspace(); else { setLeaveError(''); setLeaveOpen(true); } };
  const saveAndLeave = async () => { if (!leaveGuard || leaveBusy) return; setLeaveBusy(true); const result = await leaveGuard.save().catch(() => ({ ok: false as const, message: 'Writing orientation could not be saved.' })); setLeaveBusy(false); if (result.ok) onLeaveWorkspace(); else setLeaveError(result.message); };

  const cancelPreviewClose = useCallback(() => { if (previewTimer.current) clearTimeout(previewTimer.current); previewTimer.current = null; }, []);
  const restoreFocus = useCallback(() => {
    const trigger = returnKey.current ? triggers.current.get(returnKey.current) : null;
    if (trigger?.isConnected && !trigger.disabled) trigger.focus(); else slotRef.current?.focus();
    returnKey.current = null;
  }, []);
  const closePanel = useCallback(() => {
    if (!session.activePanelId) return;
    cancelPreviewClose();
    returnKey.current = session.panelFocusReturnKey;
    dispatch({ type: 'panel.close' });
    queueMicrotask(restoreFocus);
  }, [cancelPreviewClose, restoreFocus, session.activePanelId, session.panelFocusReturnKey]);

  useEffect(() => {
    const nextIds = new Set(statuses.map(summary => summary.sourceId));
    for (const sourceId of receivedStatusIds.current) if (!nextIds.has(sourceId)) dispatch({ type: 'status.remove', sourceId });
    for (const summary of statuses) dispatch({ type: 'status.receive', summary });
    receivedStatusIds.current = nextIds;
  }, [statuses]);
  useEffect(() => () => cancelPreviewClose(), [cancelPreviewClose]);
  useEffect(() => { if (!leaveOpen) return; const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape' && !leaveBusy) { event.preventDefault(); setLeaveOpen(false); } }; document.addEventListener('keydown', cancel); return () => document.removeEventListener('keydown', cancel); }, [leaveBusy, leaveOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.activePanelId && !document.querySelector('[role="dialog"]')) { event.preventDefault(); closePanel(); } };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closePanel, session.activePanelId]);

  const availablePanels = useMemo(() => panels.filter(panel => !panel.disabled), [panels]);
  const activePanel = availablePanels.find(panel => panel.id === session.activePanelId) ?? null;
  const primaryStatus = selectPrimaryStatus(session.statusBySource.values());
  const regionEnter = () => { pointerRegions.current += 1; cancelPreviewClose(); };
  const regionLeave = () => {
    pointerRegions.current = Math.max(0, pointerRegions.current - 1);
    if (session.panelMode !== 'preview') return;
    cancelPreviewClose();
    previewTimer.current = setTimeout(() => { if (pointerRegions.current === 0) dispatch({ type: 'panel.close' }); }, 200);
  };

  return <div className="workspace-shell">
    <ProjectNavigation project={project} onLeave={requestLeave} />
    <div className="workspace-layout">
      <ToolRail panels={availablePanels} activePanelId={session.activePanelId} registerTrigger={(id, node) => { if (node) triggers.current.set(id, node); else triggers.current.delete(id); }} onPreview={(id) => { regionEnter(); if (session.panelMode !== 'pinned') dispatch({ type: 'panel.preview', id, focusReturnKey: id }); }} onLeave={regionLeave} onPin={(id) => { cancelPreviewClose(); pointerRegions.current = 0; dispatch({ type: 'panel.pin', id, focusReturnKey: id }); }} />
      <WorkspaceSlot ref={slotRef} project={project}>{workspaceSlot}</WorkspaceSlot>
      <ToolPanelHost panel={activePanel} onEnter={regionEnter} onLeave={regionLeave} onClose={closePanel} />
    </div>
    <WorkspaceStatusRegion status={primaryStatus} />
    {leaveOpen && <div role="dialog" aria-modal="true" aria-labelledby="leave-title" className="workspace-leave-dialog"><h2 id="leave-title">Unsaved writing orientation</h2><p>Save your changes before leaving this project?</p>{leaveError && <p role="alert">{leaveError}</p>}<Button autoFocus disabled={leaveBusy} onClick={() => void saveAndLeave()}>Save and leave</Button><Button disabled={leaveBusy} onClick={() => { leaveGuard?.discard(); onLeaveWorkspace(); }}>Discard and leave</Button><Button disabled={leaveBusy} onClick={() => setLeaveOpen(false)}>Stay</Button></div>}
  </div>;
}

export const defaultWorkspaceSlot = <EmptyState title="Project ready" description="This project is ready for the next writing feature." />;
