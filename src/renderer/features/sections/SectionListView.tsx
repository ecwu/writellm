
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { getApi } from '../../api';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldError,
  FieldLabel
} from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../../components/ui/table';
import { Textarea } from '../../components/ui/textarea';
import { ChildrenViewHeader } from '../../layout/ChildrenViewHeader';
import type { ChildViewMode, Selection } from '../../app/types';
import type { CompositionTreeNode, FocusedWorkspaceState, LlmOperationRecord } from '../../../shared/types';
import { citationRefsFromText } from '../../../shared/citations';
import { cn } from '../../lib/utils';

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
  onOpenHistory,
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
  onOpenHistory: (section: CompositionTreeNode) => void;
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
        <div className="section-list-table">
          <Table aria-label="Section list">
            <TableHeader>
              <TableRow className="section-list-heading">
                <TableHead className="section-list-title-column">Section</TableHead>
                <TableHead className="section-list-intent-column">Intent</TableHead>
                <TableHead className="section-list-meta-column">Draft</TableHead>
                <TableHead className="section-list-action-column" />
              </TableRow>
            </TableHeader>
            <TableBody>
            {rows.map(({ node, depth }) => (
              <SectionListRow
                key={node.id}
                node={node}
                depth={depth}
                selected={selection?.type === 'node' && selection.id === node.id}
                expanded={expandedIds.has(node.id)}
                rootNodeId={rootNodeId}
                focusSectionId={focusSectionId}
                onSelection={onSelection}
                onFocusSection={onFocusSection}
                onOpenHistory={onOpenHistory}
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
            </TableBody>
          </Table>
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
  focusSectionId,
  onSelection,
  onFocusSection,
  onOpenHistory,
  onToggleExpanded,
  onState,
  onError
}: {
  node: CompositionTreeNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  rootNodeId: string | null;
  focusSectionId: string;
  onSelection: (selection: Selection) => void;
  onFocusSection: (sectionId: string) => void;
  onOpenHistory: (section: CompositionTreeNode) => void;
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
  const metadataSummary = useMemo(() => buildSectionMetadataSummary(node), [node]);

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
    <TableRow
      className={cn('section-list-row', error && 'invalid')}
      data-state={selected ? 'selected' : undefined}
      onClick={() => onSelection({ type: 'node', id: node.id })}
    >
      <TableCell>
        <div className="section-list-title-cell" style={{ '--section-depth': depth } as CSSProperties}>
          {hasChildren ? (
            <button
              type="button"
              className="section-list-expander"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded(node.id);
              }}
              title={expanded ? 'Collapse section' : 'Expand section'}
            >
              {expanded ? <ChevronDown /> : <ChevronRight />}
            </button>
          ) : null}
          {editingField === 'title' ? (
            <Field data-invalid={Boolean(error)} className="section-list-inline-field">
              <FieldLabel htmlFor={`section-title-${node.id}`} className="sr-only">
                {node.title} title
              </FieldLabel>
              <Input
                id={`section-title-${node.id}`}
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
                aria-invalid={Boolean(error)}
              />
              <FieldError>{error}</FieldError>
            </Field>
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
      </TableCell>
      <TableCell>
        <div className="section-list-intent-cell">
          {editingField === 'intent' ? (
            <Field className="section-list-inline-field">
              <FieldLabel htmlFor={`section-intent-${node.id}`} className="sr-only">
                {node.title} intent
              </FieldLabel>
              <Textarea
                id={`section-intent-${node.id}`}
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
            </Field>
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
        </div>
      </TableCell>
      <TableCell>
        <div className="section-list-meta-cell">
          {metadataSummary.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          <div className="section-list-meta-badges">
            {node.id === rootNodeId ? <StatusBadge status="root">Root</StatusBadge> : null}
            {saving ? <StatusBadge status="saving">Saving</StatusBadge> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="section-list-action-cell">
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onOpenHistory(node);
          }}
        >
          <History />
          History
        </Button>
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
      </TableCell>
    </TableRow>
  );
}

function buildSectionMetadataSummary(node: CompositionTreeNode): { lines: string[] } {
  const textStats = getMarkdownTextStats(node.markdownContent);
  const sourceStats = getSourceStats(node);
  const latestAssist = getLatestLlmOperation(node);

  return {
    lines: [
      textStats.visibleChars > 0
        ? `${formatCount(textStats.visibleChars, 'char')} · ${formatCount(textStats.paragraphCount, 'paragraph')}`
        : 'Empty draft',
      sourceStats.refCount > 0 || sourceStats.sourceCount > 0
        ? `${formatCount(sourceStats.refCount, 'ref')} · ${formatCount(sourceStats.sourceCount, 'source')}`
        : 'No citations',
      latestAssist
        ? `${formatCount(latestAssist.operationCount, 'assist run')} · latest ${latestAssist.status}`
        : `Updated ${formatSectionDate(node.updatedAt)}`
    ]
  };
}

function formatCount(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function getMarkdownTextStats(markdown: string): { visibleChars: number; paragraphCount: number } {
  const plainText = markdownToReadableText(markdown);
  if (!plainText) {
    return { visibleChars: 0, paragraphCount: 0 };
  }
  return {
    visibleChars: [...plainText.replace(/\s/g, '')].length,
    paragraphCount: plainText.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).length
  };
}

function markdownToReadableText(markdown: string): string {
  return markdown
    .replace(/\[[a-f0-9]{7}\.c\d+(?:\s*,\s*[a-f0-9]{7}\.c\d+)*\]/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}>\s?/gm, '')
    .replace(/^ {0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getSourceStats(node: CompositionTreeNode): { refCount: number; sourceCount: number } {
  const refs = citationRefsFromText(node.markdownContent);
  const sourceIds = new Set(
    node.citationSources
      .map((source) => source.itemId || source.itemPublicRef || source.publicRef)
      .filter(Boolean)
  );
  return {
    refCount: refs.length,
    sourceCount: sourceIds.size
  };
}

function getLatestLlmOperation(
  node: CompositionTreeNode
): { operationCount: number; status: LlmOperationRecord['status'] } | null {
  const operations = getSectionLlmOperations(node);
  const latest = operations.at(-1);
  if (!latest) {
    return null;
  }
  return {
    operationCount: operations.length,
    status: latest.status
  };
}

function getSectionLlmOperations(node: CompositionTreeNode): LlmOperationRecord[] {
  const operations = node.metadata.llmOperations;
  if (!Array.isArray(operations)) {
    return [];
  }
  return operations.filter((operation): operation is LlmOperationRecord => {
    if (!operation || typeof operation !== 'object') {
      return false;
    }
    const candidate = operation as Partial<LlmOperationRecord>;
    return Boolean(candidate.operationId && candidate.status && candidate.type);
  });
}

function formatSectionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
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
