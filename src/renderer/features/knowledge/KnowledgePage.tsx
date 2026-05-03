import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, FileUp, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '../../components/ui/popover';
import { Textarea } from '../../components/ui/textarea';
import type {
  KnowledgeDebugDetails,
  KnowledgeIngestJobRecord,
  KnowledgeIngestStatus,
  KnowledgeItemRecord
} from '../../../shared/types';

export function KnowledgePage({
  items,
  ingestJobs,
  onCreate,
  onImportFiles,
  onUpdate,
  onDelete,
  onReindex,
  onRetryIngest,
  onDeleteIngest,
  debugEnabled,
  onDebugError
}: {
  items: KnowledgeItemRecord[];
  ingestJobs: KnowledgeIngestJobRecord[];
  onCreate: (title: string, content: string) => void;
  onImportFiles: () => void;
  onUpdate: (itemId: string, title: string, content: string) => void;
  onDelete: (itemId: string) => void;
  onReindex: (itemId: string) => void;
  onRetryIngest: (jobId: string) => void;
  onDeleteIngest: (jobId: string) => void;
  debugEnabled: boolean;
  onDebugError: (message: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [debugDetails, setDebugDetails] = useState<KnowledgeDebugDetails | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const onDebugErrorRef = useRef(onDebugError);
  const isCreating = !selected;

  useEffect(() => {
    onDebugErrorRef.current = onDebugError;
  }, [onDebugError]);

  useEffect(() => {
    if (!selected && selectedId) {
      setSelectedId(null);
    }
  }, [selected, selectedId]);

  useEffect(() => {
    setTitle(selected?.title ?? '');
    setContent(selected?.content ?? '');
  }, [selected?.id]);

  const indexedCount = useMemo(
    () => items.filter((item) => item.indexStatus === 'indexed').length,
    [items]
  );
  const visibleIngestJobs = useMemo(() => {
    return ingestJobs.filter((job) => job.status !== 'indexed');
  }, [ingestJobs]);
  const debugRefreshKey = useMemo(
    () => items.map((item) => `${item.id}:${item.indexStatus}:${item.updatedAt}`).join('|'),
    [items]
  );
  const selectedDebug = selected
    ? debugDetails?.items.find((item) => item.itemId === selected.id) ?? null
    : null;

  useEffect(() => {
    if (!debugEnabled) {
      setDebugDetails(null);
      setDebugLoading(false);
      return;
    }

    let isCurrent = true;
    setDebugLoading(true);
    void getApi()
      .getKnowledgeDebugDetails()
      .then((details) => {
        if (isCurrent) {
          setDebugDetails(details);
        }
      })
      .catch((caught) => {
        if (isCurrent) {
          onDebugErrorRef.current(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setDebugLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [debugEnabled, debugRefreshKey]);

  function save() {
    if (selected) {
      onUpdate(selected.id, title, content);
      return;
    }
    onCreate(title || 'Knowledge source', content);
  }

  function startNew() {
    setSelectedId(null);
    setTitle('');
    setContent('');
  }

  return (
    <main className="knowledge-page">
      <aside className="knowledge-page-sidebar">
        <div className="knowledge-page-header">
          <div>
            <h1>Knowledge</h1>
            <p>{indexedCount} indexed / {items.length} total</p>
          </div>
          <div className="button-row">
            <Button variant="outline" size="sm" onClick={onImportFiles}>
              <FileUp />
              Import
            </Button>
            <Button size="sm" onClick={startNew}>
              <Plus />
              New
            </Button>
          </div>
        </div>
        {items.length > 0 || visibleIngestJobs.length > 0 ? (
          <div className="knowledge-sidebar-scroll">
            {visibleIngestJobs.length > 0 ? (
              <div className="knowledge-ingest-list">
                <p>Import queue</p>
                {visibleIngestJobs.map((job) => (
                  <div key={job.id} className="knowledge-ingest-job">
                    <div className="knowledge-ingest-job-heading">
                      <span className="knowledge-source-title">{job.fileName}</span>
                      <KnowledgeIngestStatusPopover job={job} />
                    </div>
                    {job.errorMessage ? (
                      <span className="knowledge-source-preview">{job.errorMessage}</span>
                    ) : (
                      <span className="knowledge-source-preview">{formatFileSize(job.fileSize)} {job.fileExt}</span>
                    )}
                    <div className="button-row">
                      {job.status === 'error' ? (
                        <Button variant="outline" size="sm" onClick={() => onRetryIngest(job.id)}>
                          <RefreshCw />
                          Retry
                        </Button>
                      ) : null}
                      <Button variant="destructive" size="sm" onClick={() => onDeleteIngest(job.id)}>
                        <Trash2 />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {items.length > 0 ? (
              <div className="knowledge-source-list">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={selected?.id === item.id ? 'active' : undefined}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="knowledge-source-title">{item.title}</span>
                    <span className={`knowledge-source-status ${item.indexStatus}`}>{item.indexStatus}</span>
                    <span className="knowledge-source-preview">{previewText(item.content)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="knowledge-empty">
            <h2>No sources</h2>
            <p>Add text sources or import files to make them available during generation.</p>
            <div className="button-row">
              <Button variant="outline" size="sm" onClick={onImportFiles}>
                <FileUp />
                Import files
              </Button>
              <Button size="sm" onClick={startNew}>
                <Plus />
                Add source
              </Button>
            </div>
          </div>
        )}
      </aside>

      <section className="knowledge-editor">
        <div className="knowledge-editor-header">
          <div>
            <p>{isCreating ? 'New source' : selected.indexStatus}</p>
            <h2>{isCreating ? 'Add knowledge source' : selected.title}</h2>
          </div>
          <div className="button-row">
            <Button size="sm" onClick={save} disabled={!content.trim()}>
              <Save />
              Save
            </Button>
            {selected ? (
              <>
                <Button variant="outline" size="sm" onClick={() => onReindex(selected.id)}>
                  <RefreshCw />
                  Reindex
                </Button>
                <Button variant="destructive" size="sm" onClick={() => onDelete(selected.id)}>
                  <Trash2 />
                  Delete
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="knowledge-editor-fields">
          <label className="field-label">
            Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field-label knowledge-text-field">
            Source text
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste source text for retrieval"
            />
          </label>
          {debugEnabled ? (
            <section className="knowledge-debug-panel">
              <div className="knowledge-debug-heading">
                <div>
                  <h3>Debug</h3>
                  <p>
                    {debugDetails
                      ? `chunk target ${debugDetails.chunking.targetChars}, overlap ${debugDetails.chunking.overlapChars}, embedding batch ${debugDetails.chunking.embeddingBatchSize}`
                      : 'Loading indexing details'}
                  </p>
                </div>
                {debugLoading ? <span>Refreshing</span> : null}
              </div>
              {selectedDebug ? (
                <>
                  <div className="knowledge-debug-summary">
                    <span>{selectedDebug.contentLength} chars</span>
                    <span>{selectedDebug.chunkCount} chunks</span>
                    <span>{selectedDebug.indexStatus}</span>
                  </div>
                  <div className="knowledge-debug-chunks">
                    {selectedDebug.chunks.length > 0 ? (
                      selectedDebug.chunks.map((chunk) => (
                        <details key={chunk.id} className="knowledge-debug-chunk">
                          <summary>
                            <span>Chunk {chunk.chunkIndex + 1}</span>
                            <span>{chunk.contentLength} chars</span>
                            <span>{chunk.embeddingDimensions} dims</span>
                          </summary>
                          <div className="knowledge-debug-chunk-body">
                            <p>
                              Embedding model: {chunk.embeddingModel ?? 'none'} - norm:{' '}
                              {chunk.embeddingNorm === null ? 'none' : chunk.embeddingNorm}
                            </p>
                            <code>
                              [{chunk.embeddingPreview.map((value) => formatDebugNumber(value)).join(', ')}]
                            </code>
                            <pre>{chunk.content}</pre>
                          </div>
                        </details>
                      ))
                    ) : (
                      <p className="muted">No chunks stored for this source.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="muted">
                  {selected ? 'No debug details available for this source yet.' : 'Save a source to inspect its chunks.'}
                </p>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function previewText(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return 'Empty source';
  }
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDebugNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function KnowledgeIngestStatusPopover({ job }: { job: KnowledgeIngestJobRecord }) {
  const status = getKnowledgeIngestStatusView(job.status);
  const StatusIcon = status.icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`knowledge-ingest-status-button ${job.status}`}
          aria-label={`${status.label} import task details for ${job.fileName}`}
          title={status.label}
        >
          <StatusIcon className={status.spin ? 'animate-spin' : undefined} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="knowledge-ingest-popover">
        <PopoverHeader>
          <PopoverTitle>{job.fileName}</PopoverTitle>
          <PopoverDescription>{status.label}</PopoverDescription>
        </PopoverHeader>
        <dl className="knowledge-ingest-details">
          <div>
            <dt>File</dt>
            <dd>{formatFileSize(job.fileSize)} {job.fileExt}</dd>
          </div>
          <div>
            <dt>Path</dt>
            <dd>{job.filePath}</dd>
          </div>
          <div>
            <dt>Queued</dt>
            <dd>{formatDateTime(job.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(job.updatedAt)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatDateTime(job.startedAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{formatDateTime(job.finishedAt)}</dd>
          </div>
          {job.knowledgeItemId ? (
            <div>
              <dt>Source ID</dt>
              <dd>{job.knowledgeItemId}</dd>
            </div>
          ) : null}
          {job.errorMessage ? (
            <div>
              <dt>Error</dt>
              <dd>{job.errorMessage}</dd>
            </div>
          ) : null}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function getKnowledgeIngestStatusView(status: KnowledgeIngestStatus) {
  switch (status) {
    case 'queued':
      return { label: 'Queued', icon: Clock3, spin: false };
    case 'extracting':
      return { label: 'Extracting', icon: LoaderCircle, spin: true };
    case 'indexing':
      return { label: 'Indexing', icon: LoaderCircle, spin: true };
    case 'indexed':
      return { label: 'Indexed', icon: CheckCircle2, spin: false };
    case 'error':
      return { label: 'Error', icon: CircleAlert, spin: false };
  }
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Not set';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}
