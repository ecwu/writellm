import { Save } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { EmptyState } from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ProjectSnapshot } from '../../shared/project';
import { ProjectNavigation } from './components/ProjectNavigation';
import { ToolPanelHost } from './components/ToolPanelHost';
import { ToolRail } from './components/ToolRail';
import { WorkspaceCategoryRail } from './components/WorkspaceCategoryRail';
import { WorkspaceNavigationFrame } from './components/WorkspaceNavigationFrame';
import { WorkspaceSlot } from './components/WorkspaceSlot';
import { WorkspaceStatusRegion } from './components/WorkspaceStatusRegion';
import {
  createWorkspaceNavigationSession,
  workspaceNavigationSessionReducer,
} from './workspaceNavigationSession';
import {
  createWorkspaceSession,
  type OwnerStatusSummary,
  selectPrimaryStatus,
  type ToolPanelDescriptor,
  workspaceSessionReducer,
} from './workspaceSession';

export type WorkspaceShellProps = {
  project: ProjectSnapshot;
  workspaceSlot: ReactNode;
  panels: readonly ToolPanelDescriptor[];
  statuses: readonly OwnerStatusSummary[];
  onLeaveWorkspace(): void;
  leaveGuard?: WorkspaceLeaveGuard;
};
export type WorkspaceLeaveGuard = {
  ownerId: 'writing-orientation' | 'chapter';
  dirty: boolean;
  save(): Promise<{ ok: true } | { ok: false; message: string }>;
  discard(): void;
};

export type WorkspaceNavigationShellProps = {
  project: ProjectSnapshot;
  sections: ReactNode | ((controls: WorkspaceOwnerNavigationControls) => ReactNode);
  knowledgeBase: ReactNode | ((controls: WorkspaceOwnerNavigationControls) => ReactNode);
  settings(close: () => void): ReactNode;
  statuses?: readonly OwnerStatusSummary[];
  onLeaveWorkspace(): void;
  leaveGuard?: WorkspaceLeaveGuard;
};
export type WorkspaceOwnerNavigationControls = {
  activateItem(): void;
  showList(): void;
  openSettings(): void;
};

export function WorkspaceShell(props: WorkspaceShellProps | WorkspaceNavigationShellProps) {
  return 'sections' in props ? (
    <NavigationWorkspaceShell {...props} />
  ) : (
    <LegacyWorkspaceShell {...props} />
  );
}

