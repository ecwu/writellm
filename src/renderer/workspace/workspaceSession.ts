import type { ReactNode } from 'react';
import type { ProjectSnapshot } from '../../shared/project';

export type ToolPanelId = string;
export type FocusReturnKey = string;
export type StatusState =
  | 'in-progress'
  | 'complete'
  | 'error'
  | 'needs-action'
  | 'unknown'
  | 'owner-unavailable';
export type StatusSeverity = 'info' | 'success' | 'warning' | 'error';

export type ToolPanelDescriptor = {
  id: ToolPanelId;
  label: string;
  disabled?: boolean;
  render(): ReactNode;
};

export type OwnerStatusSummary = {
  sourceId: string;
  sequence: number;
  state: StatusState;
  severity: StatusSeverity;
  message: string;
  action?: { label: string; invoke(): void };
};

export type WorkspaceSession = {
  project: ProjectSnapshot;
  activePanelId: ToolPanelId | null;
  panelMode: 'preview' | 'pinned' | null;
  panelFocusReturnKey: FocusReturnKey | null;
  latestStatusSequenceBySource: ReadonlyMap<string, number>;
  statusBySource: ReadonlyMap<string, OwnerStatusSummary>;
};

export type WorkspaceSessionEvent =
  | { type: 'panel.preview'; id: ToolPanelId; focusReturnKey: FocusReturnKey }
  | { type: 'panel.pin'; id: ToolPanelId; focusReturnKey: FocusReturnKey }
  | { type: 'panel.close' }
  | { type: 'status.receive'; summary: OwnerStatusSummary }
  | { type: 'status.remove'; sourceId: string };

export function createWorkspaceSession(project: ProjectSnapshot): WorkspaceSession {
  return {
    project,
    activePanelId: null,
    panelMode: null,
    panelFocusReturnKey: null,
    latestStatusSequenceBySource: new Map(),
    statusBySource: new Map(),
  };
}

function validStatus(summary: OwnerStatusSummary): boolean {
  if (
    !summary.sourceId.trim() ||
    !summary.message.trim() ||
    !Number.isSafeInteger(summary.sequence) ||
    summary.sequence < 0
  )
    return false;
  if (summary.action && !summary.action.label.trim()) return false;
  if (summary.state === 'error') return summary.severity === 'error';
  if (summary.state === 'complete') return summary.severity === 'success';
  return summary.severity !== 'success' && summary.severity !== 'error';
}

export function workspaceSessionReducer(
  session: WorkspaceSession,
  event: WorkspaceSessionEvent,
): WorkspaceSession {
  if (event.type === 'panel.preview')
    return {
      ...session,
      activePanelId: event.id,
      panelMode: 'preview',
      panelFocusReturnKey: event.focusReturnKey,
    };
  if (event.type === 'panel.pin') {
    if (session.activePanelId === event.id && session.panelMode === 'pinned')
      return { ...session, activePanelId: null, panelMode: null, panelFocusReturnKey: null };
    return {
      ...session,
      activePanelId: event.id,
      panelMode: 'pinned',
      panelFocusReturnKey: event.focusReturnKey,
    };
  }
  if (event.type === 'panel.close') {
    if (!session.activePanelId) return session;
    return { ...session, activePanelId: null, panelMode: null, panelFocusReturnKey: null };
  }
  if (event.type === 'status.receive') {
    const { summary } = event;
    const last = session.latestStatusSequenceBySource.get(summary.sourceId) ?? -1;
    if (!validStatus(summary) || summary.sequence <= last) return session;
    const sequences = new Map(session.latestStatusSequenceBySource);
    const statuses = new Map(session.statusBySource);
    sequences.set(summary.sourceId, summary.sequence);
    statuses.set(summary.sourceId, summary);
    return { ...session, latestStatusSequenceBySource: sequences, statusBySource: statuses };
  }
  const statuses = new Map(session.statusBySource);
  if (!statuses.delete(event.sourceId)) return session;
  return { ...session, statusBySource: statuses };
}

const priority: Record<StatusState, number> = {
  error: 6,
  'needs-action': 5,
  'owner-unavailable': 4,
  unknown: 3,
  'in-progress': 2,
  complete: 1,
};
export function selectPrimaryStatus(
  statuses: Iterable<OwnerStatusSummary>,
): OwnerStatusSummary | null {
  return (
    [...statuses].sort(
      (a, b) =>
        priority[b.state] - priority[a.state] ||
        b.sequence - a.sequence ||
        a.sourceId.localeCompare(b.sourceId),
    )[0] ?? null
  );
}
