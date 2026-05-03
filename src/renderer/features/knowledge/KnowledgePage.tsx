import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
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
  workspacePath,
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
  const onDebugErrorRef = useRef(onDebugError);
  const isCreating = !selected;

  useEffect(() => {
    onDebugErrorRef.current = onDebugError;
  }, [onDebugError]);

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
                      onClick={() => {
                        setIsCreatingSource(false);
                        setSelectedId(item.id);
                      }}
                    >
                      <span className="knowledge-source-title">{item.title}</span>
                      <span className={`knowledge-source-status ${item.indexStatus}`}>{item.indexStatus}</span>
                      <span className="knowledge-source-preview">{item.publicRef}</span>
                      <span className="knowledge-source-preview">{previewText(item.content)}</span>
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
              {selected.content.trim() ? (
                <MarkdownTypography content={selected.content} item={selected} workspacePath={workspacePath} />
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

function MarkdownTypography({
  content,
  item,
  workspacePath
}: {
  content: string;
  item: KnowledgeItemRecord;
  workspacePath: string | null;
}) {
  return <article className="knowledge-markdown">{renderMarkdownBlocks(content, item, workspacePath)}</article>;
}

function renderMarkdownBlocks(
  content: string,
  item: KnowledgeItemRecord,
  workspacePath: string | null
): ReactNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const image = line.trim().match(/^!\[([^\]]*)]\(([^)]+)\)\s*$/);
    if (image) {
      index += 1;
      const captionLines: string[] = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !isMarkdownBlockStart(lines, index)
      ) {
        captionLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push(
        <MarkdownImageFigure
          key={blocks.length}
          alt={image[1]}
          caption={captionLines.join(' ').replace(/\s{2,}/g, ' ')}
          rawSrc={image[2]}
          item={item}
          workspacePath={workspacePath}
        />
      );
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={blocks.length}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (line.trim() === '$$') {
      const mathLines: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== '$$') {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(<MathNode key={blocks.length} value={mathLines.join('\n')} displayMode />);
      continue;
    }

    if (line.trim() === '\\[') {
      const mathLines: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== '\\]') {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(<MathNode key={blocks.length} value={mathLines.join('\n')} displayMode />);
      continue;
    }

    const singleLineDisplayMath = line.trim().match(/^\$\$(.+)\$\$$/) ?? line.trim().match(/^\\\[(.+)\\\]$/);
    if (singleLineDisplayMath) {
      blocks.push(<MathNode key={blocks.length} value={singleLineDisplayMath[1]} displayMode />);
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const children = renderInlineMarkdown(heading[2], item, workspacePath);
      if (level === 1) {
        blocks.push(<h1 key={blocks.length}>{children}</h1>);
      } else if (level === 2) {
        blocks.push(<h2 key={blocks.length}>{children}</h2>);
      } else if (level === 3) {
        blocks.push(<h3 key={blocks.length}>{children}</h3>);
      } else {
        blocks.push(<h4 key={blocks.length}>{children}</h4>);
      }
      index += 1;
      continue;
    }

    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={blocks.length}>
          <p>{renderInlineMarkdown(quoteLines.join(' '), item, workspacePath)}</p>
        </blockquote>
      );
      continue;
    }

    if (isTableStart(lines, index)) {
      const rows: string[][] = [];
      const header = splitTableRow(lines[index]);
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={blocks.length} className="knowledge-markdown-table-wrap">
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderInlineMarkdown(cell, item, workspacePath)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] ?? '', item, workspacePath)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const unorderedListMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    const orderedListMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unorderedListMatch || orderedListMatch) {
      const isOrdered = Boolean(orderedListMatch);
      const items: string[] = [];
      const listPattern = isOrdered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const match = lines[index].match(listPattern);
        if (!match) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      const children = items.map((listItem, itemIndex) => (
        <li key={itemIndex}>{renderInlineMarkdown(listItem, item, workspacePath)}</li>
      ));
      blocks.push(isOrdered ? <ol key={blocks.length}>{children}</ol> : <ul key={blocks.length}>{children}</ul>);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isMarkdownBlockStart(lines, index)
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={blocks.length}>{renderInlineMarkdown(paragraphLines.join(' '), item, workspacePath)}</p>);
  }

  return blocks;
}

function renderInlineMarkdown(
  text: string,
  item: KnowledgeItemRecord,
  workspacePath: string | null
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(!\[[^\]]*]\([^)]+\)|\\\(.+?\\\)|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = nodes.length;
    if (token.startsWith('![')) {
      const imageMatch = token.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
      const source = imageMatch ? resolveMarkdownImageSource(imageMatch[2], item, workspacePath) : null;
      if (imageMatch && source) {
        nodes.push(
          <KnowledgeMarkdownImage
            key={key}
            alt={imageMatch[1]}
            className="knowledge-markdown-image"
            source={source}
          />
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith('\\(')) {
      nodes.push(<MathNode key={key} value={token.slice(2, -2)} />);
    } else if (token.startsWith('$')) {
      nodes.push(<MathNode key={key} value={token.slice(1, -1)} />);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const href = getSafeMarkdownHref(linkMatch[2]);
        nodes.push(
          <a key={key} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function MathNode({
  value,
  displayMode = false
}: {
  value: string;
  displayMode?: boolean;
}) {
  const html = katex.renderToString(value.trim(), {
    displayMode,
    throwOnError: false,
    strict: false,
    trust: false
  });
  return (
    <span
      className={displayMode ? 'knowledge-math-display' : 'knowledge-math-inline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function MarkdownImageFigure({
  alt,
  caption,
  rawSrc,
  item,
  workspacePath
}: {
  alt: string;
  caption: string;
  rawSrc: string;
  item: KnowledgeItemRecord;
  workspacePath: string | null;
}) {
  const source = resolveMarkdownImageSource(rawSrc, item, workspacePath);
  if (!source) {
    return <p>{caption || alt || rawSrc}</p>;
  }
  return (
    <figure className="knowledge-markdown-figure">
      <KnowledgeMarkdownImage
        alt={alt || caption}
        className="knowledge-markdown-image"
        source={source}
      />
      {caption ? <figcaption>{renderInlineMarkdown(caption, item, workspacePath)}</figcaption> : null}
    </figure>
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
  const [src, setSrc] = useState(source.kind === 'url' ? source.src : '');

  useEffect(() => {
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
  }, [source.kind, source.kind === 'url' ? source.src : source.relativePath]);

  if (!src) {
    return <span className="knowledge-markdown-image-placeholder">{alt || 'Loading image'}</span>;
  }
  return <img alt={alt} className={className} loading="lazy" src={src} />;
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

function isMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    /^```/.test(line) ||
    /^!\[[^\]]*]\([^)]+\)\s*$/.test(line.trim()) ||
    line.trim() === '$$' ||
    line.trim() === '\\[' ||
    /^\$\$.+\$\$$/.test(line.trim()) ||
    /^\\\[.+\\\]$/.test(line.trim()) ||
    /^(#{1,4})\s+/.test(line) ||
    line.trim().startsWith('>') ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    isTableStart(lines, index)
  );
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes('|') && lines[index + 1]?.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
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
