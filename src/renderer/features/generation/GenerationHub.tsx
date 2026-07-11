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
  assistantMessages: AssistantMessage[];
  patch: WritingPatchRecord | null;
};

type AssistantMessage = {
  startSequence: number;
  endSequence?: number;
  text: string;
  stopReason?: string;
  hasToolCalls?: boolean;
};

type TimelineItem = {
  sequence: number;
  key: string;
  kind: 'agent' | 'tool' | 'background' | 'result' | 'system';
  label: string;
  detail?: string;
  text?: string;
  tone: 'active' | 'complete' | 'error';
};

const MAX_ASSISTANT_MESSAGES = 12;
const MAX_ASSISTANT_MESSAGE_CHARS = 40_000;
const MAX_SEMANTIC_EVENTS = 120;

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
  const [pendingPatchId, setPendingPatchId] = useState<string | null>(null);
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
    setPendingPatchId(patch.id);
    try {
      const riskLevel = patch.patch.validation?.riskLevel ?? patch.riskLevel;
      if (riskLevel === 'high' && !window.confirm('This suggestion changes citations or numbers. Apply it?')) {
        return;
      }
      onState(await getApi().acceptWritingPatch({ patchId: patch.id, confirmHighRisk: riskLevel === 'high' }));
      await refreshRunPatch(patch.id);
      onStatus('Pi proposal applied.');
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setPendingPatchId((current) => current === patch.id ? null : current);
    }
  }

  async function saveCopy(patch: WritingPatchRecord) {
    setPendingPatchId(patch.id);
    try {
      onState(await getApi().saveWritingPatchAsCandidate(patch.id));
      await refreshRunPatch(patch.id);
      onStatus('Pi proposal saved as a separate draft.');
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setPendingPatchId((current) => current === patch.id ? null : current);
    }
  }

  async function reject(patch: WritingPatchRecord) {
    setPendingPatchId(patch.id);
    try {
      await getApi().rejectWritingPatch(patch.id);
      await refreshRunPatch(patch.id);
      onStatus('Pi proposal dismissed.');
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setPendingPatchId((current) => current === patch.id ? null : current);
    }
  }

  async function refreshRunPatch(patchId: string) {
    const refreshedPatch = await getApi().getWritingPatch(patchId);
    if (!refreshedPatch) {
      return;
    }
    setRuns((current) => current.map((run) => run.patch?.id === patchId ? { ...run, patch: refreshedPatch } : run));
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
        {runs.map((run) => <PiRunLog
          key={run.runId}
          run={run}
          onCancel={() => void cancel(run.runId)}
          onDismiss={() => setRuns((current) => current.filter((candidate) => candidate.runId !== run.runId))}
          onApply={run.patch ? () => void apply(run.patch!) : undefined}
          onSaveCopy={run.patch ? () => void saveCopy(run.patch!) : undefined}
          onReject={run.patch ? () => void reject(run.patch!) : undefined}
          actionPending={pendingPatchId === run.patch?.id}
        />)}
      </div> : null}
    </section>
  );
}

