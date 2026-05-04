import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { CompositionTreeNode } from '../../shared/types';

type DragState = {
  id: string;
  parentId: string | null;
  index: number;
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const active = event.active.data.current as DragState | undefined;
    const over = event.over?.data.current as DragState | undefined;
    if (!active || !over || active.id === over.id || active.parentId !== over.parentId || !active.parentId) {
      return;
    }
    const nextIndex = active.index < over.index ? over.index : over.index;
    if (nextIndex === active.index) {
      return;
    }
    onMove(active.id, active.parentId, nextIndex);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <nav className="outline-tree">
        <SortableContext items={nodes.map((node) => node.id)} strategy={verticalListSortingStrategy}>
          {nodes.map((node, index) => (
            <OutlineNode
              key={node.id}
              node={node}
              activeId={activeId}
              onSelect={onSelect}
              depth={0}
              index={index}
              siblingCount={nodes.length}
            />
          ))}
        </SortableContext>
      </nav>
    </DndContext>
  );
}

function OutlineNode({
  node,
  activeId,
  onSelect,
  depth,
  index,
  siblingCount
}: {
	  node: CompositionTreeNode;
  activeId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  index: number;
  siblingCount: number;
}) {
  const canMove = node.parentId !== null;
  const sortable = useSortable({
    id: node.id,
    disabled: !canMove || siblingCount < 2,
    data: { id: node.id, parentId: node.parentId, index } satisfies DragState
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition
  };

  return (
    <div>
      <div
        ref={sortable.setNodeRef}
        className={`${node.id === activeId ? 'outline-item active' : 'outline-item'}${sortable.isDragging ? ' dragging' : ''}`}
        style={style}
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
            disabled={!canMove || siblingCount < 2}
            ref={sortable.setActivatorNodeRef}
            {...sortable.attributes}
            {...sortable.listeners}
            title={canMove ? 'Drag to reorder section' : 'Root section cannot be reordered'}
          >
            <GripVertical />
            <span className="sr-only">Drag to reorder</span>
          </button>
        </div>
      </div>
      <SortableContext items={node.children.map((sibling) => sibling.id)} strategy={verticalListSortingStrategy}>
        {node.children.map((child, childIndex) => (
          <OutlineNode
            key={child.id}
            node={child}
            activeId={activeId}
            onSelect={onSelect}
            depth={depth + 1}
            index={childIndex}
            siblingCount={node.children.length}
          />
        ))}
      </SortableContext>
    </div>
  );
}
