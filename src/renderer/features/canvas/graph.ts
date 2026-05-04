
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
  const orderedContent = orderContentNodes(
    state.visibleNodes.filter(
      (node): node is ContentNodeRecord => node.kind === 'content' && node.parentId === focusId
    ),
    state.edges
  );
  const defaultPositions = layoutDefaultPositions(childSections, orderedContent, state.edges);

  childSections.forEach((section, index) => {
    const stats = state.nodeStats[section.id];
    nodes.push({
      id: section.id,
      type: 'paper',
      ...getNodeLayout(
        section.id,
        defaultPositions.get(section.id) ?? { x: 40 + index * 260, y: 80 },
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

  const visibleContentIds = new Set(orderedContent.map((node) => node.id));
  state.edges.forEach((edge) => {
    if (!visibleContentIds.has(edge.fromNodeId) || !visibleContentIds.has(edge.toNodeId)) {
      return;
    }

    edges.push({
      id: edge.id,
      source: edge.fromNodeId,
      sourceHandle: 'right-source',
      target: edge.toNodeId,
      targetHandle: 'left-target',
      label: edge.relationType,
      markerEnd: { type: MarkerType.ArrowClosed },
      type: 'smoothstep',
      selected: selection?.type === 'edge' && selection.id === edge.id,
      className: [
        'process-edge',
        edge.relationType === 'cites' ? 'citation-edge' : null,
        selection?.type === 'edge' && selection.id === edge.id ? 'selected-edge' : null
      ].filter(Boolean).join(' ')
    });
  });

  return { nodes, edges };
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
