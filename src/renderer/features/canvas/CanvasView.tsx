
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes
} from '@xyflow/react';
import { ChildrenViewHeader } from '../../layout/ChildrenViewHeader';
import { FloatingActionToolbar } from './FloatingActionToolbar';
import type { ChildViewMode, ContentPreset, LlmDraftState, Selection } from '../../app/types';
import type { ContentNodeRecord, EdgeKind, FocusedWorkspaceState, SectionNodeRecord } from '../../../shared/types';

export function CanvasView({
  title,
  visibleNodeCount,
  mode,
  onModeChange,
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onNodeDragStop,
  onConnect,
  onEdgeClick,
  onNodeClick,
  onNodeDoubleClick,
  selection,
  selectedSection,
  selectedContent,
  selectedEdge,
  focusSection,
  llmDraft,
  contextNodes,
  onCreateInSection,
  onCreateConnectedContent,
  onOpenSectionMarkdown,
  onDeleteNode,
  onOpenGenerate,
  onPromptChange,
  onContextNodeToggle,
  onExcludeKnowledgeSource,
  onGenerate,
  onRegenerate,
  onCancelGenerate,
  onSaveGenerate,
  onUpdateEdgeKind,
  onDeleteEdge
}: {
  title: string;
  visibleNodeCount: number;
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeDragStop: (node: Node) => void;
  onConnect: (connection: Connection) => void;
  onEdgeClick: (edge: Edge) => void;
  onNodeClick: (node: Node) => void;
  onNodeDoubleClick: (node: Node) => void;
  selection: Selection;
  selectedSection: SectionNodeRecord | null;
  selectedContent: ContentNodeRecord | null;
  selectedEdge: FocusedWorkspaceState['edges'][number] | null;
  focusSection: SectionNodeRecord | null;
  llmDraft: LlmDraftState;
  contextNodes: ContentNodeRecord[];
  onCreateInSection: (sectionId: string, preset: ContentPreset) => void;
  onCreateConnectedContent: (nodeId: string, preset: ContentPreset) => void;
  onOpenSectionMarkdown: (section: SectionNodeRecord) => void;
  onDeleteNode: () => void;
  onOpenGenerate: (sectionId: string) => void;
  onPromptChange: (prompt: string) => void;
  onContextNodeToggle: (nodeId: string, checked: boolean) => void;
  onExcludeKnowledgeSource: (itemId: string, chunkId: string) => void;
  onGenerate: (prompt: string, sectionId: string, contextNodeIds: string[]) => void;
  onRegenerate: () => void;
  onCancelGenerate: () => void;
  onSaveGenerate: () => void;
  onUpdateEdgeKind: (relationType: EdgeKind) => void;
  onDeleteEdge: () => void;
}) {
  return (
    <section className="canvas-pane">
      <ChildrenViewHeader
        title={title}
        detail={`${visibleNodeCount} visible node${visibleNodeCount === 1 ? '' : 's'}`}
        mode={mode}
        onModeChange={onModeChange}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable
        onNodesChange={onNodesChange}
        onNodeDragStop={(_event, node) => onNodeDragStop(node)}
        onConnect={onConnect}
        onEdgeClick={(_event, edge) => onEdgeClick(edge)}
        onNodeClick={(_event, node) => onNodeClick(node)}
        onNodeDoubleClick={(_event, node) => onNodeDoubleClick(node)}
      >
        <Background />
        <Controls />
      </ReactFlow>
      <FloatingActionToolbar
        selection={selection}
        selectedSection={selectedSection}
        selectedContent={selectedContent}
        selectedEdge={selectedEdge}
        focusSection={focusSection}
        llmDraft={llmDraft}
        contextNodes={contextNodes}
        onCreateInSection={onCreateInSection}
        onCreateConnectedContent={onCreateConnectedContent}
        onOpenSectionMarkdown={onOpenSectionMarkdown}
        onDeleteNode={onDeleteNode}
        onOpenGenerate={onOpenGenerate}
        onPromptChange={onPromptChange}
        onContextNodeToggle={onContextNodeToggle}
        onExcludeKnowledgeSource={onExcludeKnowledgeSource}
        onGenerate={onGenerate}
        onRegenerate={onRegenerate}
        onCancelGenerate={onCancelGenerate}
        onSaveGenerate={onSaveGenerate}
        onUpdateEdgeKind={onUpdateEdgeKind}
        onDeleteEdge={onDeleteEdge}
      />
    </section>
  );
}
