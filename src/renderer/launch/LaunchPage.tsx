import { useEffect, useState } from 'react';
import type { WriteLLMIpc } from '../../shared/ipc';
import type { ProjectSnapshot, RecentProjectSummary } from '../../shared/project';
import { initialLaunchState, loadLaunchState, type LaunchState } from './launchState';

type LaunchPageProps = { api: WriteLLMIpc };

export function LaunchPage({ api }: LaunchPageProps) {
  const [state, setState] = useState<LaunchState>(initialLaunchState);
  const [displayName, setDisplayName] = useState('');

  const refresh = async () => setState(await loadLaunchState(api));
  useEffect(() => { void refresh(); }, []);

  const showWorkspace = (project: ProjectSnapshot) => setState((current) => ({ status: 'workspace', recentProjects: current.recentProjects, project }));

  const create = async () => {
    setState((current) => ({ status: 'working', recentProjects: current.recentProjects, message: 'Choose a parent folder…' }));
    const result = await api.createProject({ displayName });
    if (result.status === 'created') { showWorkspace(result.project); setDisplayName(''); return; }
    if (result.status === 'canceled') { await refresh(); return; }
    if (result.status === 'error') setState((current) => ({ status: 'error', recentProjects: current.recentProjects, message: result.error.message }));
  };

  const open = async () => {
    setState((current) => ({ status: 'working', recentProjects: current.recentProjects, message: 'Choose a project folder…' }));
    const result = await api.openProjectFromDialog();
    if (result.status === 'opened') { showWorkspace(result.project); return; }
    if (result.status === 'canceled') { await refresh(); return; }
    if (result.status === 'error') setState((current) => ({ status: 'error', recentProjects: current.recentProjects, message: result.error.message }));
  };

  const openRecent = async (record: RecentProjectSummary) => {
    setState((current) => ({ status: 'working', recentProjects: current.recentProjects, message: 'Opening project…' }));
    const result = await api.openRecentProject({ recentId: record.recentId });
    if (result.status === 'opened') { showWorkspace(result.project); return; }
    setState((current) => ({ status: 'error', recentProjects: current.recentProjects, message: result.status === 'error' ? result.error.message : 'Opening was canceled.' }));
  };

  const relink = async (record: RecentProjectSummary) => {
    setState((current) => ({ status: 'working', recentProjects: current.recentProjects, message: 'Choose the moved project folder…' }));
    const result = await api.relinkRecentProject({ recentId: record.recentId });
    if (result.status === 'opened') { showWorkspace(result.project); return; }
    if (result.status === 'canceled') { await refresh(); return; }
    if (result.status === 'error') setState((current) => ({ status: 'error', recentProjects: current.recentProjects, message: result.error.message }));
  };

  const remove = async (record: RecentProjectSummary) => {
    const result = await api.removeRecentProject({ recentId: record.recentId });
    if (result.status === 'removed') { await refresh(); return; }
    setState((current) => ({ status: 'error', recentProjects: current.recentProjects, message: result.error.message }));
  };

  if (state.status === 'workspace') {
    return <main className="launch-shell"><section className="workspace-panel" aria-labelledby="workspace-title"><p className="eyebrow">Empty workspace</p><h1 id="workspace-title">{state.project.displayName}</h1><p>This project is ready for the next writing feature.</p></section></main>;
  }

  const busy = state.status === 'loading' || state.status === 'working';
  return (
    <main className="launch-shell">
      <section className="launch-card" aria-labelledby="app-title">
        <p className="eyebrow">WriteLLM v2</p>
        <h1 id="app-title">Start a project</h1>
        <p className="summary">Create a portable project or open one you already own.</p>
        <div className="launch-actions">
          <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <label htmlFor="project-name">New project name</label>
            <div className="create-row">
              <input id="project-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy} autoComplete="off" />
              <button type="submit" disabled={busy || displayName.length === 0}>New project</button>
            </div>
          </form>
          <button type="button" className="secondary-button" onClick={() => void open()} disabled={busy}>Open project</button>
        </div>
        <div className="status-region" aria-live="polite">
          {state.status === 'loading' ? <p>Loading recent projects…</p> : null}
          {state.status === 'working' ? <p>{state.message}</p> : null}
          {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
          {state.status === 'ready' && state.warning ? <p role="status">{state.warning}</p> : null}
        </div>
        <RecentProjects records={state.recentProjects} disabled={busy} onOpen={openRecent} onRelink={relink} onRemove={remove} />
      </section>
    </main>
  );
}

function RecentProjects({ records, disabled, onOpen, onRelink, onRemove }: { records: RecentProjectSummary[]; disabled: boolean; onOpen: (record: RecentProjectSummary) => void; onRelink: (record: RecentProjectSummary) => void; onRemove: (record: RecentProjectSummary) => void }) {
  return <section className="recent-section" aria-labelledby="recent-title">
    <div className="section-heading"><h2 id="recent-title">Recent projects</h2><span>{records.length}/5</span></div>
    {records.length === 0 ? <p className="empty-state">No recent projects yet.</p> : <ul className="recent-list">{records.map((record) => <li key={record.recentId} className={`recent-card recent-${record.availability}`}>
      <div><h3>{record.displayName}</h3><p>{availabilityLabel(record)}</p></div>
      <div className="card-actions">
        {record.availability === 'available' ? <button type="button" onClick={() => onOpen(record)} disabled={disabled}>Open</button> : <button type="button" onClick={() => onRelink(record)} disabled={disabled}>Relink</button>}
        <button type="button" className="text-button" onClick={() => onRemove(record)} disabled={disabled}>Remove recent</button>
      </div>
    </li>)}</ul>}
  </section>;
}

function availabilityLabel(record: RecentProjectSummary): string {
  if (record.availability === 'available') return 'Available';
  if (record.availability === 'missing') return 'Project folder is missing';
  if (record.availability === 'inaccessible') return 'Project folder cannot be read';
  return record.diagnosticCode === 'PROJECT_UNSUPPORTED_VERSION' ? 'Unsupported project format' : 'Project structure is invalid';
}
