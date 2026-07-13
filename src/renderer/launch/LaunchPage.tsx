import { useEffect, useState } from 'react';
import { FolderOpen, FolderPlus, Trash2 } from 'lucide-react';
import { useAppearance } from '@/appearance/AppearanceProvider';
import { AppearanceControls } from '@/components/patterns/AppearanceControls';
import { EmptyState } from '@/components/patterns/EmptyState';
import { FormField } from '@/components/patterns/FormField';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { WriteLLMIpc } from '../../shared/ipc';
import type { ProjectSnapshot, RecentProjectSummary } from '../../shared/project';
import { initialLaunchState, type LaunchState, loadLaunchState } from './launchState';

type LaunchPageProps = { api: WriteLLMIpc; onProjectOpened(project: ProjectSnapshot): void };

export function LaunchPage({ api, onProjectOpened }: LaunchPageProps) {
  const [state, setState] = useState<LaunchState>(initialLaunchState);
  const [displayName, setDisplayName] = useState('');
  const appearance = useAppearance();

  const refresh = async () => setState(await loadLaunchState(api));
  useEffect(() => {
    void loadLaunchState(api).then(setState);
  }, [api]);

  const showWorkspace = (project: ProjectSnapshot) => onProjectOpened(project);

  const create = async () => {
    setState((current) => ({
      status: 'working',
      recentProjects: current.recentProjects,
      message: 'Choose a parent folder…',
    }));
    const result = await api.createProject({ displayName });
    if (result.status === 'created') {
      showWorkspace(result.project);
      setDisplayName('');
      return;
    }
    if (result.status === 'canceled') {
      await refresh();
      return;
    }
    if (result.status === 'error')
      setState((current) => ({
        status: 'error',
        recentProjects: current.recentProjects,
        message: result.error.message,
      }));
  };

  const open = async () => {
    setState((current) => ({
      status: 'working',
      recentProjects: current.recentProjects,
      message: 'Choose a project folder…',
    }));
    const result = await api.openProjectFromDialog();
    if (result.status === 'opened') {
      showWorkspace(result.project);
      return;
    }
    if (result.status === 'canceled') {
      await refresh();
      return;
    }
    if (result.status === 'error')
      setState((current) => ({
        status: 'error',
        recentProjects: current.recentProjects,
        message: result.error.message,
      }));
  };

  const openRecent = async (record: RecentProjectSummary) => {
    setState((current) => ({
      status: 'working',
      recentProjects: current.recentProjects,
      message: 'Opening project…',
    }));
    const result = await api.openRecentProject({ recentId: record.recentId });
    if (result.status === 'opened') {
      showWorkspace(result.project);
      return;
    }
    setState((current) => ({
      status: 'error',
      recentProjects: current.recentProjects,
      message: result.status === 'error' ? result.error.message : 'Opening was canceled.',
    }));
  };

  const relink = async (record: RecentProjectSummary) => {
    setState((current) => ({
      status: 'working',
      recentProjects: current.recentProjects,
      message: 'Choose the moved project folder…',
    }));
    const result = await api.relinkRecentProject({ recentId: record.recentId });
    if (result.status === 'opened') {
      showWorkspace(result.project);
      return;
    }
    if (result.status === 'canceled') {
      await refresh();
      return;
    }
    if (result.status === 'error')
      setState((current) => ({
        status: 'error',
        recentProjects: current.recentProjects,
        message: result.error.message,
      }));
  };

  const remove = async (record: RecentProjectSummary) => {
    const result = await api.removeRecentProject({ recentId: record.recentId });
    if (result.status === 'removed') {
      await refresh();
      return;
    }
    setState((current) => ({
      status: 'error',
      recentProjects: current.recentProjects,
      message: result.error.message,
    }));
  };

  const busy = state.status === 'loading' || state.status === 'working';
  return (
    <main className="launch-page min-h-svh overflow-auto bg-background p-6 text-xs md:p-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-2 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">WriteLLM</p>
            <h1 id="app-title" className="cn-font-heading mt-1 text-xl font-medium">
              Projects
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              Create a portable writing project or continue where you left off.
            </p>
          </div>
        </header>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <Card aria-labelledby="new-project-title">
            <CardHeader>
              <h2 id="new-project-title" className="cn-font-heading text-sm font-medium">
                New project
              </h2>
              <p className="text-xs text-muted-foreground">
                Choose a name now; you will select its folder next.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <FormField label="Project name">
                  <Input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                  />
                </FormField>
                <Button type="submit" busy={busy} disabled={displayName.length === 0}>
                  <FolderPlus aria-hidden="true" focusable="false" />
                  Create project
                </Button>
              </form>
              <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                or
              </div>
              <Button type="button" variant="outline" onClick={() => void open()} disabled={busy}>
                <FolderOpen aria-hidden="true" focusable="false" />
                Open existing project
              </Button>
            </CardContent>
          </Card>
          <Card aria-labelledby="recent-title">
            <RecentProjects
              records={state.recentProjects}
              disabled={busy}
              onOpen={openRecent}
              onRelink={relink}
              onRemove={remove}
            />
          </Card>
        </div>
        <div className="min-h-8" aria-live="polite">
          {state.status === 'loading' ? (
            <StatusNotice>Loading recent projects…</StatusNotice>
          ) : null}
          {state.status === 'working' ? <StatusNotice>{state.message}</StatusNotice> : null}
          {state.status === 'error' ? (
            <StatusNotice tone="error">{state.message}</StatusNotice>
          ) : null}
          {state.status === 'ready' && state.warning ? (
            <StatusNotice tone="warning">{state.warning}</StatusNotice>
          ) : null}
        </div>
        <Card>
          <CardHeader>
            <h2 className="cn-font-heading text-sm font-medium">Appearance</h2>
          </CardHeader>
          <CardContent>
            <AppearanceControls
              preferences={appearance.preferences}
              pending={appearance.pending}
              message={appearance.message}
              onChange={(value) => void appearance.update(value)}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function RecentProjects({
  records,
  disabled,
  onOpen,
  onRelink,
  onRemove,
}: {
  records: RecentProjectSummary[];
  disabled: boolean;
  onOpen: (record: RecentProjectSummary) => void;
  onRelink: (record: RecentProjectSummary) => void;
  onRemove: (record: RecentProjectSummary) => void;
}) {
  return (
    <section aria-labelledby="recent-title">
      <div className="flex items-center justify-between gap-4 border-b px-6 pb-6">
        <h2 id="recent-title">Recent projects</h2>
        <span className="text-xs text-muted-foreground">{records.length}/5</span>
      </div>
      {records.length === 0 ? (
        <div className="px-6 pt-6">
          <EmptyState
            title="No recent projects yet"
            description="Projects you open or create will appear here."
          />
        </div>
      ) : (
        <ul className="m-0 grid list-none p-0">
          {records.map((record) => (
            <li
              key={record.recentId}
              className="flex flex-col gap-3 border-b px-6 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              data-ui-surface
            >
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">{record.displayName}</h3>
                <p className="mt-1">
                  <Badge>{availabilityLabel(record)}</Badge>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {record.availability === 'available' ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onOpen(record)}
                    disabled={disabled}
                  >
                    <FolderOpen aria-hidden="true" focusable="false" />
                    Open
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onRelink(record)}
                    disabled={disabled}
                  >
                    <FolderOpen aria-hidden="true" focusable="false" />
                    Relink
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(record)}
                  disabled={disabled}
                >
                  <Trash2 aria-hidden="true" focusable="false" />
                  Remove recent
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function availabilityLabel(record: RecentProjectSummary): string {
  if (record.availability === 'available') return 'Available';
  if (record.availability === 'missing') return 'Project folder is missing';
  if (record.availability === 'inaccessible') return 'Project folder cannot be read';
  return record.diagnosticCode === 'PROJECT_UNSUPPORTED_VERSION'
    ? 'Unsupported project format'
    : 'Project structure is invalid';
}