function NavigationWorkspaceShell({
  project,
  sections,
  knowledgeBase,
  settings,
  statuses = [],
  onLeaveWorkspace,
  leaveGuard,
}: WorkspaceNavigationShellProps) {
  const [session, dispatch] = useReducer(
    workspaceNavigationSessionReducer,
    project.projectId,
    createWorkspaceNavigationSession,
  );
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  useEffect(
    () => dispatch({ type: 'project.reset', projectId: project.projectId }),
    [project.projectId],
  );
  const closeSettings = useCallback(() => {
    const returnKey = session.settings?.focusKey ?? session.focusReturnKey;
    dispatch({ type: 'settings.close' });
    queueMicrotask(() => {
      const target = returnKey ? triggers.current.get(returnKey) : null;
      (target?.isConnected
        ? target
        : triggers.current.get(`category-${session.activeCategory}`)
      )?.focus();
    });
  }, [session.activeCategory, session.focusReturnKey, session.settings]);
  const requestLeave = () => {
    if (!leaveGuard?.dirty) onLeaveWorkspace();
    else {
      setLeaveError('');
      setLeaveOpen(true);
    }
  };
  const saveAndLeave = async () => {
    if (!leaveGuard || leaveBusy) return;
    setLeaveBusy(true);
    const result = await leaveGuard
      .save()
      .catch(() => ({ ok: false as const, message: 'Your work could not be saved.' }));
    setLeaveBusy(false);
    if (result.ok) onLeaveWorkspace();
    else setLeaveError(result.message);
  };
  const primaryStatus = selectPrimaryStatus(statuses);
  const openSettings = useCallback(() => {
    dispatch({ type: 'settings.open', focusKey: 'settings' });
    queueMicrotask(() =>
      (document.querySelector('[data-settings-heading]') as HTMLElement | null)?.focus(),
    );
  }, []);
  const ownerControls: WorkspaceOwnerNavigationControls = {
    activateItem: () =>
      dispatch({
        type: 'item.activate',
        category: session.activeCategory,
        itemId: `owner-selection-${session.generation + 1}`,
      }),
    showList: () => dispatch({ type: 'list.show' }),
    openSettings,
  };
  const ownerContent = (
    <div className="workspace-owner-stack col-[2/4] grid min-h-0 min-w-0 max-[719px]:col-start-1 max-[719px]:row-start-2">
      <div
        className="col-start-1 row-start-1 min-h-0 min-w-0"
        hidden={session.activeCategory !== 'sections'}
        inert={session.activeCategory !== 'sections' ? true : undefined}
      >
        {typeof sections === 'function' ? sections(ownerControls) : sections}
      </div>
      {(session.visitedCategories.has('knowledge-base') ||
        session.activeCategory === 'knowledge-base') && (
        <div
          className="col-start-1 row-start-1 min-h-0 min-w-0"
          hidden={session.activeCategory !== 'knowledge-base'}
          inert={session.activeCategory !== 'knowledge-base' ? true : undefined}
        >
          {typeof knowledgeBase === 'function' ? knowledgeBase(ownerControls) : knowledgeBase}
        </div>
      )}
    </div>
  );
  return (
    <>
      <WorkspaceNavigationFrame
        workspaceRef={workspaceRef}
        settingsOpen={Boolean(session.settings)}
        sidebarExpanded={session.sidebarExpanded}
        compactPane={session.compactPane}
        onToggleSidebar={() => dispatch({ type: 'sidebar.toggle' })}
        rail={
          <WorkspaceCategoryRail
            project={project}
            activeCategory={session.activeCategory}
            settingsOpen={Boolean(session.settings)}
            registerTrigger={(key) => (node) => {
              if (node) triggers.current.set(key, node);
              else triggers.current.delete(key);
            }}
            onCategory={(category) => dispatch({ type: 'category.activate', category })}
            onSettings={() => {
              if (session.settings) closeSettings();
              else openSettings();
            }}
            onLeave={requestLeave}
          />
        }
        content={ownerContent}
        settings={settings(closeSettings)}
        status={<WorkspaceStatusRegion status={primaryStatus} />}
      />
      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (!leaveBusy) setLeaveOpen(open);
        }}
      >
        <DialogContent
          finalFocus={() => document.querySelector<HTMLElement>('[data-dialog-focus-fallback]')}
        >
          <DialogTitle>
            Unsaved {leaveGuard?.ownerId === 'chapter' ? 'chapter' : 'writing orientation'}
          </DialogTitle>
          <DialogDescription>Save your changes before leaving this project?</DialogDescription>
          {leaveError && <p role="alert">{leaveError}</p>}
          <Button autoFocus busy={leaveBusy} onClick={() => void saveAndLeave()}>
            <Save aria-hidden="true" focusable="false" />
            Save and leave
          </Button>
          <Button
            variant="destructive"
            disabled={leaveBusy}
            onClick={() => {
              leaveGuard?.discard();
              onLeaveWorkspace();
            }}
          >
            Discard and leave
          </Button>
          <Button disabled={leaveBusy} onClick={() => setLeaveOpen(false)}>
            Stay
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LegacyWorkspaceShell({
  project,
  workspaceSlot,
  panels,
  statuses,
  onLeaveWorkspace,
  leaveGuard,
}: WorkspaceShellProps) {
  const [session, dispatch] = useReducer(
    workspaceSessionReducer,
    { project, statuses },
    ({ project: initialProject, statuses: initialStatuses }) => {
      let initial = createWorkspaceSession(initialProject);
      for (const summary of initialStatuses)
        initial = workspaceSessionReducer(initial, { type: 'status.receive', summary });
      return initial;
    },
  );
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const slotRef = useRef<HTMLElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRegions = useRef(0);
  const returnKey = useRef<string | null>(null);
  const receivedStatusIds = useRef(new Set(statuses.map((summary) => summary.sourceId)));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const requestLeave = () => {
    if (!leaveGuard?.dirty) onLeaveWorkspace();
    else {
      setLeaveError('');
      setLeaveOpen(true);
    }
  };
  const saveAndLeave = async () => {
    if (!leaveGuard || leaveBusy) return;
    setLeaveBusy(true);
    const result = await leaveGuard
      .save()
      .catch(() => ({ ok: false as const, message: 'Writing orientation could not be saved.' }));
    setLeaveBusy(false);
    if (result.ok) onLeaveWorkspace();
    else setLeaveError(result.message);
  };

  const cancelPreviewClose = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
  }, []);
  const restoreFocus = useCallback(() => {
    const trigger = returnKey.current ? triggers.current.get(returnKey.current) : null;
    if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    else slotRef.current?.focus();
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
    const nextIds = new Set(statuses.map((summary) => summary.sourceId));
    for (const sourceId of receivedStatusIds.current)
      if (!nextIds.has(sourceId)) dispatch({ type: 'status.remove', sourceId });
    for (const summary of statuses) dispatch({ type: 'status.receive', summary });
    receivedStatusIds.current = nextIds;
  }, [statuses]);
  useEffect(() => () => cancelPreviewClose(), [cancelPreviewClose]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        session.activePanelId &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        closePanel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closePanel, session.activePanelId]);

  const availablePanels = useMemo(() => panels.filter((panel) => !panel.disabled), [panels]);
  const activePanel = availablePanels.find((panel) => panel.id === session.activePanelId) ?? null;
  const primaryStatus = selectPrimaryStatus(session.statusBySource.values());
  const regionEnter = () => {
    pointerRegions.current += 1;
    cancelPreviewClose();
  };
  const regionLeave = () => {
    pointerRegions.current = Math.max(0, pointerRegions.current - 1);
    if (session.panelMode !== 'preview') return;
    cancelPreviewClose();
    previewTimer.current = setTimeout(() => {
      if (pointerRegions.current === 0) dispatch({ type: 'panel.close' });
    }, 200);
  };

  return (
    <div className="grid min-h-svh grid-rows-[auto_minmax(0,1fr)_auto] bg-background">
      <ProjectNavigation project={project} onLeave={requestLeave} />
      <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)_minmax(16rem,24rem)] max-[860px]:grid-cols-1 max-[860px]:grid-rows-[auto_minmax(12rem,1fr)_auto]">
        <ToolRail
          panels={availablePanels}
          activePanelId={session.activePanelId}
          registerTrigger={(id, node) => {
            if (node) triggers.current.set(id, node);
            else triggers.current.delete(id);
          }}
          onPreview={(id) => {
            regionEnter();
            if (session.panelMode !== 'pinned')
              dispatch({ type: 'panel.preview', id, focusReturnKey: id });
          }}
          onLeave={regionLeave}
          onPin={(id) => {
            cancelPreviewClose();
            pointerRegions.current = 0;
            dispatch({ type: 'panel.pin', id, focusReturnKey: id });
          }}
        />
        <WorkspaceSlot ref={slotRef} project={project}>
          {workspaceSlot}
        </WorkspaceSlot>
        <ToolPanelHost
          panel={activePanel}
          onEnter={regionEnter}
          onLeave={regionLeave}
          onClose={closePanel}
        />
      </div>
      <WorkspaceStatusRegion status={primaryStatus} />
      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (!leaveBusy) setLeaveOpen(open);
        }}
      >
        <DialogContent
          finalFocus={() => document.querySelector<HTMLElement>('[data-dialog-focus-fallback]')}
        >
          <DialogTitle>
            Unsaved {leaveGuard?.ownerId === 'chapter' ? 'chapter' : 'writing orientation'}
          </DialogTitle>
          <DialogDescription>Save your changes before leaving this project?</DialogDescription>
          {leaveError && <p role="alert">{leaveError}</p>}
          <Button autoFocus busy={leaveBusy} onClick={() => void saveAndLeave()}>
            <Save aria-hidden="true" focusable="false" />
            Save and leave
          </Button>
          <Button
            variant="destructive"
            disabled={leaveBusy}
            onClick={() => {
              leaveGuard?.discard();
              onLeaveWorkspace();
            }}
          >
            Discard and leave
          </Button>
          <Button disabled={leaveBusy} onClick={() => setLeaveOpen(false)}>
            Stay
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const defaultWorkspaceSlot = (
  <EmptyState
    title="Project ready"
    description="This project is ready for the next writing feature."
  />
);
