import { ArrowLeft, FileWarning, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type {
  BlockPreview,
  SourceDetail as SourceDetailModel,
  SourceError,
  SourceSummary,
  SourcesApi,
} from '../../../shared/sources';
import { SourcePdfPreview } from './SourcePdfPreview';
import { sourceErrorCopy, sourceFailureStageLabel } from './source-state';

export function SourceDetail({
  api,
  source,
  onBack,
  onOpenSettings,
}: {
  api: SourcesApi;
  source: SourceSummary;
  onBack(): void;
  onOpenSettings?(): void;
}) {
  const [detail, setDetail] = useState<SourceDetailModel | null>(null);
  const [blocks, setBlocks] = useState<BlockPreview[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [error, setError] = useState<{
    message: string;
    sourceError?: SourceError;
    action?: 'Loading' | 'Retry' | 'Removal';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mode, setMode] = useState<'structured-markdown' | 'original-pdf'>('structured-markdown');
  const detailRef = useRef<SourceDetailModel | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const sourceRevision = source.revision;
  const sourceState = source.state;
  const sourceProgressCompleted = source.progress.completed;
  const sourceProgressTotal = source.progress.total;
  const sourceProgressStage = source.progress.stage;
  const sourceRetrying = source.retrying;
  const [confirmation, setConfirmation] = useState<{
    token: string;
    activeJobCount: number;
    searchableBlockCount: number;
  } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const currentGeneration = ++generation.current;
    void sourceRevision;
    let current = true;
    const switchingSource = detailRef.current?.sourceId !== source.sourceId;
    if (switchingSource) {
      detailRef.current = null;
      setDetail(null);
      setBlocks([]);
      setNextCursor(undefined);
    }
    setError(null);
    void api
      .getSource({ sourceId: source.sourceId, limit: 100 })
      .then((result) => {
        if (!current || currentGeneration !== generation.current) return;
        if (result.status === 'ok') {
          if (result.sourceVersionId !== result.source.sourceVersionId) {
            setError({ message: 'This source changed while loading. Reopen it to resync.' });
            return;
          }
          const versionChanged = detailRef.current?.sourceVersionId !== result.sourceVersionId;
          detailRef.current = result.source;
          setDetail(result.source);
          setBlocks(result.blocks);
          setNextCursor(result.nextCursor);
          if (versionChanged)
            setMode(
              result.source.parseSummary.markdownAvailable ? 'structured-markdown' : 'original-pdf',
            );
          else if (
            modeRef.current === 'structured-markdown' &&
            !result.source.parseSummary.markdownAvailable
          )
            setMode('original-pdf');
          else if (
            modeRef.current === 'original-pdf' &&
            !result.source.parseSummary.originalPreviewAvailable
          )
            setMode('structured-markdown');
        } else {
          const copy = sourceErrorCopy(result.error);
          setError({ message: copy.message, sourceError: result.error });
        }
      })
      .catch(() => {
        if (current && currentGeneration === generation.current)
          setError({
            message: 'This source preview could not be loaded. Check the connection and retry.',
          });
      });
    return () => {
      current = false;
      generation.current += 1;
    };
  }, [
    api,
    source.sourceId,
    sourceProgressCompleted,
    sourceProgressStage,
    sourceProgressTotal,
    sourceRetrying,
    sourceRevision,
    sourceState,
  ]);
  const loadMore = async () => {
    if (!nextCursor || !detail || loadingMore) return;
    const currentGeneration = generation.current;
    const sourceVersionId = detail.sourceVersionId;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await api.getSource({
        sourceId: source.sourceId,
        cursor: nextCursor,
        limit: 100,
      });
      if (currentGeneration !== generation.current) return;
      if (
        result.status === 'ok' &&
        result.sourceVersionId === sourceVersionId &&
        result.source.sourceVersionId === sourceVersionId
      ) {
        setBlocks((current) => {
          const byId = new Map(current.map((block) => [block.chunkId, block]));
          for (const block of result.blocks) byId.set(block.chunkId, block);
          return [...byId.values()].sort((a, b) => a.ordinal - b.ordinal);
        });
        setNextCursor(result.nextCursor);
      } else if (result.status !== 'ok') {
        const copy = sourceErrorCopy(result.error);
        setError({ message: copy.message, sourceError: result.error });
      } else
        setError({
          message: 'This source changed while loading more blocks. Reopen it to resync.',
        });
    } catch {
      if (currentGeneration === generation.current)
        setError({
          message: 'More blocks could not be loaded. Check the connection and try again.',
        });
    } finally {
      if (currentGeneration === generation.current) setLoadingMore(false);
    }
  };
  const retry = async () => {
    if (busy) return;
    const current = detail ?? source;
    setBusy(true);
    setError(null);
    try {
      const result = await api.retrySource({
        sourceId: current.sourceId,
        expectedSourceRevision: current.revision,
      });
      if (result.status === 'accepted') {
        setDetail((value) => {
          const next = value ? { ...value, ...result.source, failure: undefined } : value;
          detailRef.current = next;
          return next;
        });
      } else if (result.status === 'conflict')
        setError({ message: 'Source status changed. Reopen it before retrying.', action: 'Retry' });
      else {
        const copy = sourceErrorCopy(result.error);
        setError({ message: copy.message, sourceError: result.error, action: 'Retry' });
      }
    } catch {
      setError({
        message: 'Retry could not be started. Check the connection and try again.',
        action: 'Retry',
      });
    } finally {
      setBusy(false);
    }
  };
  const requestRemoval = async (token?: string) => {
    if (busy) return;
    const current = detail ?? source;
    setBusy(true);
    setError(null);
    try {
      const result = await api.removeSource({
        target: 'source',
        sourceId: current.sourceId,
        expectedSourceRevision: current.revision,
        ...(token ? { confirmationToken: token } : {}),
      });
      if (result.status === 'confirmation-required')
        setConfirmation({ token: result.confirmationToken, ...result.impact });
      else if (result.status === 'removed') {
        setConfirmation(null);
        onBack();
      } else if (result.status === 'referenced')
        setError({
          message: 'This source is still cited by a chapter and cannot be removed.',
          action: 'Removal',
        });
      else if (result.status === 'error') {
        const copy = sourceErrorCopy(result.error);
        setError({ message: copy.message, sourceError: result.error, action: 'Removal' });
      } else
        setError({
          message:
            'Source status changed or references could not be verified. Nothing was removed.',
          action: 'Removal',
        });
    } catch {
      setError({
        message: 'The source could not be removed. Check the connection and try again.',
        action: 'Removal',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid min-w-0 gap-4 p-6" aria-labelledby="source-detail-title">
      <header className="flex items-start gap-3 [&_h2]:m-0 [&_p]:m-0">
        <Button variant="ghost" size="icon" aria-label="Back to source library" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <h2 id="source-detail-title">{source.displayName}</h2>
          <p>
            {detail
              ? `${detail.parseSummary.blockCount} structured blocks`
              : 'Loading structured preview…'}
          </p>
        </div>
      </header>
      {error && (
        <StatusNotice tone="error">
          {error.action && <strong>{error.action} failed: </strong>}
          <span>{error.message}</span>
          {error.sourceError && <span> Reference code: {error.sourceError.code}.</span>}
        </StatusNotice>
      )}
      {detail && ['queued', 'parsing', 'indexing'].includes(detail.state) && (
        <div className="grid gap-2" role="status" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 text-sm font-medium">Processing status</h3>
            <span className="text-sm text-muted-foreground">{processingStageLabel(detail)}</span>
          </div>
          <progress
            className="w-full"
            value={detail.progress.completed}
            max={Math.max(1, detail.progress.total)}
            aria-label={`${detail.displayName} ${detail.progress.stage} progress`}
          />
          <p className="m-0 text-sm text-muted-foreground">{processingProgressLabel(detail)}</p>
        </div>
      )}
      {detail?.failure && (
        <div className="grid gap-2">
          <h3 className="m-0 text-sm font-medium">Processing failure</h3>
          <StatusNotice tone={detail.state === 'failed' ? 'error' : 'warning'}>
            <FileWarning aria-hidden="true" /> {sourceErrorCopy(detail.failure).message}
          </StatusNotice>
          <dl className="grid gap-1 text-sm">
            <div>
              <dt className="inline font-medium">Failure stage: </dt>
              <dd className="inline">{sourceFailureStageLabel(detail.failure.stage)}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Reference code: </dt>
              <dd className="inline">{detail.failure.code}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Affected scope: </dt>
              <dd className="inline">
                {detail.parseSummary.failedBlockCount > 0
                  ? `${detail.parseSummary.failedBlockCount} blocks failed; ${detail.parseSummary.indexedBlockCount} remain searchable.`
                  : 'The current source version.'}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">Automatic retry: </dt>
              <dd className="inline">
                {detail.retrying
                  ? 'In progress.'
                  : detail.retryable
                    ? 'Automatic attempts ended; manual retry is available.'
                    : 'Not available for this failure.'}
              </dd>
            </div>
          </dl>
          {sourceErrorCopy(detail.failure).action === 'settings' && onOpenSettings && (
            <div>
              <Button type="button" variant="secondary" onClick={onOpenSettings}>
                Open Settings
              </Button>
            </div>
          )}
        </div>
      )}
      {detail && (
        <dl className="my-4 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3 [&_div]:bg-card [&_div]:p-3 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:mt-1 [&_dd]:break-words [&_dd]:font-medium">
          <div>
            <dt>Version</dt>
            <dd>{detail.sourceVersionId}</dd>
          </div>
          <div>
            <dt>Blocks</dt>
            <dd>{detail.parseSummary.blockCount}</dd>
          </div>
          <div>
            <dt>Indexed</dt>
            <dd>{detail.parseSummary.indexedBlockCount}</dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd>{detail.parseSummary.failedBlockCount}</dd>
          </div>
          <div>
            <dt>Incomplete</dt>
            <dd>{detail.parseSummary.incompleteBlockCount}</dd>
          </div>
          <div>
            <dt>Search eligibility</dt>
            <dd>
              {detail.state === 'available'
                ? 'Searchable'
                : detail.state === 'partial'
                  ? 'Limited to indexed blocks'
                  : 'Not searchable yet'}
            </dd>
          </div>
        </dl>
      )}
      {detail && (
        <fieldset className="my-4 flex flex-wrap items-center gap-2">
          <legend>Source content form</legend>
          <Button
            type="button"
            variant={mode === 'original-pdf' ? 'default' : 'secondary'}
            aria-pressed={mode === 'original-pdf'}
            disabled={!detail.parseSummary.originalPreviewAvailable}
            onClick={() => setMode('original-pdf')}
          >
            Original PDF
          </Button>
          <Button
            type="button"
            variant={mode === 'structured-markdown' ? 'default' : 'secondary'}
            aria-pressed={mode === 'structured-markdown'}
            disabled={!detail.parseSummary.markdownAvailable}
            onClick={() => setMode('structured-markdown')}
          >
            Processed Markdown
          </Button>
        </fieldset>
      )}
      {detail && mode === 'original-pdf' && detail.parseSummary.originalPreviewAvailable ? (
        <SourcePdfPreview sourceId={detail.sourceId} sourceVersionId={detail.sourceVersionId} />
      ) : (
        <div className="typeset-compact grid gap-4">
          {blocks.map((block) => (
            <article
              key={block.chunkId}
              className={
                block.searchable ? 'min-w-0 border p-4' : 'min-w-0 border border-dashed p-4'
              }
            >
              <span className="text-xs text-muted-foreground">
                Block {block.ordinal + 1} · {block.blockType}
              </span>
              <pre className="my-2 whitespace-pre-wrap break-words font-inherit">
                {block.markdown}
              </pre>
              {block.media.map((media) =>
                media.available ? (
                  <img
                    key={media.mediaId}
                    src={`writellm-source://${encodeURIComponent(source.sourceId)}/${encodeURIComponent(media.mediaId)}`}
                    alt={media.alt}
                    loading="lazy"
                    className="h-auto max-w-full"
                  />
                ) : (
                  <p key={media.mediaId} role="note">
                    Referenced media is unavailable.
                  </p>
                ),
              )}
              {!block.searchable && (
                <p className="text-xs text-muted-foreground">
                  Not yet searchable or structurally ineligible.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {nextCursor && (
        <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>
          Load more blocks
        </Button>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          busy={busy}
          disabled={
            detail?.retrying ||
            (!detail?.retryable && detail?.state !== 'partial' && detail?.state !== 'failed')
          }
          onClick={() => void retry()}
        >
          <RotateCcw aria-hidden="true" /> Retry failed work
        </Button>
        <Button variant="destructive" busy={busy} onClick={() => void requestRemoval()}>
          <Trash2 aria-hidden="true" /> Remove source
        </Button>
      </div>
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Remove {source.displayName}?</DialogTitle>
          <DialogDescription>
            This removes {confirmation?.searchableBlockCount ?? 0} searchable blocks and supersedes{' '}
            {confirmation?.activeJobCount ?? 0} active jobs. Chapter text will not be changed. Local
            removal does not contact MinerU and is not blocked by a processing failure.
          </DialogDescription>
          <Button
            variant="destructive"
            busy={busy}
            onClick={() => confirmation && void requestRemoval(confirmation.token)}
          >
            Remove source
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
            Keep source
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function processingStageLabel(source: SourceDetailModel): string {
  if (source.state === 'queued') return source.retrying ? 'Retry queued' : 'Queued';
  if (source.state === 'parsing') return source.retrying ? 'Retrying parsing' : 'Parsing PDF';
  return source.retrying ? 'Retrying indexing' : 'Indexing content';
}

function processingProgressLabel(source: SourceDetailModel): string {
  if (source.state === 'queued') return 'Waiting for a processing worker.';
  if (source.progress.stage === 'parsing')
    return `${source.progress.completed}% parsed${source.retrying ? '; automatic retry is active' : ''}.`;
  const remaining = Math.max(0, source.progress.total - source.progress.completed);
  return `${source.progress.completed} of ${source.progress.total} blocks processed; ${remaining} remaining.`;
}
