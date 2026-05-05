
import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import type { PaperNode } from '../../app/types';
import { citationGroupsFromText } from '../../../shared/citations';
import type { RetrievedKnowledgeSource } from '../../../shared/types';

export function PaperFlowNode({ data, selected }: NodeProps<PaperNode>) {
  const citationSources = data.citationSources ?? [];
  const renderCitationBadges = !data.virtual && data.tone !== 'source';
  const showSourceChips = renderCitationBadges && citationSources.length > 0;
  return (
    <div className={`paper-flow-node tone-${data.tone}${selected ? ' selected' : ''}`}>
      <NodeResizeControl
        position="bottom-right"
        className="paper-node-resize-overlay"
        minWidth={160}
        minHeight={88}
        onResizeEnd={(_event, params) => {
          data.onLayoutChange({
            canvasSectionId: data.canvasSectionId,
            nodeId: data.nodeId,
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height
          });
        }}
      >
        <span className="paper-node-resize-grip" aria-hidden="true" />
      </NodeResizeControl>
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className="paper-node-handle paper-node-handle-vertical"
      />
      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        className="paper-node-handle paper-node-handle-horizontal"
      />
      <Handle
        id="left-source"
        type="source"
        position={Position.Left}
        className="paper-node-handle paper-node-handle-horizontal"
      />
      <div className="paper-node-eyebrow">{data.eyebrow}</div>
      <div className="paper-node-title" title={data.title}>{data.title}</div>
      {data.meta ? <div className="paper-node-meta">{data.meta}</div> : null}
      {data.content ? (
        <div className="paper-node-content">
          {renderCitationBadges ? (
            <CitationAwareContent content={data.content} sources={citationSources} />
          ) : data.content}
        </div>
      ) : null}
      {showSourceChips ? (
        <div className="paper-node-sources">
          {uniqueSourcesByItem(citationSources).slice(0, 6).map((source) => (
            <span key={source.itemId} className="paper-node-source" title={sourceTooltip(source)}>
              {shortTitle(source.itemTitle)}
            </span>
          ))}
        </div>
      ) : null}
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        className="paper-node-handle paper-node-handle-horizontal"
      />
      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        className="paper-node-handle paper-node-handle-horizontal"
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className="paper-node-handle paper-node-handle-vertical"
      />
    </div>
  );
}

function CitationAwareContent({
  content,
  sources
}: {
  content: string;
  sources: RetrievedKnowledgeSource[];
}) {
  const sourceByRef = new Map(sources.map((source) => [source.publicRef.toLowerCase(), source]));
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of citationGroupsFromText(content)) {
    if (match.from > lastIndex) {
      nodes.push(content.slice(lastIndex, match.from));
    }
    nodes.push(
      <CitationGroup
        key={`citation-${match.from}`}
        refs={match.refs}
        sourceByRef={sourceByRef}
      />
    );
    lastIndex = match.to;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return <>{nodes}</>;
}

function CitationGroup({
  refs,
  sourceByRef
}: {
  refs: string[];
  sourceByRef: Map<string, RetrievedKnowledgeSource>;
}) {
  const sources = refs.map((ref) => sourceByRef.get(ref.toLowerCase())).filter(Boolean) as RetrievedKnowledgeSource[];
  const displaySources = sources.length > 0
    ? uniqueSourcesByItem(sources)
    : refs.map((ref) => ({
        publicRef: ref,
        itemTitle: 'Source',
        snippet: `Unresolved citation: ${ref}`
      } as RetrievedKnowledgeSource));

  if (displaySources.length === 1) {
    const source = displaySources[0];
    return (
      <span className="paper-node-citation" title={sourceTooltip(source)}>
        {shortTitle(source.itemTitle)}
      </span>
    );
  }

  return (
    <span className="paper-node-citation-stack" title={displaySources.map(sourceTooltip).join('\n\n')}>
      <span className="paper-node-citation-stack-label">{displaySources.length} sources</span>
      <span className="paper-node-citation-stack-cards" aria-hidden="true">
        {displaySources.slice(0, 4).map((source, index) => (
          <span key={`${source.publicRef}-${index}`} style={{ ['--stack-index' as string]: index }} />
        ))}
      </span>
    </span>
  );
}

function uniqueSourcesByItem(sources: RetrievedKnowledgeSource[]): RetrievedKnowledgeSource[] {
  const byItem = new Map<string, RetrievedKnowledgeSource>();
  sources.forEach((source) => {
    byItem.set(source.itemId, source);
  });
  return [...byItem.values()];
}

function shortTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim() || 'Source';
  return normalized.length > 22 ? `${normalized.slice(0, 21).trimEnd()}...` : normalized;
}

function sourceTooltip(source: Pick<RetrievedKnowledgeSource, 'itemTitle' | 'publicRef' | 'snippet'>): string {
  return `${source.itemTitle}\n\n${source.snippet || source.publicRef}`;
}
