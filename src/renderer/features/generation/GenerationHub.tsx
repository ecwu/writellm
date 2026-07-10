import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, CircleAlert, FileText, Search, Sparkles, X } from 'lucide-react';
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
      .sort((left, right) => new Date(right.round.updatedAt).getTime() - new Date(left.round.updatedAt).getTime())
      .slice(0, 3);
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

  async function cancel(roundId: string) {
    try {
      await getApi().cancelGenerationTask(roundId);
      await refresh();
      onStatus('Generation canceled.');
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

  return (
    <section className="generation-hub" aria-label="Assistant generation hub">
      <header className="generation-hub-header">
        <div>
          <span>Assistant hub</span>
          <p>Retrieval, planning, streaming draft, and your approval stay in one place.</p>
        </div>
      </header>
      <div className="generation-hub-runs">
        {runs.map((run) => (
          <GenerationRunCard
            key={run.round.id}
            run={run}
            onCancel={() => void cancel(run.round.id)}
            onRetry={() => void retry(run.round.id)}
            onApply={run.patch ? () => void apply(run.patch!) : undefined}
            onSaveCopy={run.patch ? () => void saveCopy(run.patch!) : undefined}
            onReject={run.patch ? () => void reject(run.patch!) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function GenerationRunCard({
  run,
  onCancel,
  onRetry,
  onApply,
  onSaveCopy,
  onReject
}: {
  run: HubRun;
  onCancel: () => void;
  onRetry: () => void;
  onApply?: () => void;
  onSaveCopy?: () => void;
  onReject?: () => void;
}) {
  const running = isRunning(run.round.status);
  const trace = run.liveTrace.length > 0 ? run.liveTrace : run.round.retrievalTrace;
  const candidate = patchText(run.patch) || streamedCandidate(run.streamText) || run.streamText;
  const ragSummary = summarizeRag(trace);
  const planning = summarizePlanning(trace);

  return (
    <article className="generation-hub-run">
      <div className="generation-hub-run-title">
        <div>
          <span>{run.session.title || 'Assistant suggestion'}</span>
          <p>{statusLabel(run.round.status)}</p>
        </div>
        {running ? <Spinner /> : run.round.status === 'error' ? <CircleAlert /> : <Check />}
      </div>
      <div className="generation-hub-stages">
        <HubStage icon={<Search />} title="RAG retrieval" detail={ragSummary} active={run.round.status === 'retrieving'} />
        <HubStage icon={<Sparkles />} title="Agent retrieval plan" detail={planning} active={run.round.status === 'retrieving'} />
        <HubStage
          icon={<FileText />}
          title="Streaming draft"
          detail={running && !candidate ? 'Waiting for the model response…' : undefined}
          active={run.round.status === 'processing' || run.round.status === 'pending'}
        >
          {candidate ? <pre className="generation-hub-draft">{candidate}</pre> : null}
        </HubStage>
      </div>
      {run.round.errorMessage ? <p className="generation-hub-error">{run.round.errorMessage}</p> : null}
      <div className="generation-hub-actions">
        {running ? <Button variant="outline" size="sm" onClick={onCancel}><X /> Cancel</Button> : null}
        {run.round.status === 'error' ? <Button size="sm" onClick={onRetry}>Retry</Button> : null}
        {run.patch ? <>
          {canApply(run.patch) ? <Button size="sm" onClick={onApply}>Apply</Button> : null}
          <Button variant="outline" size="sm" onClick={onSaveCopy}>Save copy</Button>
          <Button variant="outline" size="sm" onClick={onReject}><X /> Dismiss</Button>
        </> : null}
      </div>
    </article>
  );
}

function HubStage({
  icon,
  title,
  detail,
  active,
  children
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  active: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={`generation-hub-stage ${active ? 'is-active' : ''}`}>
      <div className="generation-hub-stage-title">{icon}<span>{title}</span></div>
      {detail ? <p>{detail}</p> : null}
      {children}
    </section>
  );
}

function summarizeRag(trace: KnowledgeRetrievalTraceEvent[]): string {
  const started = trace.find((event) => event.type === 'started');
  const done = [...trace].reverse().find((event) => event.type === 'done');
  const candidates = trace.filter((event) => event.type === 'round_candidates').at(-1);
  const queryPlan = trace.find((event) => event.type === 'query_plan');
  if (done?.type === 'done') {
    return `${done.sources.length} sources selected · ${done.stopReason}`;
  }
  if (candidates?.type === 'round_candidates') {
    return `${candidates.sources.length} candidate sources found.`;
  }
  if (queryPlan?.type === 'query_plan') {
    return 'Query plan ready; searching the knowledge base…';
  }
  return started?.type === 'started' ? `Retrieving evidence for: ${started.query}` : 'No knowledge retrieval requested.';
}

function summarizePlanning(trace: KnowledgeRetrievalTraceEvent[]): string {
  const queryPlan = trace.find((event) => event.type === 'query_plan');
  const evaluations = trace.filter((event) => event.type === 'round_evaluation');
  const latest = evaluations.at(-1);
  const initialQueries = queryPlan?.type === 'query_plan' ? `Initial: ${queryPlan.queries.join(' · ')}` : '';
  if (!latest || latest.type !== 'round_evaluation') {
    if (trace.some((event) => event.type === 'round_evaluating')) {
      return initialQueries ? `${initialQueries}. Assessing retrieval candidates…` : 'Assessing retrieval candidates…';
    }
    return initialQueries || 'No follow-up retrieval query was needed.';
  }
  const queries = latest.nextQueries.length > 0 ? ` Next: ${latest.nextQueries.join(' · ')}` : '';
  return [initialQueries, `${latest.reason || latest.decision}.${queries}`].filter(Boolean).join(' ');
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
