import { useEffect, useState } from 'react';
import { useAppearance } from '@/appearance/AppearanceProvider';
import { AppearanceControls } from '@/components/patterns/AppearanceControls';
import { EmptyState } from '@/components/patterns/EmptyState';
import { FormField } from '@/components/patterns/FormField';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
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
    <main className="launch-shell">
      <Card className="launch-card" aria-labelledby="app-title">
        <p className="eyebrow">WriteLLM v2</p>
        <h1 id="app-title">Start a project</h1>
        <p className="summary">Create a portable project or open one you already own.</p>
        <div className="launch-actions">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <FormField label="New project name">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </FormField>
            <div className="create-row">
              <Button type="submit" disabled={busy || displayName.length === 0}>
                New project
              </Button>
            </div>
          </form>
          <Button type="button" variant="secondary" onClick={() => void open()} disabled={busy}>
            Open project
          </Button>
        </div>
        <div className="status-region" aria-live="polite">
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
        <RecentProjects
          records={state.recentProjects}
          disabled={busy}
          onOpen={openRecent}
          onRelink={relink}
          onRemove={remove}
        />
        <Separator />
        <AppearanceControls
          preferences={appearance.preferences}
          pending={appearance.pending}
          message={appearance.message}
          onChange={(value) => void appearance.update(value)}
        />
      </Card>
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
    <section className="recent-section" aria-labelledby="recent-title">
      <div className="section-heading">
        <h2 id="recent-title">Recent projects</h2>
        <span>{records.length}/5</span>
      </div>
      {records.length === 0 ? (
        <EmptyState
          title="No recent projects yet"
          description="Projects you open or create will appear here."
        />
      ) : (
        <ul className="recent-list">
          {records.map((record) => (
            <li
              key={record.recentId}
              className={`recent-card recent-${record.availability}`}
              data-ui-surface
            >
              <div>
                <h3>{record.displayName}</h3>
                <p>
                  <Badge>{availabilityLabel(record)}</Badge>
                </p>
              </div>
              <div className="card-actions">
                {record.availability === 'available' ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onOpen(record)}
                    disabled={disabled}
                  >
                    Open
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onRelink(record)}
                    disabled={disabled}
                  >
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
