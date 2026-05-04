
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import * as dagre from '@dagrejs/dagre';
import {
  DEFAULT_CONTENT_NODE_HEIGHT,
  DEFAULT_CONTENT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH
} from '../../app/constants';
import { formatContentFlags, formatNodeStats } from '../../app/formatters';
import type { PaperNode, Selection } from '../../app/types';
import type {
  ContentNodeRecord,
  FocusedWorkspaceState,
  NodeRecord,
  RetrievedKnowledgeSource,
  SectionNodeRecord,
  UpdateNodeLayoutPayload
} from '../../../shared/types';

export function buildGraph(
  state: FocusedWorkspaceState,
  selection: Selection,
  onLayoutChange: (payload: UpdateNodeLayoutPayload) => void
): {
  nodes: PaperNode[];
  edges: Edge[];
} {
  const focusId = state.focusSectionId;
  const nodes: PaperNode[] = [];
  const edges: Edge[] = [];
  const virtualEdges: Array<{ id: string; source: string; target: string; selected: boolean; className: string }> = [];
  const layoutByNodeId = new Map(state.nodeLayouts.map((layout) => [layout.nodeId, layout]));

  if (!focusId) {
    return { nodes, edges };
  }

  const getNodeLayout = (
    nodeId: string,
    defaultPosition: { x: number; y: number },
    defaultSize: { width: number; height: number }
  ) => {
    const layout = layoutByNodeId.get(nodeId);
    const width = layout?.width ?? defaultSize.width;
    const height = layout?.height ?? defaultSize.height;

    return {
      position: layout ? { x: layout.x, y: layout.y } : defaultPosition,
      width,
      height,
      style: { width, height }
    };
  };

  const childSections = state.visibleNodes.filter(
    (node): node is SectionNodeRecord => node.kind === 'section' && node.parentId === focusId
  );
  const focusSection = state.visibleNodes.find(
    (node): node is SectionNodeRecord => node.kind === 'section' && node.id === focusId
  );
  const orderedContent = orderContentNodes(
    state.visibleNodes.filter(
      (node): node is ContentNodeRecord =>
        node.kind === 'content' &&
        node.parentId === focusId &&
        !isKnowledgeSourceContentNode(node)
    ),
    state.edges
  );
  const showFocusSection = Boolean(focusSection?.markdownContent.trim());
  const defaultPositions = layoutDefaultPositions(childSections, orderedContent, state.edges);
  if (showFocusSection) {
    defaultPositions.forEach((position, nodeId) => {
      defaultPositions.set(nodeId, { x: position.x, y: position.y + 260 });
    });
  }

  if (showFocusSection && focusSection) {
    nodes.push({
      id: focusSection.id,
      type: 'paper',
      ...getNodeLayout(
        focusSection.id,
        { x: 40, y: 80 },
        { width: DEFAULT_CONTENT_NODE_WIDTH + 80, height: DEFAULT_CONTENT_NODE_HEIGHT }
      ),
      selected: selection?.type === 'node' && selection.id === focusSection.id,
      data: {
        nodeId: focusSection.id,
        canvasSectionId: focusId,
        kind: 'section',
        eyebrow: 'Current section',
        title: focusSection.title,
        meta: focusSection.markdownPath,
        content: markdownPreview(focusSection.markdownContent),
        citationSources: focusSection.citationSources,
        tone: 'author_text',
        layoutKey: `focus-section:${focusSection.id}`,
        onLayoutChange
      }
    });
  }

  const virtualCitationNodes = buildVirtualCitationNodes(focusId, [
    ...(focusSection ? [focusSection] : []),
    ...childSections
  ]);
  const virtualCitationPositions = layoutVirtualCitationPositions(
    virtualCitationNodes,
    childSections,
    orderedContent,
    focusSection && showFocusSection ? {
      id: focusSection.id,
      position: { x: 40, y: 80 },
      width: DEFAULT_CONTENT_NODE_WIDTH + 80,
      height: DEFAULT_CONTENT_NODE_HEIGHT
    } : null,
    defaultPositions
  );
  virtualCitationNodes.forEach(({ id, targetSectionIds, sources }, index) => {
    const source = sources[0];
    const title = source?.itemTitle.trim() || 'Knowledge source';
    nodes.push({
      id,
      type: 'paper',
      ...getNodeLayout(
        id,
        virtualCitationPositions.get(id) ?? {
          x: 460 + (index % 3) * 300,
          y: 80 + Math.floor(index / 3) * 220
        },
        { width: DEFAULT_CONTENT_NODE_WIDTH, height: DEFAULT_CONTENT_NODE_HEIGHT }
      ),
      selected: selection?.type === 'node' && selection.id === id,
      data: {
        nodeId: id,
        canvasSectionId: focusId,
        kind: 'content',
        eyebrow: 'source',
        title,
        meta: formatSourceMeta(sources),
        content: source ? knowledgeSourceSummary(source) : undefined,
        citationSources: sources,
        virtual: true,
        tone: 'source',
        layoutKey: `virtual-source:${id}`,
        onLayoutChange
      }
    });
    targetSectionIds.forEach((targetSectionId) => {
      virtualEdges.push({
        id: `virtual-cites:${id}:${targetSectionId}`,
        source: id,
        target: targetSectionId,
        selected: false,
        className: 'process-edge citation-edge'
      });
    });
  });

  childSections.forEach((section, index) => {
    const stats = state.nodeStats[section.id];
    nodes.push({
      id: section.id,
      type: 'paper',
      ...getNodeLayout(
        section.id,
        defaultPositions.get(section.id) ?? { x: 40 + index * 260, y: showFocusSection ? 320 : 80 },
        { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT }
      ),
      selected: selection?.type === 'node' && selection.id === section.id,
      data: {
        nodeId: section.id,
        canvasSectionId: focusId,
        kind: 'section',
        eyebrow: `Section ${index + 1}`,
        title: section.title,
        meta: formatNodeStats(stats),
        content: markdownPreview(section.markdownContent),
        citationSources: section.citationSources,
        tone: 'child-container',
        layoutKey: `section:${section.id}:${index}`,
        onLayoutChange
      }
    });
  });

  orderedContent.forEach((content, index) => {
    nodes.push({
      id: content.id,
      type: 'paper',
      ...getNodeLayout(
        content.id,
        defaultPositions.get(content.id) ?? { x: 80 + index * 280, y: 220 },
        { width: DEFAULT_CONTENT_NODE_WIDTH, height: DEFAULT_CONTENT_NODE_HEIGHT }
      ),
      selected: selection?.type === 'node' && selection.id === content.id,
      data: {
        nodeId: content.id,
        canvasSectionId: focusId,
        kind: 'content',
        eyebrow: formatContentFlags(content),
        title: content.title,
        content: content.content || undefined,
        citationSources: getGenerationSources(content),
        tone: content.metadata.nodeRole === 'knowledge-source' ? 'source' : content.isLlm ? 'llm' : 'author_text',
        layoutKey: `content:${content.id}:${index}`,
        onLayoutChange
      }
    });
  });

  const graphNodeIds = new Set(nodes.map((node) => node.id));
  state.edges.forEach((edge) => {
    if (!graphNodeIds.has(edge.fromNodeId) || !graphNodeIds.has(edge.toNodeId)) {
      return;
    }

    edges.push(buildFlowEdge({
      id: edge.id,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      label: edge.relationType,
      selected: selection?.type === 'edge' && selection.id === edge.id,
      className: [
        'process-edge',
        edge.relationType === 'cites' ? 'citation-edge' : null,
        selection?.type === 'edge' && selection.id === edge.id ? 'selected-edge' : null
      ].filter(Boolean).join(' ')
    }, nodes));
  });

  virtualEdges.forEach((edge) => {
    if (!graphNodeIds.has(edge.source) || !graphNodeIds.has(edge.target)) {
      return;
    }
    edges.push(buildFlowEdge({
      ...edge,
      label: 'cites'
    }, nodes));
  });

  return { nodes, edges };
}

