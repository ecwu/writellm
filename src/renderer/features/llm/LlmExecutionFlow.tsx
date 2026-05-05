import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileSearch, MessageSquareText, RefreshCw, Send, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
import { getApi } from '../../api';
import type { KnowledgeRetrievalMode, KnowledgeRetrievalTraceEvent, RetrievedKnowledgeSource } from '../../../shared/types';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Spinner } from '../../components/ui/spinner';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '../../components/ui/field';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle
} from '../../components/ui/item';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Textarea } from '../../components/ui/textarea';

export type LlmFlowMode = 'direct' | 'precise';

export type LlmFlowPhase =
  | 'idle'
  | 'awaiting_retrieval_prompt'
  | 'retrieving'
  | 'awaiting_sources'
  | 'generating'
  | 'awaiting_adoption'
  | 'done'
  | 'error';

export type LlmFlowGenerateInput = {
  mode: LlmFlowMode;
  prompt: string;
  useKnowledgeSources: boolean;
  retrievalMode: KnowledgeRetrievalMode;
  knowledgeRetrievalPrompt: string;
  sources: RetrievedKnowledgeSource[];
};

export type LlmFlowResult = {
  content: string;
  sources: RetrievedKnowledgeSource[];
};

export type LlmFlowAdoptInput = LlmFlowGenerateInput & LlmFlowResult;

export type LlmFlowGenerateProgress = {
  content: string;
  sources?: RetrievedKnowledgeSource[];
};