function PiRunLog({
  run,
  onCancel,
  onDismiss,
  onApply,
  onSaveCopy,
  onReject,
  actionPending
}: {
  run: HubRun;
  onCancel: () => void;
  onDismiss: () => void;
  onApply?: () => void;
  onSaveCopy?: () => void;
  onReject?: () => void;
  actionPending: boolean;
}) {
  const failure = latestFailure(run.events);
  const proposalPreview = patchText(run.patch);
  const sourceCount = run.events.reduce((count, event) => count + (numberData(event, 'sourceCount') ?? 0), 0);
  const activeTool = activeToolName(run.events);
  const running = run.status === 'running';
  const timeline = buildTimeline(run);
  const archivedProposal = archivedProposalStatus(run.patch);
  const tone = failure || run.status === 'failed' || run.status === 'timed_out' || run.status === 'budget_exhausted' ? 'error' : running ? 'active' : 'ready';
  const { title, detail } = runPresentation(run, failure, activeTool, sourceCount);

  return (
    <article className="generation-hub-run" data-tone={tone}>
      <header className="generation-hub-run-header">
        <div>
          <span className="generation-hub-run-section">Section {run.sectionId}</span>
          <p>{statusLabel(run.status)}</p>
        </div>
        {running ? <Spinner /> : tone === 'error' ? <CircleAlert /> : <Check />}
      </header>
      <div className="generation-hub-run-summary">
        <div className="generation-hub-run-summary-title">
          {sourceCount > 0 ? <Search /> : run.patch ? <Check /> : <Sparkles />}
          <span>{title}</span>
          {running ? <Spinner /> : null}
        </div>
        <p>{detail}</p>
      </div>
      <ol className="generation-hub-timeline" aria-label="Pi run activity">
        {timeline.map((item) => <li key={item.key} className="generation-hub-timeline-row" data-kind={item.kind} data-tone={item.tone}>
          <span className="generation-hub-timeline-marker" aria-hidden="true" />
          <span className="generation-hub-timeline-kind">{activityKindLabel(item.kind)}</span>
          <div className="generation-hub-timeline-copy">
            <strong>{item.label}</strong>
            {item.detail ? <span>{item.detail}</span> : null}
            {item.text ? <pre className="generation-hub-assistant-output" aria-live="polite">{item.text}</pre> : null}
          </div>
        </li>)}
      </ol>
      {proposalPreview ? <section className="generation-hub-proposal-preview" aria-label={archivedProposal ? 'Archived proposal preview' : 'Reviewable proposal preview'}>
        <strong>{archivedProposal ? 'Archived proposal' : 'Reviewable proposal'}</strong>
        <pre>{proposalPreview}</pre>
      </section> : null}
      <div className="generation-hub-actions">
        {running ? <Button variant="outline" size="sm" onClick={onCancel}><X /> Cancel</Button> : null}
        {run.patch && !archivedProposal ? <>
          {canApply(run.patch) ? <Button size="sm" onClick={onApply} disabled={actionPending}>Apply</Button> : null}
          <Button variant="outline" size="sm" onClick={onSaveCopy} disabled={actionPending}>Save copy</Button>
          <Button variant="outline" size="sm" onClick={onReject} disabled={actionPending}><X /> Dismiss proposal</Button>
        </> : null}
        {archivedProposal ? <span className="generation-hub-archive-status" role="status">Archived · {archivedProposal}</span> : null}
        {!running ? <Button variant="outline" size="sm" onClick={onDismiss}>Dismiss activity</Button> : null}
      </div>
    </article>
  );
}

function mergeLiveRuns(current: HubRun[], liveRuns: Array<{ runId: string; sectionId: string }>): HubRun[] {
  const next = current.slice();
  liveRuns.forEach((run) => {
    if (!next.some((candidate) => candidate.runId === run.runId)) {
      next.unshift({ runId: run.runId, sectionId: run.sectionId, status: 'running', events: [], assistantMessages: [], patch: null });
    }
  });
  return next;
}

function applyPiEvent(current: HubRun[], event: PiRunEvent): HubRun[] {
  const existing = current.find((run) => run.runId === event.runId);
  const sectionId = stringData(event, 'sectionId') ?? existing?.sectionId ?? 'active section';
  const status = event.type === 'run_terminal' ? statusData(event) : existing?.status ?? 'running';
  const nextRun: HubRun = {
    runId: event.runId,
    sectionId,
    status,
    events: mergeSemanticEvent(existing?.events ?? [], event),
    assistantMessages: mergeAssistantMessage(existing?.assistantMessages ?? [], event),
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

function mergeSemanticEvent(events: PiRunEvent[], event: PiRunEvent): PiRunEvent[] {
  if (event.type === 'message_delta' || events.some((candidate) => candidate.sequence === event.sequence)) {
    return events;
  }
  return [...events, event]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-MAX_SEMANTIC_EVENTS);
}

function mergeAssistantMessage(messages: AssistantMessage[], event: PiRunEvent): AssistantMessage[] {
  if (!isAssistantEvent(event)) {
    return messages;
  }
  if (event.type === 'message_start') {
    if (messages.some((message) => message.startSequence === event.sequence)) {
      return messages;
    }
    return [...messages, { startSequence: event.sequence, text: '' }]
      .sort((left, right) => left.startSequence - right.startSequence)
      .slice(-MAX_ASSISTANT_MESSAGES);
  }
  const activeIndex = findActiveAssistantMessage(messages);
  if (event.type === 'message_delta') {
    const text = stringData(event, 'text') ?? '';
    if (!text || activeIndex < 0) {
      return messages;
    }
    return messages.map((message, index) => index === activeIndex
      ? { ...message, text: `${message.text}${text}`.slice(0, MAX_ASSISTANT_MESSAGE_CHARS) }
      : message);
  }
  if (event.type === 'message_end' && activeIndex >= 0) {
    return messages.map((message, index) => index === activeIndex
      ? {
          ...message,
          endSequence: event.sequence,
          stopReason: stringData(event, 'stopReason') ?? undefined,
          hasToolCalls: booleanData(event, 'hasToolCalls') ?? false
        }
      : message);
  }
  return messages;
}

function findActiveAssistantMessage(messages: AssistantMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.endSequence === undefined) {
      return index;
    }
  }
  return -1;
}

