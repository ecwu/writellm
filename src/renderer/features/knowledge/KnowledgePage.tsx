import { isValidElement, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileUp,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X
} from 'lucide-react';
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
import { ScrollArea } from '../../components/ui/scroll-area';
import { Skeleton } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import type {
  KnowledgeDebugDetails,
  KnowledgeIngestJobRecord,
  KnowledgeIngestStatus,
  KnowledgeItemRecord,
  KnowledgeSourceTarget
} from '../../../shared/types';

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ['className', /^language-./, 'math-inline', 'math-display']
    ]
  }
};

const PREVIEW_SAMPLE_CHARS = 2000;
const LAZY_RENDER_ROOT_MARGIN = '480px 0px';

export function KnowledgePage({
  items,
  ingestJobs,
  workspacePath,
  targetSource,
  onTargetConsumed,
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
  workspacePath: string | null;
  targetSource: KnowledgeSourceTarget | null;
  onTargetConsumed: () => void;
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
  const [isCreatingSource, setIsCreatingSource] = useState(false);
  const selected = isCreatingSource ? null : items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [debugDetails, setDebugDetails] = useState<KnowledgeDebugDetails | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [readerRenderKey, setReaderRenderKey] = useState<string | null>(null);
  const onDebugErrorRef = useRef(onDebugError);
  const isCreating = !selected;
  const selectedReaderKey = selected ? `${selected.id}:${selected.updatedAt}` : null;
  const readerReady = Boolean(selectedReaderKey && readerRenderKey === selectedReaderKey);

  useEffect(() => {
    onDebugErrorRef.current = onDebugError;
  }, [onDebugError]);

  useEffect(() => {
    if (!targetSource) {
      return;
    }
    setIsCreatingSource(false);
    setSelectedId(targetSource.itemId);
    setIsEditing(false);
    onTargetConsumed();
  }, [onTargetConsumed, targetSource?.chunkId, targetSource?.itemId]);

  useEffect(() => {
    if (!selected && selectedId) {
      setSelectedId(null);
    }
    if (selected && isCreatingSource) {
      setIsCreatingSource(false);
    }
  }, [isCreatingSource, selected, selectedId]);

  useEffect(() => {
    if (isCreatingSource) {
      return;
    }
    setTitle(selected?.title ?? '');
    setContent(selected?.content ?? '');
    setIsEditing(false);
  }, [isCreatingSource, selected?.id]);

  useEffect(() => {
    if (!selectedReaderKey || isCreatingSource || isEditing) {
      setReaderRenderKey(null);
      return;
    }

    setReaderRenderKey(null);
    const timeoutId = window.setTimeout(() => {
      setReaderRenderKey(selectedReaderKey);
    }, 16);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCreatingSource, isEditing, selectedReaderKey]);

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
      setIsEditing(false);
      return;
    }
    onCreate(title || 'Knowledge source', content);
    setIsCreatingSource(false);
    setIsEditing(false);
  }

  function startNew() {
    setIsCreatingSource(true);
    setSelectedId(null);
    setTitle('');
    setContent('');
    setIsEditing(true);
  }

  function cancelEdit() {
    setTitle(selected?.title ?? '');
    setContent(selected?.content ?? '');
    setIsEditing(false);
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
          <ScrollArea className="knowledge-sidebar-scroll">
            <div className="knowledge-sidebar-scroll-content">
              {visibleIngestJobs.length > 0 ? (
                <div className="knowledge-ingest-list">
                  <p>Import queue</p>
                  {visibleIngestJobs.map((job) => {
                    const progress = getKnowledgeIngestProgressView(job);
                    return (
                      <div key={job.id} className="knowledge-ingest-job">
                        <div className="knowledge-ingest-job-heading">
                          <span className="knowledge-source-title">{job.fileName}</span>
                          <KnowledgeIngestStatusPopover job={job} />
                        </div>
                        {job.errorMessage ? (
                          <span className="knowledge-source-preview">{job.errorMessage}</span>
                        ) : (
                          <span className="knowledge-source-preview">
                            {progress?.label ?? `${formatFileSize(job.fileSize)} ${job.fileExt}`}
                          </span>
                        )}
                        {progress && progress.percent !== null ? (
                          <div
                            className="knowledge-ingest-progress"
                            aria-label={progress.label}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress.percent}
                          >
                            <span style={{ width: `${progress.percent}%` }} />
                          </div>
                        ) : null}
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
                    );
                  })}
                </div>
              ) : null}
              {items.length > 0 ? (
                <div className="knowledge-source-list">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={selected?.id === item.id ? 'active' : undefined}
                      onClick={() => {
                        setIsCreatingSource(false);
                        setSelectedId(item.id);
                      }}
                    >
                      <span className="knowledge-source-title">{knowledgeDisplayTitle(item)}</span>
                      <span className={`knowledge-source-status ${item.indexStatus}`}>{item.indexStatus}</span>
                      <span className="knowledge-source-preview">{knowledgeDisplayDescription(item)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </ScrollArea>
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
            {isCreating || isEditing ? (
              <>
                <Button size="sm" onClick={save} disabled={!content.trim()}>
                  <Save />
                  Save
                </Button>
                {selected ? (
                  <Button variant="outline" size="sm" onClick={cancelEdit}>
                    <X />
                    Cancel
                  </Button>
                ) : null}
              </>
            ) : null}
            {selected && !isEditing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Pencil />
                  Edit
                </Button>
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

        {isCreating || isEditing ? (
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
              <KnowledgeDebugPanel
                debugDetails={debugDetails}
                debugLoading={debugLoading}
                selected={selected}
                selectedDebug={selectedDebug}
              />
            ) : null}
          </div>
        ) : selected ? (
          <ScrollArea className="knowledge-reader-scroll">
            <div className="knowledge-reader">
              {hasReadableContent(selected.content) ? (
                readerReady ? (
                  <MarkdownTypography content={selected.content} item={selected} workspacePath={workspacePath} />
                ) : (
                  <KnowledgeReaderSkeleton />
                )
              ) : (
                <p className="text-sm text-muted-foreground">This source has no content.</p>
              )}
              {debugEnabled ? (
                <KnowledgeDebugPanel
                  debugDetails={debugDetails}
                  debugLoading={debugLoading}
                  selected={selected}
                  selectedDebug={selectedDebug}
                />
              ) : null}
            </div>
          </ScrollArea>
        ) : (
          <div className="knowledge-empty">
            <h2>No source selected</h2>
            <p>Select a source or add a new one.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function KnowledgeReaderSkeleton() {
  return (
    <div className="knowledge-reader-skeleton" aria-label="Loading source preview">
      <Skeleton className="knowledge-reader-skeleton-title" />
      <Skeleton className="knowledge-reader-skeleton-line wide" />
      <Skeleton className="knowledge-reader-skeleton-line" />
      <Skeleton className="knowledge-reader-skeleton-line medium" />
      <Skeleton className="knowledge-reader-skeleton-block" />
      <Skeleton className="knowledge-reader-skeleton-line wide" />
      <Skeleton className="knowledge-reader-skeleton-line short" />
    </div>
  );
}

function KnowledgeDebugPanel({
  debugDetails,
  debugLoading,
  selected,
  selectedDebug
}: {
  debugDetails: KnowledgeDebugDetails | null;
  debugLoading: boolean;
  selected: KnowledgeItemRecord | null;
  selectedDebug: KnowledgeDebugDetails['items'][number] | null;
}) {
  return (
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
            <span>{selectedDebug.publicRef}</span>
            <span>{selectedDebug.contentLength} chars</span>
            <span>{selectedDebug.chunkCount} chunks</span>
            <span>{selectedDebug.indexStatus}</span>
          </div>
          {selected ? <KnowledgeDisplayMetadataDebug item={selected} /> : null}
          <div className="knowledge-debug-chunks">
            {selectedDebug.chunks.length > 0 ? (
              selectedDebug.chunks.map((chunk) => (
                <details key={chunk.id} className="knowledge-debug-chunk">
                  <summary>
                    <span>{chunk.publicRef}</span>
                    <span>{chunk.contentLength} chars</span>
                    <span>{chunk.embeddingDimensions} dims</span>
                  </summary>
                  <div className="knowledge-debug-chunk-body">
                    <p>
                      Embedding model: {chunk.embeddingModel ?? 'none'} - norm:{' '}
                      {chunk.embeddingNorm === null ? 'none' : chunk.embeddingNorm}
                    </p>
                    <code>[{chunk.embeddingPreview.map((value) => formatDebugNumber(value)).join(', ')}]</code>
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
  );
}

function KnowledgeDisplayMetadataDebug({ item }: { item: KnowledgeItemRecord }) {
  const metadata = readKnowledgeDisplayMetadata(item);
  const error = typeof item.metadata.knowledgeDisplayMetadataError === 'string'
    ? item.metadata.knowledgeDisplayMetadataError.trim()
    : '';
  if (!metadata.title && !metadata.description && !error) {
    return null;
  }
  return (
    <div className="knowledge-display-metadata-debug">
      <span>LLM metadata</span>
      {metadata.title ? <p>{metadata.title}</p> : null}
      {metadata.description ? <p>{metadata.description}</p> : null}
      {error ? <code>{error}</code> : null}
    </div>
  );
}

const MarkdownTypography = memo(function MarkdownTypography({
  content,
  item,
  workspacePath
}: {
  content: string;
  item: KnowledgeItemRecord;
  workspacePath: string | null;
}) {
  return (
    <article className="knowledge-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        components={{
          a({ href, children }) {
            const safeHref = getSafeMarkdownHref(href ?? '');
            return (
              <a href={safeHref} target={safeHref.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
                {children}
              </a>
            );
          },
          code({ className, children }) {
            const mathMode = getMarkdownMathMode(className);
            if (mathMode) {
              return (
                <LazyTeX
                  displayMode={mathMode === 'display'}
                  source={childrenToText(children)}
                />
              );
            }
            return <code className={className}>{children}</code>;
          },
          img({ alt, src }) {
            const source = src ? resolveMarkdownImageSource(src, item, workspacePath) : null;
            return source
              ? <KnowledgeMarkdownImage alt={alt ?? ''} className="knowledge-markdown-image" source={source} />
              : <span className="knowledge-markdown-image-placeholder">{alt || src || 'Image unavailable'}</span>;
          },
          pre({ children }) {
            if (isDisplayMathPre(children)) {
              return <>{children}</>;
            }
            return <pre>{children}</pre>;
          },
          table({ children }) {
            return (
              <div className="knowledge-markdown-table-wrap">
                <table>{children}</table>
              </div>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}, areMarkdownTypographyPropsEqual);

function areMarkdownTypographyPropsEqual(
  previous: {
    content: string;
    item: KnowledgeItemRecord;
    workspacePath: string | null;
  },
  next: {
    content: string;
    item: KnowledgeItemRecord;
    workspacePath: string | null;
  }
) {
  return (
    previous.content === next.content &&
    previous.item.id === next.item.id &&
    previous.item.updatedAt === next.item.updatedAt &&
    previous.workspacePath === next.workspacePath
  );
}

function getMarkdownMathMode(className: string | undefined): 'inline' | 'display' | null {
  if (!className) {
    return null;
  }
  if (className.includes('math-display')) {
    return 'display';
  }
  if (className.includes('math-inline')) {
    return 'inline';
  }
  return null;
}

function childrenToText(children: ReactNode): string {
  if (Array.isArray(children)) {
    return children.map(childrenToText).join('');
  }
  if (children === null || children === undefined || typeof children === 'boolean') {
    return '';
  }
  return String(children);
}

function isDisplayMathPre(children: ReactNode): boolean {
  if (!isValidElement<{ className?: string }>(children)) {
    return false;
  }
  return getMarkdownMathMode(children.props.className) === 'display';
}

function useInViewport(ref: { current: Element | null }): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isVisible) {
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }
    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: LAZY_RENDER_ROOT_MARGIN }
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isVisible, ref]);

  return isVisible;
}

function LazyTeX({ source, displayMode }: { source: string; displayMode: boolean }) {
  const ref = useRef<Element | null>(null);
  const isVisible = useInViewport(ref);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let isCurrent = true;
    setFailed(false);
    void import('katex')
      .then((module) => {
        const katex = module.default ?? module;
        const rendered = katex.renderToString(source, {
          displayMode,
          strict: false,
          throwOnError: false
        });
        if (isCurrent) {
          setHtml(rendered);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setFailed(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [displayMode, isVisible, source]);

  const className = displayMode ? 'knowledge-math-display' : 'knowledge-math-inline';
  const Element = displayMode ? 'div' : 'span';
  if (html) {
    return <Element className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <Element ref={(element) => { ref.current = element; }} className={`${className} knowledge-math-placeholder`}>
      {failed ? source : ''}
    </Element>
  );
}

type MarkdownImageSource =
  | { kind: 'url'; src: string }
  | { kind: 'asset'; relativePath: string };

function KnowledgeMarkdownImage({
  alt,
  className,
  source
}: {
  alt: string;
  className: string;
  source: MarkdownImageSource;
}) {
  const imageRef = useRef<Element | null>(null);
  const isVisible = useInViewport(imageRef);
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let isCurrent = true;
    if (source.kind === 'url') {
      setSrc(source.src);
      return;
    }
    setSrc('');
    void getApi()
      .getWorkspaceAssetDataUrl(source.relativePath)
      .then((dataUrl) => {
        if (isCurrent) {
          setSrc(dataUrl);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setSrc('');
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [isVisible, source.kind, source.kind === 'url' ? source.src : source.relativePath]);

  if (!src) {
    return (
      <span ref={(element) => { imageRef.current = element; }} className="knowledge-markdown-image-placeholder">
        {alt || 'Loading image'}
      </span>
    );
  }
  return (
    <img
      ref={(element) => { imageRef.current = element; }}
      alt={alt}
      className={className}
      loading="lazy"
      src={src}
    />
  );
}

function resolveMarkdownImageSource(
  rawSrc: string,
  item: KnowledgeItemRecord,
  workspacePath: string | null
): MarkdownImageSource | null {
  const src = rawSrc.trim();
  if (!src) {
    return null;
  }
  if (/^(https?:|data:)/i.test(src)) {
    return { kind: 'url', src };
  }
  if (src.startsWith('#')) {
    return null;
  }
  if (/^file:/i.test(src)) {
    const localPath = fileUrlToPath(src);
    if (!localPath || !workspacePath) {
      return null;
    }
    const relativePath = toWorkspaceRelativePath(workspacePath, localPath);
    return relativePath?.startsWith('assets/') ? { kind: 'asset', relativePath } : null;
  }
  if (isAbsoluteLocalPath(src)) {
    if (!workspacePath) {
      return null;
    }
    const relativePath = toWorkspaceRelativePath(workspacePath, src);
    return relativePath?.startsWith('assets/') ? { kind: 'asset', relativePath } : null;
  }
  if (!workspacePath) {
    return null;
  }

  const baseDirectory = getMineruMarkdownDirectory(item) ?? getMineruOutputDirectory(item);
  const workspaceRelativePath = baseDirectory ? joinPath(baseDirectory, src) : src;
  return workspaceRelativePath.startsWith('assets/')
    ? { kind: 'asset', relativePath: workspaceRelativePath }
    : null;
}

function getMineruMarkdownDirectory(item: KnowledgeItemRecord): string | null {
  const mineru = item.metadata.mineru;
  if (!mineru || typeof mineru !== 'object') {
    return null;
  }
  const markdownPath = (mineru as Record<string, unknown>).markdownPath;
  if (typeof markdownPath !== 'string' || !markdownPath.trim()) {
    return null;
  }
  const normalized = markdownPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
}

function getMineruOutputDirectory(item: KnowledgeItemRecord): string | null {
  const mineru = item.metadata.mineru;
  if (!mineru || typeof mineru !== 'object') {
    return null;
  }
  const outputDirectory = (mineru as Record<string, unknown>).outputDirectory;
  return typeof outputDirectory === 'string' && outputDirectory.trim() ? outputDirectory : null;
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function joinPath(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/, '')}/${right.replace(/^[\\/]+/, '')}`;
}

function fileUrlToPath(value: string): string | null {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return null;
  }
}

function toWorkspaceRelativePath(workspacePath: string, filePath: string): string | null {
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (!normalizedFile.startsWith(`${normalizedWorkspace}/`)) {
    return null;
  }
  return normalizedFile.slice(normalizedWorkspace.length + 1);
}

function getSafeMarkdownHref(href: string): string {
  const trimmed = href.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  return '#';
}

function hasReadableContent(content: string): boolean {
  return /\S/.test(content);
}

function previewText(content: string): string {
  const sample = content.slice(0, PREVIEW_SAMPLE_CHARS);
  const withoutHeading = sample
    .replace(/^#{1,6}\s+.+$/m, '')
    .trim();
  const trimmed = (withoutHeading || sample).trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return 'Empty source';
  }
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

function knowledgeDisplayTitle(item: KnowledgeItemRecord): string {
  const metadata = readKnowledgeDisplayMetadata(item);
  return metadata.title || item.title;
}

function knowledgeDisplayDescription(item: KnowledgeItemRecord): string {
  const metadata = readKnowledgeDisplayMetadata(item);
  return metadata.description || previewText(item.content);
}

function readKnowledgeDisplayMetadata(item: KnowledgeItemRecord): { title: string; description: string } {
  const metadata = item.metadata.knowledgeDisplayMetadata ?? item.metadata.knowledgeMetadata;
  if (!metadata || typeof metadata !== 'object') {
    return { title: '', description: '' };
  }
  const record = metadata as Record<string, unknown>;
  return {
    title: typeof record.title === 'string' ? record.title.trim() : '',
    description: typeof record.description === 'string' ? record.description.trim() : ''
  };
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

type KnowledgeIngestProgressView = {
  label: string;
  percent: number | null;
};

function getKnowledgeIngestProgressView(
  job: KnowledgeIngestJobRecord,
  options: { includeInactive?: boolean } = {}
): KnowledgeIngestProgressView | null {
  if (!options.includeInactive && job.status !== 'extracting') {
    return null;
  }
  const mineru = readMineruIngestMetadata(job);
  if (!mineru) {
    return null;
  }
  const extractProgress = readRecord(mineru.extractProgress);
  const extractedPages = readFiniteNumber(extractProgress?.extractedPages ?? mineru.extractedPages);
  const totalPages = readFiniteNumber(extractProgress?.totalPages ?? mineru.totalPages);
  if (extractedPages !== null || totalPages !== null) {
    const label = totalPages !== null
      ? `Extracting ${extractedPages ?? 0} / ${totalPages} pages`
      : `Extracted ${extractedPages} pages`;
    return {
      label,
      percent: extractedPages !== null && totalPages !== null && totalPages > 0
        ? clampPercent((extractedPages / totalPages) * 100)
        : null
    };
  }

  const progress = readFiniteNumber(mineru.progress);
  if (progress === null) {
    return null;
  }
  const percent = progress > 0 && progress <= 1 ? progress * 100 : progress;
  return {
    label: `Extracting ${clampPercent(percent)}%`,
    percent: clampPercent(percent)
  };
}

function readMineruIngestMetadata(job: KnowledgeIngestJobRecord): Record<string, unknown> | null {
  return readRecord(job.metadata.mineru);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function KnowledgeIngestStatusPopover({ job }: { job: KnowledgeIngestJobRecord }) {
  const status = getKnowledgeIngestStatusView(job.status);
  const progress = getKnowledgeIngestProgressView(job, { includeInactive: true });
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
          {progress ? (
            <div>
              <dt>Progress</dt>
              <dd>{progress.label}</dd>
            </div>
          ) : null}
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
    case 'uploading':
      return { label: 'Uploading', icon: LoaderCircle, spin: true };
    case 'extracting':
      return { label: 'Extracting', icon: LoaderCircle, spin: true };
    case 'downloading':
      return { label: 'Downloading', icon: LoaderCircle, spin: true };
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