export function LlmExecutionFlow({
  label,
  placeholder,
  initialPrompt = '',
  defaultUseKnowledgeSources = true,
  buildKnowledgeRetrievalPrompt,
  retrieveSources,
  generate,
  onAdopt,
  onCancel
}: {
  label: string;
  placeholder: string;
  initialPrompt?: string;
  defaultUseKnowledgeSources?: boolean;
  buildKnowledgeRetrievalPrompt: (prompt: string) => string;
  retrieveSources: (
    knowledgeRetrievalPrompt: string,
    options: {
      retrievalMode: KnowledgeRetrievalMode;
      runId?: string;
    }
  ) => Promise<RetrievedKnowledgeSource[]>;
  generate: (
    input: LlmFlowGenerateInput,
    onProgress: (progress: LlmFlowGenerateProgress) => void
  ) => Promise<LlmFlowResult>;
  onAdopt: (input: LlmFlowAdoptInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [useKnowledgeSources, setUseKnowledgeSources] = useState(defaultUseKnowledgeSources);
  const [useSourceV2, setUseSourceV2] = useState(false);
  const [mode, setMode] = useState<LlmFlowMode | null>(null);
  const [phase, setPhase] = useState<LlmFlowPhase>('idle');
  const [knowledgeRetrievalPrompt, setKnowledgeRetrievalPrompt] = useState('');
  const [sources, setSources] = useState<RetrievedKnowledgeSource[]>([]);
  const [retrievalTrace, setRetrievalTrace] = useState<KnowledgeRetrievalTraceEvent[]>([]);
  const [removedSourceIds, setRemovedSourceIds] = useState<Set<string>>(new Set());
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<LlmFlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedSources = useMemo(
    () => sources.filter((source) => !removedSourceIds.has(source.chunkId)),
    [removedSourceIds, sources]
  );
  const running = phase === 'retrieving' || phase === 'generating';
  const canStart = Boolean(prompt.trim()) && !running;
  const promptMissing = !prompt.trim() && phase !== 'idle';
  const showInput =
    phase === 'idle' ||
    phase === 'awaiting_retrieval_prompt' ||
    phase === 'awaiting_sources' ||
    phase === 'error';

  function resetForPrompt(nextPrompt: string) {
    setPrompt(nextPrompt);
    if (phase !== 'idle') {
      setMode(null);
      setPhase('idle');
      setKnowledgeRetrievalPrompt('');
      setSources([]);
      setRetrievalTrace([]);
      setRemovedSourceIds(new Set());
      setExpandedSourceIds(new Set());
      setResult(null);
      setError(null);
    }
  }

  async function startDirect() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || running) {
      return;
    }
    const nextRetrievalPrompt = buildKnowledgeRetrievalPrompt(trimmedPrompt);
    setMode('direct');
    setKnowledgeRetrievalPrompt(nextRetrievalPrompt);
    setSources([]);
    setRetrievalTrace([]);
    setRemovedSourceIds(new Set());
    setExpandedSourceIds(new Set());
    setResult(null);
    setError(null);

    try {
      const nextSources = useKnowledgeSources ? await runRetrieval(nextRetrievalPrompt) : [];
      await runGeneration('direct', trimmedPrompt, nextRetrievalPrompt, nextSources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('error');
    }
  }

  function startPrecise() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || running) {
      return;
    }
    setMode('precise');
    setKnowledgeRetrievalPrompt(buildKnowledgeRetrievalPrompt(trimmedPrompt));
    setSources([]);
    setRetrievalTrace([]);
    setRemovedSourceIds(new Set());
    setExpandedSourceIds(new Set());
    setResult(null);
    setError(null);
    setPhase(useKnowledgeSources ? 'awaiting_retrieval_prompt' : 'awaiting_sources');
  }

  async function runRetrieval(nextRetrievalPrompt = knowledgeRetrievalPrompt): Promise<RetrievedKnowledgeSource[]> {
    setPhase('retrieving');
    setRetrievalTrace([]);
    const retrievalMode: KnowledgeRetrievalMode = useSourceV2 ? 'sourcev2' : 'classic';
    const runId = retrievalMode === 'sourcev2' ? globalThis.crypto.randomUUID() : undefined;
    const unsubscribe = runId
      ? getApi().onKnowledgeRetrievalStream((event) => {
          if (event.runId === runId) {
            setRetrievalTrace((current) => [...current, event]);
          }
        })
      : undefined;
    const nextSources = await retrieveSources(nextRetrievalPrompt, {
      retrievalMode,
      runId
    }).finally(() => {
      unsubscribe?.();
    });
    setSources(nextSources);
    setRemovedSourceIds(new Set());
    setPhase('awaiting_sources');
    return nextSources;
  }

  async function runGeneration(
    nextMode: LlmFlowMode = mode ?? 'precise',
    nextPrompt = prompt.trim(),
    nextRetrievalPrompt = knowledgeRetrievalPrompt,
    nextSources = selectedSources
  ) {
    setPhase('generating');
    setError(null);
    const initialSources = useKnowledgeSources ? nextSources : [];
    setResult({ content: '', sources: initialSources });
    const nextResult = await generate({
      mode: nextMode,
      prompt: nextPrompt,
      useKnowledgeSources,
      retrievalMode: useSourceV2 ? 'sourcev2' : 'classic',
      knowledgeRetrievalPrompt: nextRetrievalPrompt,
      sources: useKnowledgeSources ? nextSources : []
    }, (progress) => {
      setResult((current) => ({
        content: progress.content,
        sources: progress.sources ?? current?.sources ?? initialSources
      }));
    });
    setResult(nextResult);
    if (useKnowledgeSources && nextResult.sources.length > 0 && sources.length === 0) {
      setSources(nextResult.sources);
    }
    setPhase('awaiting_adoption');
  }

  async function generateFromPreciseSources() {
    try {
      await runGeneration('precise', prompt.trim(), knowledgeRetrievalPrompt, selectedSources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('error');
    }
  }

  async function adoptResult() {
    if (!result || !mode) {
      return;
    }
    try {
      await onAdopt({
        mode,
        prompt: prompt.trim(),
        useKnowledgeSources,
        retrievalMode: useSourceV2 ? 'sourcev2' : 'classic',
        knowledgeRetrievalPrompt,
        sources: result.sources,
        content: result.content
      });
      setPhase('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('error');
    }
  }

  async function regenerateResult() {
    if (!mode) {
      return;
    }
    try {
      await runGeneration(mode, prompt.trim(), knowledgeRetrievalPrompt, selectedSources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('error');
    }
  }

  function removeSource(chunkId: string) {
    setRemovedSourceIds((current) => new Set([...current, chunkId]));
  }

  function toggleSource(chunkId: string) {
    setExpandedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }
      return next;
    });
  }

  return (
    <div className={showInput ? 'llm-flow' : 'llm-flow llm-flow-input-hidden'}>
      {showInput ? (
        <div className="llm-flow-input">
          <div className="llm-flow-input-heading">
            <span>{label}</span>
          </div>
          <FieldGroup className="llm-flow-input-fields">
            <Field orientation="horizontal" className="llm-flow-source-toggle">
              <Checkbox
                id="llm-use-sources"
                checked={useKnowledgeSources}
                disabled={running}
                onCheckedChange={(checked) => {
                  setUseKnowledgeSources(checked === true);
                  if (phase !== 'idle') {
                    setPhase('idle');
                    setMode(null);
                    setSources([]);
                    setRetrievalTrace([]);
                    setRemovedSourceIds(new Set());
                    setExpandedSourceIds(new Set());
                    setResult(null);
                    setError(null);
                  }
                }}
              />
              <FieldContent>
                <FieldLabel htmlFor="llm-use-sources">Use sources</FieldLabel>
                <FieldDescription>Retrieve relevant knowledge before generation.</FieldDescription>
              </FieldContent>
            </Field>
            {useKnowledgeSources ? (
              <Field orientation="horizontal" className="llm-flow-source-toggle">
                <Checkbox
                  id="llm-use-source-v2"
                  checked={useSourceV2}
                  disabled={running}
                  onCheckedChange={(checked) => {
                    setUseSourceV2(checked === true);
                    if (phase !== 'idle') {
                      setPhase('idle');
                      setMode(null);
                      setSources([]);
                      setRetrievalTrace([]);
                      setRemovedSourceIds(new Set());
                      setExpandedSourceIds(new Set());
                      setResult(null);
                      setError(null);
                    }
                  }}
                />
                <FieldContent>
                  <FieldLabel htmlFor="llm-use-source-v2">Source v2</FieldLabel>
                  <FieldDescription>Run multi-round retrieval with visible planning steps.</FieldDescription>
                </FieldContent>
              </Field>
            ) : null}
            <Field data-invalid={promptMissing}>
              <FieldLabel htmlFor="llm-generation-prompt">Prompt</FieldLabel>
              <Textarea
                id="llm-generation-prompt"
                value={prompt}
                onChange={(event) => resetForPrompt(event.target.value)}
                placeholder={placeholder}
                disabled={running}
                aria-invalid={promptMissing}
              />
              {promptMissing ? (
                <FieldError>Prompt is required before generation.</FieldError>
              ) : (
                <FieldDescription>Describe what the model should generate for the selected section.</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <div className="llm-flow-input-actions">
            <Button type="button" size="sm" onClick={() => void startDirect()} disabled={!canStart}>
              <WandSparkles />
              Direct generate
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={startPrecise} disabled={!canStart}>
              <FileSearch />
              Precise control
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={running}>
              <X />
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {phase === 'idle' ? null : (
        <ScrollArea className="llm-flow-scroll">
          <ItemGroup className="llm-flow-items">
            <PromptItem prompt={prompt} />
            {useKnowledgeSources ? (
              <RetrievalPromptItem
                editable={mode === 'precise' && phase === 'awaiting_retrieval_prompt'}
                phase={phase}
                value={knowledgeRetrievalPrompt}
                onChange={setKnowledgeRetrievalPrompt}
                onRetrieve={() => void runRetrieval().catch((caught) => {
                  setError(caught instanceof Error ? caught.message : String(caught));
                  setPhase('error');
                })}
              />
            ) : (
              <StatusItem title="Sources disabled" description="This run will generate without knowledge source retrieval." />
            )}
            {useKnowledgeSources && useSourceV2 && (phase === 'retrieving' || retrievalTrace.length > 0) ? (
              <SourceV2TraceItem events={retrievalTrace} />
            ) : null}
            {useKnowledgeSources && shouldShowSources(phase) ? (
              <SourceListItem
                sources={selectedSources}
                removedCount={removedSourceIds.size}
                expandedSourceIds={expandedSourceIds}
                canEdit={mode === 'precise' && phase === 'awaiting_sources'}
                canGenerate={mode === 'precise' && phase === 'awaiting_sources'}
                onRemove={removeSource}
                onToggle={toggleSource}
                onRestore={() => setRemovedSourceIds(new Set())}
                onGenerate={() => void generateFromPreciseSources()}
              />
            ) : null}
            {!useKnowledgeSources && mode === 'precise' && phase === 'awaiting_sources' ? (
              <StatusItem
                title="Ready to generate"
                description="Source retrieval is off for this run."
                action={<Button type="button" size="sm" onClick={() => void generateFromPreciseSources()}><Send />Generate</Button>}
              />
            ) : null}
            {phase === 'generating' && !result ? (
              <StatusItem title="Generating result" description="Waiting for the model response." />
            ) : null}
            {result && phase !== 'done' ? (
              <ResultItem
                content={result.content}
                phase={phase}
                onAdopt={() => void adoptResult()}
                onRegenerate={() => void regenerateResult()}
                onDiscard={onCancel}
              />
            ) : null}
            {phase === 'done' ? (
              <StatusItem title="Adopted" description="The generated result has been applied." />
            ) : null}
            {phase === 'error' && error ? (
              <StatusItem title="Error" description={error} tone="error" />
            ) : null}
          </ItemGroup>
        </ScrollArea>
      )}
    </div>
  );
}

function PromptItem({ prompt }: { prompt: string }) {
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon"><MessageSquareText /></ItemMedia>
      <ItemContent>
        <ItemTitle>User prompt</ItemTitle>
        <ItemDescription className="llm-flow-pre">{prompt}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

function RetrievalPromptItem({
  editable,
  phase,
  value,
  onChange,
  onRetrieve
}: {
  editable: boolean;
  phase: LlmFlowPhase;
  value: string;
  onChange: (value: string) => void;
  onRetrieve: () => void;
}) {
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon"><FileSearch /></ItemMedia>
      <ItemContent>
        <ItemTitle>Source retrieval prompt</ItemTitle>
        {editable ? (
          <Field data-invalid={!value.trim()}>
            <FieldLabel htmlFor="llm-retrieval-prompt">Retrieval prompt</FieldLabel>
            <Textarea
              id="llm-retrieval-prompt"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              aria-invalid={!value.trim()}
            />
            {!value.trim() ? (
              <FieldError>Retrieval prompt is required.</FieldError>
            ) : (
              <FieldDescription>Used to search knowledge sources before generation.</FieldDescription>
            )}
          </Field>
        ) : (
          <ItemDescription className="llm-flow-pre">{value}</ItemDescription>
        )}
      </ItemContent>
      {editable ? (
        <ItemActions>
          <Button type="button" size="sm" onClick={onRetrieve} disabled={!value.trim()}>
            <FileSearch />
            Retrieve
          </Button>
        </ItemActions>
      ) : phase === 'retrieving' ? (
        <ItemActions><span className="llm-flow-status">Retrieving</span></ItemActions>
      ) : null}
    </Item>
  );
}

function SourceV2TraceItem({ events }: { events: KnowledgeRetrievalTraceEvent[] }) {
  const started = events.find((event) => event.type === 'started');
  const done = events.find((event) => event.type === 'done');
  const error = events.find((event) => event.type === 'error');
  const rounds = Array.from(new Set(events
    .filter((event): event is Extract<KnowledgeRetrievalTraceEvent, { round: number }> => 'round' in event)
    .map((event) => event.round)
  )).sort((left, right) => left - right);

  return (
    <Item variant="outline" size="sm" className="llm-flow-source-v2-trace-item">
      <ItemMedia variant="icon"><RefreshCw /></ItemMedia>
      <ItemContent>
        <ItemTitle>Source v2 retrieval</ItemTitle>
        <ItemDescription>
          {error
            ? `Source v2 failed: ${error.message}. ${done ? 'Returned classic retrieval results.' : ''}`
            : done ? done.stopReason : started ? `Planning up to ${started.maxRounds} rounds` : 'Starting retrieval'}
        </ItemDescription>
        <div className="llm-flow-source-v2-trace">
          {rounds.length > 0 ? rounds.map((round) => {
            const roundStarted = events.find((event): event is Extract<KnowledgeRetrievalTraceEvent, { type: 'round_started' }> =>
              event.type === 'round_started' && event.round === round
            );
            const roundCandidates = events.find((event): event is Extract<KnowledgeRetrievalTraceEvent, { type: 'round_candidates' }> =>
              event.type === 'round_candidates' && event.round === round
            );
            const roundEvaluating = events.find((event): event is Extract<KnowledgeRetrievalTraceEvent, { type: 'round_evaluating' }> =>
              event.type === 'round_evaluating' && event.round === round
            );
            const roundEvaluation = events.find((event): event is Extract<KnowledgeRetrievalTraceEvent, { type: 'round_evaluation' }> =>
              event.type === 'round_evaluation' && event.round === round
            );
            return (
              <div key={round} className="llm-flow-source-v2-round">
                <strong>Round {round}</strong>
                {roundStarted ? (
                  <span>{roundStarted.queries.join(' | ')}</span>
                ) : null}
                {roundCandidates ? (
                  <em>{roundCandidates.sources.length} candidate chunks</em>
                ) : null}
                {roundEvaluating && !roundEvaluation ? (
                  <span className="llm-flow-source-v2-waiting">
                    <Spinner />
                    Waiting for evaluator model on {roundEvaluating.candidateCount} candidates
                  </span>
                ) : null}
                {roundEvaluation ? (
                  <p>
                    {roundEvaluation.decision}: {roundEvaluation.reason || 'No evaluator reason returned.'}
                    {roundEvaluation.nextQueries.length > 0 ? ` Next: ${roundEvaluation.nextQueries.join(' | ')}` : ''}
                  </p>
                ) : null}
              </div>
            );
          }) : (
            <p className="llm-flow-empty">Waiting for the first retrieval round.</p>
          )}
        </div>
      </ItemContent>
    </Item>
  );
}

function SourceListItem({
  sources,
  removedCount,
  expandedSourceIds,
  canEdit,
  canGenerate,
  onRemove,
  onToggle,
  onRestore,
  onGenerate
}: {
  sources: RetrievedKnowledgeSource[];
  removedCount: number;
  expandedSourceIds: Set<string>;
  canEdit: boolean;
  canGenerate: boolean;
  onRemove: (chunkId: string) => void;
  onToggle: (chunkId: string) => void;
  onRestore: () => void;
  onGenerate: () => void;
}) {
  const groupedSources = groupSourcesByRound(sources);
  return (
    <Item variant="outline" size="sm" className="llm-flow-source-list-item">
      <ItemMedia variant="icon"><Sparkles /></ItemMedia>
      <ItemContent>
        <ItemTitle>Retrieved sources</ItemTitle>
        <ItemDescription>
          {sources.length} selected{removedCount > 0 ? `, ${removedCount} removed` : ''}
        </ItemDescription>
        <div className="llm-flow-source-list">
          {sources.length > 0 ? groupedSources.map((group) => (
            <div key={group.roundKey} className="llm-flow-source-round-group">
              {group.label ? <span className="llm-flow-source-round-label">{group.label}</span> : null}
              {group.sources.map((source) => (
                <div key={source.chunkId} className="llm-flow-source">
                  <button type="button" className="llm-flow-source-main" onClick={() => onToggle(source.chunkId)}>
                    {expandedSourceIds.has(source.chunkId) ? <ChevronDown /> : <ChevronRight />}
                    <span>
                      <strong>[{source.publicRef}] {source.itemTitle}</strong>
                      <em>
                        chunk {source.chunkIndex + 1} · {source.score.toFixed(3)} · {source.retrievalMethod ?? 'retrieval'}
                      </em>
                    </span>
                  </button>
                  {canEdit ? (
                    <Button type="button" variant="ghost" size="icon-xs" title="Remove source" onClick={() => onRemove(source.chunkId)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                  {expandedSourceIds.has(source.chunkId) ? (
                    <>
                      {source.sourceV2Reason ? <p className="llm-flow-source-reason">{source.sourceV2Reason}</p> : null}
                      <p>{source.snippet}</p>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          )) : (
            <p className="llm-flow-empty">No sources selected.</p>
          )}
        </div>
        {canGenerate ? (
          <ItemFooter>
            <Button type="button" size="sm" onClick={onGenerate}>
              <Send />
              Generate
            </Button>
            {removedCount > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={onRestore}>
                Restore all
              </Button>
            ) : null}
          </ItemFooter>
        ) : null}
      </ItemContent>
    </Item>
  );
}

function groupSourcesByRound(sources: RetrievedKnowledgeSource[]): Array<{
  roundKey: string;
  label: string | null;
  sources: RetrievedKnowledgeSource[];
}> {
  const hasSourceV2Rounds = sources.some((source) => typeof source.sourceV2Round === 'number');
  if (!hasSourceV2Rounds) {
    return [{ roundKey: 'classic', label: null, sources }];
  }
  const groups = new Map<number, RetrievedKnowledgeSource[]>();
  sources.forEach((source) => {
    const round = source.sourceV2Round ?? 0;
    groups.set(round, [...(groups.get(round) ?? []), source]);
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => left - right)
    .map(([round, roundSources]) => ({
      roundKey: `round-${round}`,
      label: round > 0 ? `Source v2 round ${round}` : 'Source v2 fallback',
      sources: roundSources
    }));
}

function ResultItem({
  content,
  phase,
  onAdopt,
  onRegenerate,
  onDiscard
}: {
  content: string;
  phase: LlmFlowPhase;
  onAdopt: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
}) {
  const disabled = phase === 'generating';
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon"><WandSparkles /></ItemMedia>
      <ItemContent>
        <ItemTitle>Generated result</ItemTitle>
        <ItemDescription className="llm-flow-result">
          {content || <span className="llm-flow-result-placeholder">Generating...</span>}
        </ItemDescription>
        <ItemFooter>
          <Button type="button" size="sm" onClick={onAdopt} disabled={disabled}>
            <Check />
            Adopt
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onRegenerate} disabled={disabled}>
            <RefreshCw />
            Regenerate
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard} disabled={disabled}>
            <X />
            Discard
          </Button>
        </ItemFooter>
      </ItemContent>
    </Item>
  );
}

function StatusItem({
  title,
  description,
  tone,
  action
}: {
  title: string;
  description: string;
  tone?: 'error';
  action?: React.ReactNode;
}) {
  return (
    <Item variant="muted" size="sm" className={tone === 'error' ? 'llm-flow-error' : undefined}>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      {action ? <ItemActions>{action}</ItemActions> : null}
    </Item>
  );
}

function shouldShowSources(phase: LlmFlowPhase): boolean {
  return (
    phase === 'awaiting_sources' ||
    phase === 'generating' ||
    phase === 'awaiting_adoption' ||
    phase === 'done' ||
    phase === 'error'
  );
}
