import { useState, type DragEvent } from 'react';
import { GripVertical } from 'lucide-react';
import type { CompositionTreeNode } from '../../shared/types';

type DropPosition = 'before' | 'after';

type DragState = {
  id: string;
  parentId: string | null;
  index: number;
};

type DropState = {
  id: string;
  position: DropPosition;
};

export function Outline({
  nodes,
  activeId,
  onSelect,
  onMove
}: {
	  nodes: CompositionTreeNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, parentId: string | null, index: number) => void;
}) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropState, setDropState] = useState<DropState | null>(null);

  function getDropPosition(event: DragEvent<HTMLElement>): DropPosition {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function canDropOn(node: CompositionTreeNode) {
    return Boolean(dragState && dragState.id !== node.id && dragState.parentId === node.parentId);
  }

  function onDragOver(event: DragEvent<HTMLElement>, node: CompositionTreeNode) {
    if (!canDropOn(node)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropState({ id: node.id, position: getDropPosition(event) });
  }

  function onDrop(event: DragEvent<HTMLElement>, node: CompositionTreeNode, targetIndex: number) {
    if (!canDropOn(node) || !dragState) {
      return;
    }
    event.preventDefault();
    const position = getDropPosition(event);
    const targetSlot = targetIndex + (position === 'after' ? 1 : 0);
    const nextIndex = dragState.index < targetSlot ? targetSlot - 1 : targetSlot;
    setDragState(null);
    setDropState(null);

    if (nextIndex === dragState.index) {
      return;
    }
    onMove(dragState.id, dragState.parentId, nextIndex);
  }

  function clearDrag() {
    setDragState(null);
    setDropState(null);
  }

  return (
    <nav className="outline-tree" onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropState(null);
      }
    }}>
      {nodes.map((node, index) => (
        <OutlineNode
          key={node.id}
          node={node}
          activeId={activeId}
          onSelect={onSelect}
          onMove={onMove}
          depth={0}
          index={index}
          siblingCount={nodes.length}
          dragState={dragState}
          dropState={dropState}
          onDragStart={setDragState}
          onDragEnd={clearDrag}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      ))}
    </nav>
  );
}

function OutlineNode({
  node,
  activeId,
  onSelect,
  onMove,
  depth,
  index,
  siblingCount,
  dragState,
  dropState,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: {
	  node: CompositionTreeNode;
  activeId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, parentId: string | null, index: number) => void;
  depth: number;
  index: number;
  siblingCount: number;
  dragState: DragState | null;
  dropState: DropState | null;
  onDragStart: (state: DragState) => void;
  onDragEnd: () => void;
	  onDragOver: (event: DragEvent<HTMLElement>, node: CompositionTreeNode) => void;
	  onDrop: (event: DragEvent<HTMLElement>, node: CompositionTreeNode, targetIndex: number) => void;
}) {
  const canMove = node.parentId !== null;
  const isDragging = dragState?.id === node.id;
  const dropClass =
    dropState?.id === node.id
      ? dropState.position === 'before'
        ? ' drop-before'
        : ' drop-after'
      : '';

  return (
    <div>
      <div
        className={`${node.id === activeId ? 'outline-item active' : 'outline-item'}${isDragging ? ' dragging' : ''}${dropClass}`}
        onDragOver={(event) => onDragOver(event, node)}
        onDrop={(event) => onDrop(event, node, index)}
      >
        <button
          className="outline-select"
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => onSelect(node.id)}
          title={node.title}
        >
          <span>{node.title}</span>
	          {node.activeMainNodeId ? <span className="active-dot" title="Has active main content" /> : null}
        </button>
        <div className="outline-actions" aria-label={`${node.title} drag controls`}>
          <button
            type="button"
            className="outline-drag"
            draggable={canMove}
            disabled={!canMove || siblingCount < 2}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', node.id);
              onDragStart({ id: node.id, parentId: node.parentId, index });
            }}
            onDragEnd={onDragEnd}
            title={canMove ? 'Drag to reorder section' : 'Root section cannot be reordered'}
          >
            <GripVertical />
            <span className="sr-only">Drag to reorder</span>
          </button>
        </div>
      </div>
      {node.children.map((child, childIndex) => (
        <OutlineNode
          key={child.id}
          node={child}
          activeId={activeId}
          onSelect={onSelect}
          onMove={onMove}
          depth={depth + 1}
          index={childIndex}
          siblingCount={node.children.length}
          dragState={dragState}
          dropState={dropState}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}