function isAssistantEvent(event: PiRunEvent): boolean {
  return (event.type === 'message_start' || event.type === 'message_end' || event.type === 'message_delta')
    && stringData(event, 'role') === 'assistant';
}

function latestFailure(events: PiRunEvent[]): { category: string; cause: string; retryable: boolean } | null {
  for (const event of [...events].reverse()) {
    const failure = event.data?.failure;
    if (failure && typeof failure === 'object' && typeof (failure as { cause?: unknown }).cause === 'string') {
      const candidate = failure as { category?: unknown; cause: string; retryable?: unknown };
      return {
        category: typeof candidate.category === 'string' ? candidate.category : 'agent_failure',
        cause: candidate.cause,
        retryable: candidate.retryable === true
      };
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
  return patch.patch.kind !== 'create_content_candidate' && patch.patch.validation?.ok !== false && !archivedProposalStatus(patch);
}

function archivedProposalStatus(patch: WritingPatchRecord | null): string | null {
  if (!patch) {
    return null;
  }
  switch (patch.patch.status) {
    case 'applied':
      return 'Applied';
    case 'saved_as_candidate':
      return 'Saved copy';
    case 'rejected':
      return 'Dismissed';
    default:
      return null;
  }
}

function buildTimeline(run: HubRun): TimelineItem[] {
  const semanticItems = run.events
    .filter(isTimelineEvent)
    .map((event) => ({
      sequence: event.sequence,
      key: `event-${event.sequence}`,
      ...eventPresentation(event)
    }));
  const assistantItems = run.assistantMessages
    .filter((message) => message.endSequence !== undefined && !message.hasToolCalls && message.stopReason !== 'error' && message.stopReason !== 'aborted' && Boolean(message.text.trim()))
    .map((message) => assistantMessagePresentation(message));
  return [...semanticItems, ...assistantItems].sort((left, right) => left.sequence - right.sequence);
}

function eventPresentation(event: PiRunEvent): Omit<TimelineItem, 'sequence' | 'key'> {
  if (event.type === 'run_started') {
    return { kind: 'system', label: 'Pi run started', detail: 'The task is scoped to this section and uses bounded tools.', tone: 'active' };
  }
  if (event.type === 'agent_start') {
    return { kind: 'agent', label: 'Agent started', detail: 'Preparing the first bounded turn.', tone: 'active' };
  }
  if (event.type === 'agent_end') {
    return { kind: 'agent', label: 'Agent finished', detail: 'No more agent turns will be started for this run.', tone: 'complete' };
  }
  if (event.type === 'turn_start') {
    return { kind: 'agent', label: 'Agent turn started', detail: 'Assessing the next safe action.', tone: 'active' };
  }
  if (event.type === 'turn_end') {
    return { kind: 'agent', label: 'Agent turn completed', tone: 'complete' };
  }
  if (event.type === 'message_start') {
    return { kind: 'agent', label: 'Preparing the next action', detail: 'The UI shows tool and lifecycle progress, not private reasoning.', tone: 'active' };
  }
  if (event.type === 'message_end') {
    const hasToolCalls = booleanData(event, 'hasToolCalls');
    const stopReason = stringData(event, 'stopReason');
    if (hasToolCalls) {
      return { kind: 'agent', label: 'Selected a writing tool', detail: 'The next activity row identifies the allowlisted tool.', tone: 'complete' };
    }
    if (stopReason === 'error' || stopReason === 'aborted') {
      return { kind: 'result', label: 'Assistant response stopped', tone: 'error' };
    }
    return { kind: 'result', label: 'Assistant response completed', tone: 'complete' };
  }
  if (event.type === 'tool_execution_start') {
    const toolName = stringData(event, 'toolName');
    return {
      kind: isBackgroundTool(toolName) ? 'background' : 'tool',
      label: `Started ${toolLabel(toolName)}`,
      detail: isBackgroundTool(toolName) ? 'Running outside the Electron main loop so the editor remains responsive.' : undefined,
      tone: 'active'
    };
  }
  if (event.type === 'tool_execution_end') {
    const refs = Array.isArray(event.data?.publicRefs)
      ? event.data.publicRefs.filter((value): value is string => typeof value === 'string').join(', ')
      : '';
    const failure = event.data?.failure;
    const cause = failure && typeof failure === 'object' && typeof (failure as { cause?: unknown }).cause === 'string'
      ? (failure as { cause: string }).cause
      : null;
    const toolName = stringData(event, 'toolName');
    const kind = isBackgroundTool(toolName) ? 'background' : 'tool';
    return stringData(event, 'status') === 'error'
      ? { kind, label: `${toolLabel(toolName)} reported an error`, detail: cause ?? undefined, tone: 'error' }
      : { kind, label: `${toolLabel(toolName)} completed`, detail: refs ? `Evidence: ${refs}` : undefined, tone: 'complete' };
  }
  if (event.type === 'run_terminal') {
    return { kind: 'result', label: `Run ${statusLabel(statusData(event)).toLowerCase()}`, tone: statusData(event) === 'succeeded' ? 'complete' : 'error' };
  }
  return { kind: 'system', label: event.type.replace(/_/g, ' '), tone: 'complete' };
}

function isTimelineEvent(event: PiRunEvent): boolean {
  return event.type !== 'message_delta';
}

function assistantMessagePresentation(message: AssistantMessage): TimelineItem {
  return {
    sequence: message.endSequence ?? message.startSequence,
    key: `assistant-${message.startSequence}`,
    kind: 'result',
    label: 'Assistant response',
    detail: 'User-facing response',
    text: message.text,
    tone: 'complete'
  };
}

function runPresentation(
  run: HubRun,
  failure: ReturnType<typeof latestFailure>,
  activeTool: string | null,
  sourceCount: number
): { title: string; detail: string } {
  if (run.status === 'timed_out') {
    return {
      title: run.patch ? 'Run timed out after creating a proposal' : 'Run timed out before a proposal was ready',
      detail: 'The 120-second run limit ended this work. No document content was changed.'
    };
  }
  if (run.status === 'budget_exhausted') {
    return {
      title: 'Run reached its turn budget',
      detail: 'The bounded agent run stopped before it could take another turn. No document content was changed.'
    };
  }
  if (run.status === 'canceled') {
    return { title: 'Run canceled', detail: 'The run stopped safely. No document content was changed.' };
  }
  if (run.status === 'failed') {
    return { title: 'Pi run needs attention', detail: failure?.cause ?? 'The run stopped before a proposal was ready. No document content was changed.' };
  }
  if (failure) {
    return { title: 'Run completed with an issue', detail: failure.cause };
  }
  const archivedProposal = archivedProposalStatus(run.patch);
  if (archivedProposal) {
    return { title: 'Proposal archived', detail: `Author decision recorded: ${archivedProposal.toLowerCase()}.` };
  }
  if (run.patch) {
    return { title: 'Proposal ready for review', detail: 'Review the patch before applying, saving, or dismissing it.' };
  }
  if (activeTool === 'source') {
    return { title: 'Generating embedding and searching sources', detail: 'RAG is running in an isolated worker; the editor and Cancel action remain available.' };
  }
  if (sourceCount > 0) {
    return { title: 'Working with indexed evidence', detail: `${sourceCount} source${sourceCount === 1 ? '' : 's'} returned to the agent.` };
  }
  return run.status === 'running'
    ? { title: 'Pi agent is working', detail: 'Activity appears below in the order it executes.' }
    : { title: statusLabel(run.status), detail: 'The live run is no longer retained after this window closes.' };
}

function toolLabel(toolName: string | null): string {
  switch (toolName) {
    case 'get_article_context': return 'article context read';
    case 'read_section_snapshot': return 'section snapshot read';
    case 'source': return 'indexed-source search';
    case 'resolve_citation': return 'citation resolution';
    case 'inspect_citation_coverage': return 'citation coverage inspection';
    case 'propose_patch': return 'reviewable patch proposal';
    default: return 'writing tool';
  }
}

function isBackgroundTool(toolName: string | null): boolean {
  return toolName === 'source';
}

function activityKindLabel(kind: TimelineItem['kind']): string {
  return kind === 'agent'
    ? 'AGENT'
    : kind === 'tool'
      ? 'TOOL'
      : kind === 'background'
        ? 'BACKGROUND'
        : kind === 'result'
          ? 'RESULT'
          : 'SYSTEM';
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

function booleanData(event: PiRunEvent, key: string): boolean | null {
  return typeof event.data?.[key] === 'boolean' ? event.data[key] as boolean : null;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
