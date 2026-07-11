import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Search, Sparkles, X } from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import type {
  FocusedWorkspaceState,
  PiRunEvent,
  PiRunStatus,
  WritingPatchRecord
} from '../../../shared/types';

type HubRun = {
  runId: string;
  sectionId: string;
  status: PiRunStatus;
  events: PiRunEvent[];
  streamedDraft: string;
  patch: WritingPatchRecord | null;
};

const MAX_STREAMED_DRAFT_CHARS = 40_000;

export function GenerationHub({
  onState,
  onStatus,
  onError
}: {
  onState: (state: FocusedWorkspaceState) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [runs, setRuns] = useState<HubRun[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const hubRef = useRef<HTMLElement>(null);
  const pendingEventsRef = useRef<PiRunEvent[]>([]);
  const eventFrameRef = useRef<number | null>(null);

  useEffect(() => {
    void getApi().listLivePiRuns().then((liveRuns) => {
      setRuns((current) => mergeLiveRuns(current, liveRuns));
    }).catch((caught: unknown) => onError(errorMessage(caught)));
    const unsubscribe = getApi().onPiRunEvent((event) => {
      pendingEventsRef.current.push(event);
      if (eventFrameRef.current === null) {
        eventFrameRef.current = window.requestAnimationFrame(() => {
          eventFrameRef.current = null;
          const pending = pendingEventsRef.current;
          pendingEventsRef.current = [];
          setRuns((current) => pending.reduce(applyPiEvent, current));
        });
      }
      if (event.type === 'tool_execution_end') {
        const proposalId = stringData(event, 'proposalId');
        if (proposalId) {
          void getApi().getWritingPatch(proposalId).then((patch) => {
            if (patch) {
              setRuns((current) => current.map((run) => run.runId === event.runId ? { ...run, patch } : run));
            }
          }).catch((caught: unknown) => onError(errorMessage(caught)));
        }
      }
    });
    return () => {
      unsubscribe();
      if (eventFrameRef.current !== null) {
        window.cancelAnimationFrame(eventFrameRef.current);
        eventFrameRef.current = null;
      }
      pendingEventsRef.current = [];
    };
  }, [onError]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const hub = hubRef.current;
    if (!hub) {
      root.style.removeProperty('--generation-hub-offset');
      return;
    }
    const updateOffset = () => root.style.setProperty('--generation-hub-offset', `${Math.ceil(hub.getBoundingClientRect().height + 16)}px`);
    updateOffset();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOffset);
    observer?.observe(hub);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--generation-hub-offset');
    };
  }, [collapsed, runs.length]);

  async function cancel(runId: string) {
    try {
      await getApi().cancelPiRun(runId);
      onStatus('Pi agent run canceled.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function apply(patch: WritingPatchRecord) {
    try {
      const riskLevel = patch.patch.validation?.riskLevel ?? patch.riskLevel;
      if (riskLevel === 'high' && !window.confirm('This suggestion changes citations or numbers. Apply it?')) {
        return;
      }
      onState(await getApi().acceptWritingPatch({ patchId: patch.id, confirmHighRisk: riskLevel === 'high' }));
      onStatus('Pi proposal applied.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function saveCopy(patch: WritingPatchRecord) {
    try {
      onState(await getApi().saveWritingPatchAsCandidate(patch.id));
      onStatus('Pi proposal saved as a separate draft.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function reject(patch: WritingPatchRecord) {
    try {
      await getApi().rejectWritingPatch(patch.id);
      setRuns((current) => current.map((run) => run.patch?.id === patch.id ? { ...run, patch: null } : run));
      onStatus('Pi proposal dismissed.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  if (runs.length === 0) {
    return null;
  }

  const running = runs.filter((run) => run.status === 'running').length;
  const summary = running > 0 ? `${running} working · ${runs.length} live in this window` : `${runs.length} recent Pi run${runs.length === 1 ? '' : 's'}`;

  return (
    <section ref={hubRef} className="generation-hub" data-state={collapsed ? 'collapsed' : 'expanded'} aria-label="Pi assistant hub">
      <button
        type="button"
        className="generation-hub-header"
        aria-controls="generation-hub-runs"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span className="generation-hub-header-copy">
          <span className="generation-hub-header-title">Pi assistant</span>
          <span className="generation-hub-header-detail">{summary}</span>
        </span>
        <span className="generation-hub-header-toggle">
          <span>{collapsed ? 'Show activity' : 'Hide activity'}</span>
          <ChevronDown className={collapsed ? undefined : 'is-expanded'} aria-hidden="true" />
        </span>
      </button>
      {!collapsed ? <div id="generation-hub-runs" className="generation-hub-runs">
        {runs.map((run) => <PiRunCard
          key={run.runId}
          run={run}
          onCancel={() => void cancel(run.runId)}
          onDismiss={() => setRuns((current) => current.filter((candidate) => candidate.runId !== run.runId))}
          onApply={run.patch ? () => void apply(run.patch!) : undefined}
          onSaveCopy={run.patch ? () => void saveCopy(run.patch!) : undefined}
          onReject={run.patch ? () => void reject(run.patch!) : undefined}
        />)}
      </div> : null}
    </section>
  );
}

function PiRunCard({
  run,
  onCancel,
  onDismiss,
  onApply,
  onSaveCopy,
  onReject
}: {
  run: HubRun;
  onCancel: () => void;
  onDismiss: () => void;
  onApply?: () => void;
  onSaveCopy?: () => void;
  onReject?: () => void;
}) {
  const failure = latestFailure(run.events);
  const draft = patchText(run.patch) || run.streamedDraft;
  const sourceCount = run.events.reduce((count, event) => count + (numberData(event, 'sourceCount') ?? 0), 0);
  const activeTool = activeToolName(run.events);
  const running = run.status === 'running';
  const tone = failure || run.status === 'failed' || run.status === 'timed_out' || run.status === 'budget_exhausted' ? 'error' : running ? 'active' : 'ready';
  const title = failure
    ? 'Pi run needs attention'
    : run.patch
      ? 'Proposal ready for review'
      : running
        ? activeTool === 'source' ? 'Generating embedding and searching sources' : sourceCount > 0 ? 'Working with indexed evidence' : 'Pi agent is working'
        : statusLabel(run.status);
  const detail = failure?.cause ?? (activeTool === 'source'
    ? 'RAG is running in an isolated worker; the editor and Cancel action remain available.'
    : sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} returned to the agent.` : running ? 'Events are streamed from the main-process Pi runtime.' : 'The live run is no longer retained after this window closes.');

  return (
    <article className="generation-hub-run">
      <div className="generation-hub-run-title">
        <div>
          <span>Section {run.sectionId}</span>
          <p>{statusLabel(run.status)}</p>
        </div>
        {running ? <Spinner /> : tone === 'error' ? <CircleAlert /> : <Check />}
      </div>
      <section className="generation-hub-runtime" data-tone={tone}>
        <div className="generation-hub-runtime-title">
          {sourceCount > 0 ? <Search /> : run.patch ? <Check /> : <Sparkles />}
          <span>{title}</span>
          {running ? <Spinner /> : null}
        </div>
        <p>{detail}</p>
        {draft ? <pre className="generation-hub-draft">{draft}</pre> : null}
        <ol className="generation-detail-list" aria-label="Pi run activity">
          {run.events.filter(isTimelineEvent).slice(-8).map((event) => <li key={event.sequence}>{eventLabel(event)}</li>)}
        </ol>
      </section>
      <div className="generation-hub-actions">
        {running ? <Button variant="outline" size="sm" onClick={onCancel}><X /> Cancel</Button> : null}
        {run.patch ? <>
          {canApply(run.patch) ? <Button size="sm" onClick={onApply}>Apply</Button> : null}
          <Button variant="outline" size="sm" onClick={onSaveCopy}>Save copy</Button>
          <Button variant="outline" size="sm" onClick={onReject}><X /> Dismiss proposal</Button>
        </> : null}
        {!running ? <Button variant="outline" size="sm" onClick={onDismiss}>Dismiss activity</Button> : null}
      </div>
    </article>
  );
}

function mergeLiveRuns(current: HubRun[], liveRuns: Array<{ runId: string; sectionId: string }>): HubRun[] {
  const next = current.slice();
  liveRuns.forEach((run) => {
    if (!next.some((candidate) => candidate.runId === run.runId)) {
      next.unshift({ runId: run.runId, sectionId: run.sectionId, status: 'running', events: [], streamedDraft: '', patch: null });
    }
  });
  return next;
}

function applyPiEvent(current: HubRun[], event: PiRunEvent): HubRun[] {
  const existing = current.find((run) => run.runId === event.runId);
  const sectionId = stringData(event, 'sectionId') ?? existing?.sectionId ?? 'active section';
  const status = event.type === 'run_terminal' ? statusData(event) : existing?.status ?? 'running';
  const delta = event.type === 'message_delta' ? stringData(event, 'text') ?? '' : '';
  const streamedDraft = `${existing?.streamedDraft ?? ''}${delta}`.slice(-MAX_STREAMED_DRAFT_CHARS);
  const events = event.type === 'message_delta'
    ? existing?.events ?? []
    : [...(existing?.events ?? []), event].slice(-60);
  const nextRun: HubRun = {
    runId: event.runId,
    sectionId,
    status,
    events,
    streamedDraft,
    patch: existing?.patch ?? null
  };
  return [nextRun, ...current.filter((run) => run.runId !== event.runId)];
}

function statusData(event: PiRunEvent): PiRunStatus {
  const value = stringData(event, 'status');
  return value === 'succeeded' || value === 'failed' || value === 'canceled' || value === 'timed_out' || value === 'budget_exhausted'
    ? value
    : 'failed';
}

function latestFailure(events: PiRunEvent[]): { cause: string } | null {
  for (const event of [...events].reverse()) {
    const failure = event.data?.failure;
    if (failure && typeof failure === 'object' && typeof (failure as { cause?: unknown }).cause === 'string') {
      return { cause: (failure as { cause: string }).cause };
    }
  }
  return null;
}

function patchText(patch: WritingPatchRecord | null): string {
  if (!patch) return '';
  const operation = patch.patch.operation;
  return operation.type === 'replace' ? operation.after : operation.type === 'insert' ? operation.text : operation.content;
}

function canApply(patch: WritingPatchRecord): boolean {
  return patch.patch.kind !== 'create_content_candidate' && patch.patch.validation?.ok !== false && !['blocked', 'applied', 'rejected', 'saved_as_candidate'].includes(patch.patch.status);
}

function eventLabel(event: PiRunEvent): string {
  if (event.type === 'tool_execution_start') return `Started ${stringData(event, 'toolName') ?? 'tool'}.`;
  if (event.type === 'tool_execution_end') {
    const refs = Array.isArray(event.data?.publicRefs)
      ? event.data.publicRefs.filter((value): value is string => typeof value === 'string').join(', ')
      : '';
    return `${stringData(event, 'toolName') ?? 'Tool'} ${stringData(event, 'status') === 'error' ? 'reported an error.' : refs ? `completed: ${refs}.` : 'completed.'}`;
  }
  if (event.type === 'turn_start') return 'Started an agent turn.';
  if (event.type === 'turn_end') return 'Completed an agent turn.';
  if (event.type === 'run_terminal') return `Run ${statusData(event).replace(/_/g, ' ')}.`;
  return event.type.replace(/_/g, ' ');
}

function isTimelineEvent(event: PiRunEvent): boolean {
  return event.type === 'tool_execution_start'
    || event.type === 'tool_execution_end'
    || event.type === 'turn_start'
    || event.type === 'turn_end'
    || event.type === 'run_terminal';
}

function activeToolName(events: PiRunEvent[]): string | null {
  const completed = new Set(events
    .filter((event) => event.type === 'tool_execution_end')
    .map((event) => stringData(event, 'toolCallId'))
    .filter((value): value is string => Boolean(value)));
  for (const event of [...events].reverse()) {
    if (event.type === 'tool_execution_start') {
      const toolCallId = stringData(event, 'toolCallId');
      if (!toolCallId || !completed.has(toolCallId)) {
        return stringData(event, 'toolName');
      }
    }
  }
  return null;
}

function statusLabel(status: PiRunStatus): string {
  return status === 'running' ? 'Working' : status === 'timed_out' ? 'Timed out' : status === 'budget_exhausted' ? 'Budget exhausted' : status === 'canceled' ? 'Canceled' : status === 'failed' ? 'Failed' : 'Completed';
}

function stringData(event: PiRunEvent, key: string): string | null {
  return typeof event.data?.[key] === 'string' ? event.data[key] as string : null;
}

function numberData(event: PiRunEvent, key: string): number | null {
  return typeof event.data?.[key] === 'number' ? event.data[key] as number : null;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
