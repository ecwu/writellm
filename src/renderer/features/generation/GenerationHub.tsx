import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, CircleAlert, FileText, Search, Sparkles, Trash2, X } from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import type {
  FocusedWorkspaceState,
  GenerationRoundRecord,
  GenerationSessionRecord,
  KnowledgeRetrievalTraceEvent,
  WritingPatchRecord
} from '../../../shared/types';

type HubRun = {
  round: GenerationRoundRecord;
  session: GenerationSessionRecord;
  patch: WritingPatchRecord | null;
  streamText: string;
  liveTrace: KnowledgeRetrievalTraceEvent[];
};

type RuntimeStage = {
  icon: ReactNode;
  title: string;
  detail: string;
  content?: string;
  tone: 'active' | 'ready' | 'error';
};

const visibleStatuses = new Set<GenerationRoundRecord['status']>([
  'retrieving',
  'pending',
  'processing',
  'done',
  'error',
  'patch_created'
]);

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

  const refresh = useCallback(async () => {
    const sessions = await getApi().listGenerationSessions();
    const roundGroups = await Promise.all(sessions.map((session) => getApi().listGenerationRounds(session.id)));
    const loaded = await Promise.all(roundGroups.flatMap((rounds, groupIndex) =>
      rounds.map(async (round) => ({
        round,
        session: sessions[groupIndex]!,
        patch: round.patchId ? await getApi().getWritingPatch(round.patchId) : null
      }))
    ));
    const next = loaded
      .filter(({ round }) => visibleStatuses.has(round.status))
      .sort(compareHubRuns);
    setRuns((current) => next.map((entry) => {
      const previous = current.find((run) => run.round.id === entry.round.id);
      return {
        ...entry,
        streamText: previous?.streamText ?? '',
        liveTrace: previous?.liveTrace ?? entry.round.retrievalTrace
      };
    }));
  }, []);

  useEffect(() => {
    void refresh().catch((caught: unknown) => onError(errorMessage(caught)));
    return getApi().onGenerationEvent((event) => {
      if (event.type === 'stream_delta') {
        setRuns((current) => current.map((run) =>
          run.round.id === event.roundId ? { ...run, streamText: run.streamText + event.text } : run
        ));
        return;
      }
      if (event.type === 'retrieval_trace') {
        setRuns((current) => current.map((run) =>
          run.round.id === event.roundId ? { ...run, liveTrace: [...run.liveTrace, event.event] } : run
        ));
        return;
      }
      void refresh().catch((caught: unknown) => onError(errorMessage(caught)));
    });
  }, [onError, refresh]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const hub = hubRef.current;
    if (!hub) {
      root.style.removeProperty('--generation-hub-offset');
      return;
    }

    const updateOffset = () => {
      root.style.setProperty('--generation-hub-offset', `${Math.ceil(hub.getBoundingClientRect().height + 16)}px`);
    };
    updateOffset();

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOffset);
    observer?.observe(hub);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--generation-hub-offset');
    };
  }, [collapsed, runs.length]);

  async function cancel(roundId: string) {
    try {
      await getApi().cancelGenerationTask(roundId);
      setRuns((current) => current.filter((run) => run.round.id !== roundId));
      await refresh();
      onStatus('Generation canceled.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function discard(roundId: string) {
    try {
      await getApi().discardGenerationTask(roundId);
      setRuns((current) => current.filter((run) => run.round.id !== roundId));
      await refresh();
      onStatus('Generation task deleted.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function retry(roundId: string) {
    try {
      await getApi().retryGenerationTask(roundId);
      await refresh();
      onStatus('Generation restarted.');
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
      await refresh();
      onStatus('Suggestion applied.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function saveCopy(patch: WritingPatchRecord) {
    try {
      onState(await getApi().saveWritingPatchAsCandidate(patch.id));
      await refresh();
      onStatus('Suggestion saved as a separate draft.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function reject(patch: WritingPatchRecord) {
    try {
      await getApi().rejectWritingPatch(patch.id);
      await refresh();
      onStatus('Suggestion dismissed.');
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  if (runs.length === 0) {
    return null;
  }

  const summary = summarizeHubRuns(runs);

  return (
    <section
      ref={hubRef}
      className="generation-hub"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      aria-label="Assistant generation hub"
    >
      <button
        type="button"
        className="generation-hub-header"
        aria-controls="generation-hub-runs"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand assistant hub' : 'Collapse assistant hub'}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span className="generation-hub-header-copy">
          <span className="generation-hub-header-title">Assistant hub</span>
          <span className="generation-hub-header-detail">{summary}</span>
        </span>
        <span className="generation-hub-header-toggle">
          <span>{collapsed ? 'Show tasks' : 'Hide tasks'}</span>
          <ChevronDown className={collapsed ? undefined : 'is-expanded'} aria-hidden="true" />
        </span>
      </button>
      {!collapsed ? (
        <div id="generation-hub-runs" className="generation-hub-runs">
          {runs.map((run) => (
            <GenerationRunCard
              key={run.round.id}
              run={run}
              onCancel={() => void cancel(run.round.id)}
              onDiscard={() => void discard(run.round.id)}
              onRetry={() => void retry(run.round.id)}
              onApply={run.patch ? () => void apply(run.patch!) : undefined}
              onSaveCopy={run.patch ? () => void saveCopy(run.patch!) : undefined}
              onReject={run.patch ? () => void reject(run.patch!) : undefined}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GenerationRunCard({
  run,
  onCancel,
  onDiscard,
  onRetry,
  onApply,
  onSaveCopy,
  onReject
}: {
  run: HubRun;
  onCancel: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onApply?: () => void;
  onSaveCopy?: () => void;
  onReject?: () => void;
}) {
  const running = isRunning(run.round.status);
  const trace = run.liveTrace.length > 0 ? run.liveTrace : run.round.retrievalTrace;
  const candidate = patchText(run.patch) || streamedCandidate(run.streamText) || run.streamText;
  const stage = currentRuntimeStage(run.round, trace, candidate);

  return (
    <article className="generation-hub-run">
      <div className="generation-hub-run-title">
        <div>
          <span>{run.session.title || 'Assistant suggestion'}</span>
          <p>{statusLabel(run.round.status)}</p>
        </div>
        {running ? <Spinner /> : run.round.status === 'error' ? <CircleAlert /> : <Check />}
      </div>
      <section className="generation-hub-runtime" data-tone={stage.tone}>
        <div className="generation-hub-runtime-title">
          {stage.icon}
          <span>{stage.title}</span>
          {stage.tone === 'active' ? <Spinner /> : null}
        </div>
        <p>{stage.detail}</p>
        {stage.content ? <pre className="generation-hub-draft">{stage.content}</pre> : null}
      </section>
      <div className="generation-hub-actions">
        {running ? <Button variant="outline" size="sm" onClick={onCancel}><X /> Cancel</Button> : null}
        {run.round.status === 'error' ? <Button size="sm" onClick={onRetry}>Retry</Button> : null}
        {run.patch ? <>
          {canApply(run.patch) ? <Button size="sm" onClick={onApply}>Apply</Button> : null}
          <Button variant="outline" size="sm" onClick={onSaveCopy}>Save copy</Button>
          <Button variant="outline" size="sm" onClick={onReject}><X /> Dismiss</Button>
        </> : null}
        <Button variant="destructive" size="sm" onClick={onDiscard}><Trash2 /> Delete</Button>
      </div>
    </article>
  );
}

function currentRuntimeStage(
  round: GenerationRoundRecord,
  trace: KnowledgeRetrievalTraceEvent[],
  candidate: string
): RuntimeStage {
  if (round.status === 'error') {
    return {
      icon: <CircleAlert />,
      title: 'Generation failed',
      detail: round.errorMessage || 'The generation stopped before a draft was ready.',
      tone: 'error'
    };
  }
  if (round.status === 'patch_created') {
    return {
      icon: <Check />,
      title: 'Draft ready for review',
      detail: candidate ? 'Review the generated draft below.' : 'The generated draft is ready for review.',
      content: candidate || undefined,
      tone: 'ready'
    };
  }
  if (round.status === 'done') {
    return {
      icon: <Sparkles />,
      title: 'Preparing suggestion',
      detail: 'Validating the generated draft before it is ready for review.',
      tone: 'active'
    };
  }
  if (round.status === 'pending' || round.status === 'processing') {
    return {
      icon: <FileText />,
      title: round.status === 'pending' ? 'Preparing draft' : 'Streaming draft',
      detail: candidate ? 'Draft text is arriving.' : 'Waiting for the model response…',
      content: candidate || undefined,
      tone: 'active'
    };
  }

  return retrievalRuntimeStage(trace);
}

function retrievalRuntimeStage(trace: KnowledgeRetrievalTraceEvent[]): RuntimeStage {
  const latest = trace.at(-1);
  if (!latest) {
    return {
      icon: <Search />,
      title: 'RAG retrieval',
      detail: 'Preparing the evidence search…',
      tone: 'active'
    };
  }

  switch (latest.type) {
    case 'query_plan':
      return {
        icon: <Search />,
        title: 'RAG retrieval',
        detail: latest.queries.length > 0
          ? `Searching for: ${latest.queries.join(' · ')}`
          : 'Searching the knowledge base…',
        tone: 'active'
      };
    case 'started':
      return {
        icon: <Search />,
        title: 'RAG retrieval',
        detail: `Retrieving evidence for: ${latest.query}`,
        tone: 'active'
      };
    case 'round_started':
      return {
        icon: <Search />,
        title: 'RAG retrieval',
        detail: `Searching evidence, round ${latest.round}: ${latest.queries.join(' · ')}`,
        tone: 'active'
      };
    case 'round_candidates':
      return {
        icon: <Search />,
        title: 'RAG retrieval',
        detail: `${latest.sources.length} candidate source${latest.sources.length === 1 ? '' : 's'} found.`,
        tone: 'active'
      };
    case 'round_evaluating':
      return {
        icon: <Sparkles />,
        title: 'Agent retrieval',
        detail: `Assessing ${latest.candidateCount} evidence candidate${latest.candidateCount === 1 ? '' : 's'} in round ${latest.round}.`,
        tone: 'active'
      };
    case 'round_evaluation': {
      const nextQueries = latest.nextQueries.length > 0 ? ` Next: ${latest.nextQueries.join(' · ')}` : '';
      return {
        icon: <Sparkles />,
        title: 'Agent retrieval',
        detail: `${latest.reason || `Evidence assessment: ${latest.decision}.`}${nextQueries}`,
        tone: 'active'
      };
    }
    case 'done':
      return {
        icon: <Sparkles />,
        title: 'Agent retrieval',
        detail: `${latest.sources.length} source${latest.sources.length === 1 ? '' : 's'} selected. Preparing the draft…`,
        tone: 'active'
      };
    case 'error':
      return {
        icon: <CircleAlert />,
        title: 'Retrieval failed',
        detail: latest.message,
        tone: 'error'
      };
  }
}

function compareHubRuns(left: Pick<HubRun, 'round'>, right: Pick<HubRun, 'round'>): number {
  const priorityDifference = hubRunPriority(left.round.status) - hubRunPriority(right.round.status);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }
  return new Date(right.round.updatedAt).getTime() - new Date(left.round.updatedAt).getTime();
}

function hubRunPriority(status: GenerationRoundRecord['status']): number {
  if (isRunning(status)) {
    return 0;
  }
  return status === 'patch_created' || status === 'done' ? 1 : 2;
}

function summarizeHubRuns(runs: HubRun[]): string {
  const running = runs.filter((run) => isRunning(run.round.status)).length;
  const ready = runs.filter((run) => run.round.status === 'patch_created' || run.round.status === 'done').length;
  const failed = runs.filter((run) => run.round.status === 'error').length;
  const summary = [
    running > 0 ? `${running} running` : null,
    ready > 0 ? `${ready} ready` : null,
    failed > 0 ? `${failed} failed` : null
  ].filter((part): part is string => Boolean(part));
  return summary.length > 0 ? summary.join(' · ') : `${runs.length} task${runs.length === 1 ? '' : 's'}`;
}

function patchText(patch: WritingPatchRecord | null): string {
  if (!patch) {
    return '';
  }
  const operation = patch.patch.operation;
  return operation.type === 'replace'
    ? operation.after
    : operation.type === 'insert'
      ? operation.text
      : operation.content;
}

function streamedCandidate(text: string): string {
  if (!text) {
    return '';
  }
  try {
    const proposal = JSON.parse(text) as { afterText?: unknown };
    return typeof proposal.afterText === 'string' ? proposal.afterText : '';
  } catch {
    const match = text.match(/"afterText"\s*:\s*"([\s\S]*)/);
    return match ? match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
  }
}

function canApply(patch: WritingPatchRecord): boolean {
  return patch.patch.kind !== 'create_content_candidate' &&
    patch.patch.validation?.ok !== false &&
    !['blocked', 'parse_failed', 'validation_failed', 'applied', 'rejected', 'saved_as_candidate'].includes(patch.patch.status);
}

function isRunning(status: GenerationRoundRecord['status']): boolean {
  return status === 'retrieving' || status === 'pending' || status === 'processing';
}

function statusLabel(status: GenerationRoundRecord['status']): string {
  switch (status) {
    case 'retrieving': return 'Retrieving evidence';
    case 'pending': return 'Preparing the draft';
    case 'processing': return 'Streaming the draft';
    case 'patch_created': return 'Ready for your review';
    case 'done': return 'Preparing suggestion';
    case 'error': return 'Generation failed';
    default: return status;
  }
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
