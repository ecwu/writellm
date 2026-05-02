
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { ChildrenViewHeader } from '../../layout/ChildrenViewHeader';
import { formatNodeStats } from '../../app/formatters';
import type { ChildViewMode, Selection } from '../../app/types';
import type { CompositionTreeNode, FocusedWorkspaceState, NodeStats } from '../../../shared/types';

type SectionListItem = {
  node: CompositionTreeNode;
  depth: number;
};

export function SectionListView({
  state,
  focusSectionId,
  rootNodeId,
  selection,
  onSelection,
  onFocusSection,
  childViewMode,
  onChildViewMode,
  onState,
  onError
}: {
  state: FocusedWorkspaceState;
  focusSectionId: string | null;
  rootNodeId: string | null;
  selection: Selection;
  onSelection: (selection: Selection) => void;
  onFocusSection: (sectionId: string) => void;
  childViewMode: ChildViewMode;
  onChildViewMode: (mode: ChildViewMode) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const focusNode = useMemo(
    () => (focusSectionId ? findSectionTreeNode(state.compositionTree, focusSectionId) : null),
    [focusSectionId, state.compositionTree]
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!focusNode) {
      setExpandedIds(new Set());
      return;
    }
    setExpandedIds(new Set(collectSectionTreeIds(focusNode.children)));
  }, [focusNode?.id]);

  const rows = useMemo(() => {
    if (!focusNode) {
      return [];
    }
    const nextRows: SectionListItem[] = [];
    appendVisibleSectionRows(focusNode.children, expandedIds, nextRows, 0);
    return nextRows;
  }, [expandedIds, focusNode]);

  if (!focusSectionId || !focusNode) {
    return (
      <section className="section-list-view empty">
        <p className="muted">Open a workspace to manage sections.</p>
      </section>
    );
  }

  return (
    <section className="section-list-view">
      <ChildrenViewHeader
        title={focusNode.title}
        detail={`${rows.length} visible section${rows.length === 1 ? '' : 's'}`}
        mode={childViewMode}
        onModeChange={onChildViewMode}
      />
      {focusNode.children.length === 0 ? (
        <div className="section-list-empty">
          <p className="muted">This section has no child sections yet.</p>
        </div>
      ) : (
        <div className="section-list-table" role="treegrid" aria-label="Section list">
          <div className="section-list-heading" role="row">
            <div>Section</div>
            <div>Intent</div>
            <div>Metadata</div>
            <div />
          </div>
          <div className="section-list-body">
            {rows.map(({ node, depth }) => (
              <SectionListRow
                key={node.id}
                node={node}
                depth={depth}
                selected={selection?.type === 'node' && selection.id === node.id}
                expanded={expandedIds.has(node.id)}
                rootNodeId={rootNodeId}
                stats={state.nodeStats[node.id]}
                focusSectionId={focusSectionId}
                onSelection={onSelection}
                onFocusSection={onFocusSection}
                onToggleExpanded={(id) => {
                  setExpandedIds((current) => {
                    const next = new Set(current);
                    if (next.has(id)) {
                      next.delete(id);
                    } else {
                      next.add(id);
                    }
                    return next;
                  });
                }}
                onState={onState}
                onError={onError}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SectionListRow({
  node,
  depth,
  selected,
  expanded,
  rootNodeId,
  stats,
  focusSectionId,
  onSelection,
  onFocusSection,
  onToggleExpanded,
  onState,
  onError
}: {
  node: CompositionTreeNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  rootNodeId: string | null;
  stats: NodeStats | undefined;
  focusSectionId: string;
  onSelection: (selection: Selection) => void;
  onFocusSection: (sectionId: string) => void;
  onToggleExpanded: (sectionId: string) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [intent, setIntent] = useState(node.intent ?? '');
  const [editingField, setEditingField] = useState<'title' | 'intent' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasChildren = node.children.length > 0;

  useEffect(() => {
    setTitle(node.title);
    setIntent(node.intent ?? '');
    setEditingField(null);
    setError(null);
  }, [node.id]);

  async function saveSectionDraft(): Promise<boolean> {
    if (!title.trim()) {
      setError('Title is required.');
      setEditingField('title');
      return false;
    }

    const trimmedTitle = title.trim();
    setTitle(trimmedTitle);
    if (trimmedTitle === node.title && intent === (node.intent ?? '')) {
      setError(null);
      return true;
    }

    try {
      setError(null);
      setSaving(true);
      await getApi().updateNode(node.id, {
        title: trimmedTitle,
        intent
      });
      onState(await getApi().getState(focusSectionId));
      return true;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function commitEditingField(field: 'title' | 'intent') {
    const saved = await saveSectionDraft();
    if (saved) {
      setEditingField((current) => (current === field ? null : current));
    }
  }

  return (
    <div
      className={`section-list-row${selected ? ' selected' : ''}${error ? ' invalid' : ''}`}
      role="row"
      onClick={() => onSelection({ type: 'node', id: node.id })}
    >
      <div className="section-list-title-cell" style={{ '--section-depth': depth } as CSSProperties}>
        <button
          type="button"
          className="section-list-expander"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) {
              onToggleExpanded(node.id);
            }
          }}
          disabled={!hasChildren}
          title={hasChildren ? (expanded ? 'Collapse section' : 'Expand section') : 'No child sections'}
        >
          {hasChildren ? expanded ? <ChevronDown /> : <ChevronRight /> : <span aria-hidden="true" />}
        </button>
        {editingField === 'title' ? (
          <Input
            value={title}
            autoFocus
            aria-label={`${node.title} title`}
            className="section-list-title-input"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              if (nextTitle.trim()) {
                setError(null);
              }
            }}
            onBlur={() => void commitEditingField('title')}
          />
        ) : (
          <button
            type="button"
            className="section-list-title-display"
            onClick={(event) => {
              event.stopPropagation();
              onSelection({ type: 'node', id: node.id });
              setEditingField('title');
            }}
          >
            {title || node.title}
          </button>
        )}
      </div>
      <div className="section-list-intent-cell">
        {editingField === 'intent' ? (
          <Textarea
            value={intent}
            autoFocus
            aria-label={`${node.title} intent`}
            className="section-list-intent-input"
            placeholder="Intent"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              setIntent(event.target.value);
            }}
            onBlur={() => void commitEditingField('intent')}
          />
        ) : (
          <button
            type="button"
            className={`section-list-intent-display${intent.trim() ? '' : ' empty'}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelection({ type: 'node', id: node.id });
              setEditingField('intent');
            }}
          >
            {intent.trim() ? intent : 'No intent'}
          </button>
        )}
        {error ? <span className="section-list-error">{error}</span> : null}
      </div>
      <div className="section-list-meta-cell">
        <span>{node.children.length} child sections</span>
        <span>{formatNodeStats(stats)}</span>
        {node.id === rootNodeId ? <span>Root</span> : null}
        {saving ? <span>Saving</span> : null}
      </div>
      <div className="section-list-action-cell">
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onFocusSection(node.id);
          }}
        >
          Enter
        </Button>
      </div>
    </div>
  );
}


function findSectionTreeNode(nodes: CompositionTreeNode[], id: string): CompositionTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = findSectionTreeNode(node.children, id);
    if (child) {
      return child;
    }
  }
  return null;
}

function collectSectionTreeIds(nodes: CompositionTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...collectSectionTreeIds(node.children)]);
}

function appendVisibleSectionRows(
  nodes: CompositionTreeNode[],
  expandedIds: Set<string>,
  rows: SectionListItem[],
  depth: number
) {
  nodes.forEach((node) => {
    rows.push({ node, depth });
    if (expandedIds.has(node.id)) {
      appendVisibleSectionRows(node.children, expandedIds, rows, depth + 1);
    }
  });
}
