
import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/react';
import type { PaperNode } from '../../app/types';

export function PaperFlowNode({ data, selected }: NodeProps<PaperNode>) {
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
      <div className="paper-node-eyebrow">{data.eyebrow}</div>
      <div className="paper-node-title">{data.title}</div>
      {data.meta ? <div className="paper-node-meta">{data.meta}</div> : null}
      {data.content ? <div className="paper-node-content">{data.content}</div> : null}
      <Handle
        id="right-source"
        type="source"
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
