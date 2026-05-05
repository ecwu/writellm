import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileSearch, MessageSquareText, RefreshCw, Send, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
import type { RetrievedKnowledgeSource } from '../../../shared/types';
import { Button } from '../../components/ui/button';
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
  knowledgeRetrievalPrompt: string;
  sources: RetrievedKnowledgeSource[];
};

export type LlmFlowResult = {
  content: string;
  sources: RetrievedKnowledgeSource[];
};

export type LlmFlowAdoptInput = LlmFlowGenerateInput & LlmFlowResult;

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
  retrieveSources: (knowledgeRetrievalPrompt: string) => Promise<RetrievedKnowledgeSource[]>;
  generate: (input: LlmFlowGenerateInput) => Promise<LlmFlowResult>;
  onAdopt: (input: LlmFlowAdoptInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [useKnowledgeSources, setUseKnowledgeSources] = useState(defaultUseKnowledgeSources);
  const [mode, setMode] = useState<LlmFlowMode | null>(null);
  const [phase, setPhase] = useState<LlmFlowPhase>('idle');
  const [knowledgeRetrievalPrompt, setKnowledgeRetrievalPrompt] = useState('');
  const [sources, setSources] = useState<RetrievedKnowledgeSource[]>([]);
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

  function resetForPrompt(nextPrompt: string) {
    setPrompt(nextPrompt);
    if (phase !== 'idle') {
      setMode(null);
      setPhase('idle');
      setKnowledgeRetrievalPrompt('');
      setSources([]);
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
    setRemovedSourceIds(new Set());
    setExpandedSourceIds(new Set());
    setResult(null);
    setError(null);
    setPhase(useKnowledgeSources ? 'awaiting_retrieval_prompt' : 'awaiting_sources');
  }

  async function runRetrieval(nextRetrievalPrompt = knowledgeRetrievalPrompt): Promise<RetrievedKnowledgeSource[]> {
    setPhase('retrieving');
    const nextSources = await retrieveSources(nextRetrievalPrompt);
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
    const nextResult = await generate({
      mode: nextMode,
      prompt: nextPrompt,
      useKnowledgeSources,
      knowledgeRetrievalPrompt: nextRetrievalPrompt,
      sources: useKnowledgeSources ? nextSources : []
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
    <div className="llm-flow">
      <div className="llm-flow-input">
        <div className="llm-flow-input-heading">
          <span>{label}</span>
          <label>
            <input
              type="checkbox"
              checked={useKnowledgeSources}
              disabled={running}
              onChange={(event) => {
                setUseKnowledgeSources(event.target.checked);
                if (phase !== 'idle') {
                  setPhase('idle');
                  setMode(null);
                  setSources([]);
                  setRemovedSourceIds(new Set());
                  setExpandedSourceIds(new Set());
                  setResult(null);
                  setError(null);
                }
              }}
            />
            <span>Use Sources</span>
          </label>
        </div>
        <Textarea
          value={prompt}
          onChange={(event) => resetForPrompt(event.target.value)}
          placeholder={placeholder}
          disabled={running}
        />
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
            {phase === 'generating' ? (
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
          <Textarea value={value} onChange={(event) => onChange(event.target.value)} />
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
  return (
    <Item variant="outline" size="sm" className="llm-flow-source-list-item">
      <ItemMedia variant="icon"><Sparkles /></ItemMedia>
      <ItemContent>
        <ItemTitle>Retrieved sources</ItemTitle>
        <ItemDescription>
          {sources.length} selected{removedCount > 0 ? `, ${removedCount} removed` : ''}
        </ItemDescription>
        <div className="llm-flow-source-list">
          {sources.length > 0 ? sources.map((source) => (
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
                <p>{source.snippet}</p>
              ) : null}
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
        <ItemDescription className="llm-flow-result">{content}</ItemDescription>
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
