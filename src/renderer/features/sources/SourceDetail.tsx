import { ArrowLeft, FileWarning, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type {
  BlockPreview,
  SourceDetail as SourceDetailModel,
  SourceSummary,
  SourcesApi,
} from '../../../shared/sources';

export function SourceDetail({
  api,
  source,
  onBack,
}: {
  api: SourcesApi;
  source: SourceSummary;
  onBack(): void;
}) {
  const [detail, setDetail] = useState<SourceDetailModel | null>(null);
  const [blocks, setBlocks] = useState<BlockPreview[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    token: string;
    activeJobCount: number;
    searchableBlockCount: number;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void api.getSource({ sourceId: source.sourceId, limit: 100 }).then((result) => {
      if (!current) return;
      if (result.status === 'ok') {
        setDetail(result.source);
        setBlocks(result.blocks);
        setNextCursor(result.nextCursor);
      } else setError('This source preview could not be loaded safely.');
    });
    return () => {
      current = false;
    };
  }, [api, source.sourceId]);
  const loadMore = async () => {
    if (!nextCursor) return;
    const result = await api.getSource({
      sourceId: source.sourceId,
      cursor: nextCursor,
      limit: 100,
    });
    if (result.status === 'ok') {
      setBlocks((current) => [...current, ...result.blocks]);
      setNextCursor(result.nextCursor);
    }
  };
  const retry = async () => {
    const current = detail ?? source;
    setBusy(true);
    setError('');
    const result = await api.retrySource({
      sourceId: current.sourceId,
      expectedSourceRevision: current.revision,
    });
    setBusy(false);
    if (result.status === 'accepted')
      setDetail((value) => (value ? { ...value, ...result.source } : value));
    else
      setError(
        result.status === 'conflict'
          ? 'Source status changed. Reopen it before retrying.'
          : 'Retry could not be started safely.',
      );
  };
  const requestRemoval = async (token?: string) => {
    const current = detail ?? source;
    setBusy(true);
    setError('');
    const result = await api.removeSource({
      target: 'source',
      sourceId: current.sourceId,
      expectedSourceRevision: current.revision,
      ...(token ? { confirmationToken: token } : {}),
    });
    setBusy(false);
    if (result.status === 'confirmation-required')
      setConfirmation({ token: result.confirmationToken, ...result.impact });
    else if (result.status === 'removed') {
      setConfirmation(null);
      onBack();
    } else if (result.status === 'referenced')
      setError('This source is still cited by a chapter and cannot be removed.');
    else
      setError('Source status changed or references could not be verified. Nothing was removed.');
  };
  return (
    <section className="source-detail" aria-labelledby="source-detail-title">
      <header className="source-detail__header">
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
      {error && <StatusNotice tone="error">{error}</StatusNotice>}
      {detail?.failure && (
        <StatusNotice tone="warning">
          <FileWarning aria-hidden="true" /> Some content could not be processed. Valid blocks
          remain available.
        </StatusNotice>
      )}
      <div className="source-detail__blocks typeset-compact">
        {blocks.map((block) => (
          <article
            key={block.chunkId}
            className={`source-block ${block.searchable ? 'source-block--searchable' : 'source-block--ineligible'}`}
          >
            <span className="source-block__ordinal">
              Block {block.ordinal + 1} · {block.blockType}
            </span>
            <pre className="source-block__markdown">{block.markdown}</pre>
            {block.media.map((media) =>
              media.available ? (
                <img
                  key={media.mediaId}
                  src={`writellm-source://${encodeURIComponent(source.sourceId)}/${encodeURIComponent(media.mediaId)}`}
                  alt={media.alt}
                  loading="lazy"
                />
              ) : (
                <p key={media.mediaId} role="note">
                  Referenced media is unavailable.
                </p>
              ),
            )}
            {!block.searchable && (
              <p className="source-block__eligibility">
                Not yet searchable or structurally ineligible.
              </p>
            )}
          </article>
        ))}
      </div>
      {nextCursor && (
        <Button variant="secondary" onClick={() => void loadMore()}>
          Load more blocks
        </Button>
      )}
      <div className="source-detail__actions">
        <Button
          variant="secondary"
          busy={busy}
          disabled={!detail?.retryable && detail?.state !== 'partial' && detail?.state !== 'failed'}
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
            {confirmation?.activeJobCount ?? 0} active jobs. Chapter text will not be changed.
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