function formatSourceMeta(sources: RetrievedKnowledgeSource[]): string {
  const source = sources[0];
  const chunkLabel = `${sources.length} cited chunk${sources.length === 1 ? '' : 's'}`;
  return source?.itemPublicRef ? `${source.itemPublicRef} - ${chunkLabel}` : chunkLabel;
}

function knowledgeSourceSummary(source: RetrievedKnowledgeSource): string {
  return source.itemDescription?.trim() || firstSentence(source.snippet) || source.snippet;
}

function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const match = normalized.match(/^.*?[.!?。！？](?:\s|$)/);
  const sentence = match?.[0]?.trim() || normalized;
  return sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}...` : sentence;
}

function buildFlowEdge(
  edge: {
    id: string;
    source: string;
    target: string;
    label: string;
    selected: boolean;
    className: string;
  },
  nodes: PaperNode[]
): Edge {
  const handles = chooseHorizontalHandles(edge.source, edge.target, nodes);
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: handles.sourceHandle,
    target: edge.target,
    targetHandle: handles.targetHandle,
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    type: 'smoothstep',
    selected: edge.selected,
    className: edge.className
  };
}

function chooseHorizontalHandles(
  sourceId: string,
  targetId: string,
  nodes: PaperNode[]
): { sourceHandle: string; targetHandle: string } {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target) {
    return { sourceHandle: 'right-source', targetHandle: 'left-target' };
  }
  const sourceCenterX = source.position.x + nodeWidth(source) / 2;
  const targetCenterX = target.position.x + nodeWidth(target) / 2;
  return sourceCenterX <= targetCenterX
    ? { sourceHandle: 'right-source', targetHandle: 'left-target' }
    : { sourceHandle: 'left-source', targetHandle: 'right-target' };
}

function nodeWidth(node: PaperNode): number {
  return typeof node.width === 'number' ? node.width : DEFAULT_NODE_WIDTH;
}

function buildVirtualCitationNodes(focusId: string, sections: SectionNodeRecord[]): Array<{
  id: string;
  targetSectionIds: string[];
  sources: RetrievedKnowledgeSource[];
}> {
  const byItem = new Map<string, { targetSectionIds: Set<string>; sources: RetrievedKnowledgeSource[] }>();
  for (const section of sections) {
    section.citationSources.forEach((source) => {
      const item = byItem.get(source.itemId) ?? { targetSectionIds: new Set<string>(), sources: [] };
      item.targetSectionIds.add(section.id);
      item.sources.push(source);
      byItem.set(source.itemId, item);
    });
  }
  return [...byItem.entries()]
    .map(([itemId, item]) => ({
      id: `source:${focusId}:${itemId}`,
      targetSectionIds: [...item.targetSectionIds],
      sources: uniqueSourcesByChunk(item.sources).sort((left, right) => left.chunkIndex - right.chunkIndex)
    }))
    .sort((left, right) => {
      const leftSource = left.sources[0];
      const rightSource = right.sources[0];
      return (
        (leftSource?.itemTitle ?? '').localeCompare(rightSource?.itemTitle ?? '') ||
        left.id.localeCompare(right.id)
      );
    });
}

function uniqueSourcesByChunk(sources: RetrievedKnowledgeSource[]): RetrievedKnowledgeSource[] {
  const byChunk = new Map<string, RetrievedKnowledgeSource>();
  sources.forEach((source) => {
    byChunk.set(source.chunkId, source);
  });
  return [...byChunk.values()];
}

function isKnowledgeSourceContentNode(node: ContentNodeRecord): boolean {
  return node.metadata.nodeRole === 'knowledge-source';
}

function layoutVirtualCitationPositions(
  virtualNodes: Array<{ id: string }>,
  childSections: SectionNodeRecord[],
  contentNodes: ContentNodeRecord[],
  focusNode: { id: string; position: { x: number; y: number }; width: number; height: number } | null,
  defaultPositions: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const anchors: Array<{ x: number; y: number; width: number; height: number }> = [];
  if (focusNode) {
    anchors.push({
      x: focusNode.position.x,
      y: focusNode.position.y,
      width: focusNode.width,
      height: focusNode.height
    });
  }
  childSections.forEach((section) => {
    const position = defaultPositions.get(section.id);
    if (position) {
      anchors.push({ ...position, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
    }
  });
  contentNodes.forEach((content) => {
    const position = defaultPositions.get(content.id);
    if (position) {
      anchors.push({ ...position, width: DEFAULT_CONTENT_NODE_WIDTH, height: DEFAULT_CONTENT_NODE_HEIGHT });
    }
  });

  const rightEdge = anchors.length > 0
    ? Math.max(...anchors.map((anchor) => anchor.x + anchor.width))
    : 400;
  const top = anchors.length > 0
    ? Math.min(...anchors.map((anchor) => anchor.y))
    : 80;
  const columns = Math.min(3, Math.max(1, virtualNodes.length));
  const positions = new Map<string, { x: number; y: number }>();

  virtualNodes.forEach((node, index) => {
    positions.set(node.id, {
      x: rightEdge + 64 + (index % columns) * (DEFAULT_CONTENT_NODE_WIDTH + 32),
      y: top + Math.floor(index / columns) * (DEFAULT_CONTENT_NODE_HEIGHT + 28)
    });
  });

  return positions;
}

function markdownPreview(markdown: string): string | undefined {
  const preview = markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return preview ? (preview.length > 220 ? `${preview.slice(0, 217).trimEnd()}...` : preview) : undefined;
}

function getGenerationSources(node: ContentNodeRecord): RetrievedKnowledgeSource[] {
  const sources = node.metadata.retrievedSources;
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources.filter((source): source is RetrievedKnowledgeSource => {
    if (!source || typeof source !== 'object') {
      return false;
    }
    const candidate = source as Partial<RetrievedKnowledgeSource>;
    return Boolean(
      candidate.publicRef &&
      candidate.itemTitle &&
      candidate.chunkId &&
      typeof candidate.snippet === 'string'
    );
  });
}

function layoutDefaultPositions(
  childSections: SectionNodeRecord[],
  contentNodes: ContentNodeRecord[],
  edges: FocusedWorkspaceState['edges']
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 48,
    ranksep: 96,
    marginx: 40,
    marginy: 56
  });

  childSections.forEach((section, index) => {
    graph.setNode(section.id, {
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
      rank: 0,
      order: index
    });
  });
  contentNodes.forEach((content, index) => {
    graph.setNode(content.id, {
      width: DEFAULT_CONTENT_NODE_WIDTH,
      height: DEFAULT_CONTENT_NODE_HEIGHT,
      rank: 1,
      order: index
    });
  });

  const visibleContentIds = new Set(contentNodes.map((node) => node.id));
  edges.forEach((edge) => {
    if (visibleContentIds.has(edge.fromNodeId) && visibleContentIds.has(edge.toNodeId)) {
      graph.setEdge(edge.fromNodeId, edge.toNodeId);
    }
  });

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  graph.nodes().forEach((nodeId) => {
    const node = graph.node(nodeId);
    if (!node) {
      return;
    }
    positions.set(nodeId, {
      x: node.x - node.width / 2,
      y: node.y - node.height / 2
    });
  });
  return positions;
}

function orderContentNodes(contentNodes: ContentNodeRecord[], edges: FocusedWorkspaceState['edges']): ContentNodeRecord[] {
  const byId = new Map(contentNodes.map((node) => [node.id, node]));
  const sorted = [...contentNodes].sort(compareNodeOrder);
  const indegree = new Map(sorted.map((node) => [node.id, 0]));
  const outgoing = new Map(sorted.map((node) => [node.id, [] as string[]]));

  edges.forEach((edge) => {
    if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) {
      return;
    }
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  });

  const queue = sorted.filter((node) => indegree.get(node.id) === 0);
  const ordered: ContentNodeRecord[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    queue.sort(compareNodeOrder);
    const node = queue.shift()!;
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    ordered.push(node);

    outgoing.get(node.id)?.forEach((targetId) => {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = byId.get(targetId);
        if (target) {
          queue.push(target);
        }
      }
    });
  }

  sorted.forEach((node) => {
    if (!seen.has(node.id)) {
      ordered.push(node);
    }
  });

  return ordered;
}

function compareNodeOrder(left: NodeRecord, right: NodeRecord) {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
}

export function reconcileNodes(nextNodes: Node[], currentNodes: Node[]): Node[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id);
    if (!currentNode) {
      return nextNode;
    }

    const keepInteractiveLayout =
      currentNode.data?.layoutKey === nextNode.data?.layoutKey ||
      currentNode.dragging ||
      currentNode.resizing;

    return {
      ...nextNode,
      position: keepInteractiveLayout ? currentNode.position : nextNode.position,
      width: keepInteractiveLayout ? currentNode.width ?? nextNode.width : nextNode.width,
      height: keepInteractiveLayout ? currentNode.height ?? nextNode.height : nextNode.height,
      style: keepInteractiveLayout ? currentNode.style ?? nextNode.style : nextNode.style,
      selected: nextNode.selected,
      dragging: currentNode.dragging,
      resizing: currentNode.resizing
    };
  });
}
