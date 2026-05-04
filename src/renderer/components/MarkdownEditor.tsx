import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { RetrievedKnowledgeSource } from '../../shared/types';

type EditorSelectionRange = {
  startOffset: number;
  endOffset: number;
};

export function MarkdownEditor({
  value,
  onChange,
  onSelectionChange,
  onCitationClick,
  citationSources = [],
  normalizeValue
}: {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (range: EditorSelectionRange) => void;
  onCitationClick?: (publicRef: string) => void;
  citationSources?: RetrievedKnowledgeSource[];
  normalizeValue?: (value: string) => string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(normalizeValue ? normalizeValue(value) : value);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCitationClickRef = useRef(onCitationClick);
  const normalizeValueRef = useRef(normalizeValue);
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onCitationClickRef.current = onCitationClick;
    normalizeValueRef.current = normalizeValue;
  }, [onChange, onSelectionChange, onCitationClick, normalizeValue]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdownDecorations,
          EditorView.domEventHandlers({
            click(event) {
              if (event.target instanceof HTMLElement && event.target.closest('.cm-citation-popover')) {
                event.preventDefault();
                event.stopPropagation();
                return true;
              }
              const target = event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>('.cm-citation-marker')
                : null;
              if (!target) {
                return false;
              }
              event.preventDefault();
              event.stopPropagation();
              closeCitationPopovers(target);
              target.classList.toggle('is-open');
              return true;
            },
            dblclick(event) {
              if (event.target instanceof HTMLElement && event.target.closest('.cm-citation-popover')) {
                event.preventDefault();
                event.stopPropagation();
                return true;
              }
              const target = event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>('.cm-citation-marker')
                : null;
              const publicRef = target?.dataset.publicRef;
              if (!publicRef || !onCitationClickRef.current) {
                return false;
              }
              event.preventDefault();
              event.stopPropagation();
              closeCitationPopovers();
              onCitationClickRef.current(publicRef);
              return true;
            }
          }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const raw = update.state.doc.toString();
              const normalize = normalizeValueRef.current;
              const next = normalize ? normalize(raw) : raw;
              if (normalize && next !== raw) {
                const cursor = normalizedCursorPosition(raw, next, update.state.selection.main.head, normalize);
                valueRef.current = next;
                syncingRef.current = true;
                update.view.dispatch({
                  changes: {
                    from: 0,
                    to: update.state.doc.length,
                    insert: next
                  },
                  selection: { anchor: cursor }
                });
                syncingRef.current = false;
                if (!syncingRef.current) {
                  onChangeRef.current(next);
                }
                return;
              }
              valueRef.current = next;
              if (!syncingRef.current) {
                onChangeRef.current(next);
              }
            }
            if (update.selectionSet) {
              const range = update.state.selection.main;
              onSelectionChangeRef.current?.({
                startOffset: range.from,
                endOffset: range.to
              });
            }
          })
        ]
      })
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    const nextValue = normalizeValue ? normalizeValue(value) : value;
    if (!view || nextValue === valueRef.current) {
      return;
    }
    valueRef.current = nextValue;
    syncingRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: nextValue
      }
    });
    syncingRef.current = false;
  }, [value, normalizeValue]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({ effects: setCitationSources.of(citationSources) });
  }, [citationSources]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof HTMLElement && event.target.closest('.cm-citation-marker')) {
        return;
      }
      closeCitationPopovers();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  return <div ref={hostRef} className="markdown-editor" />;
}

function closeCitationPopovers(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('.cm-citation-marker.is-open').forEach((element) => {
    if (element !== except) {
      element.classList.remove('is-open');
    }
  });
}

function normalizedCursorPosition(
  raw: string,
  normalized: string,
  cursor: number,
  normalize: (value: string) => string
): number {
  const prefixLength = normalize(raw.slice(0, cursor)).length;
  return Math.max(0, Math.min(prefixLength, normalized.length));
}

const citationGroupPattern = /((?:\[[a-f0-9]{7}\.c\d+\]\s*)+)/gi;
const citationRefPattern = /\[([a-f0-9]{7}\.c\d+)\]/gi;
const headingPattern = /^(#{1,6})\s+(.+)$/gm;
const inlineCodePattern = /`([^`\n]+)`/g;
const boldPattern = /\*\*([^*\n]+)\*\*/g;
const italicPattern = /(^|[^*])\*([^*\n]+)\*/g;
const linkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;

const setCitationSources = StateEffect.define<RetrievedKnowledgeSource[]>();

const markdownDecorations = StateField.define<{
  sources: RetrievedKnowledgeSource[];
  decorations: DecorationSet;
}>({
  create(state) {
    return {
      sources: [],
      decorations: buildMarkdownDecorations(state.doc.toString(), [])
    };
  },
  update(value, transaction) {
    let sources = value.sources;
    for (const effect of transaction.effects) {
      if (effect.is(setCitationSources)) {
        sources = effect.value;
      }
    }
    if (transaction.docChanged || sources !== value.sources) {
      return {
        sources,
        decorations: buildMarkdownDecorations(transaction.newDoc.toString(), sources)
      };
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field, (value) => value.decorations);
  }
});

function buildMarkdownDecorations(doc: string, sources: RetrievedKnowledgeSource[]): DecorationSet {
  const entries: Array<{ from: number; to: number; decoration: Decoration }> = [];
  addLineDecorations(entries, doc);
  addInlineMarkDecorations(entries, doc);
  addCitationDecorations(entries, doc, sources);
  entries.sort((left, right) => left.from - right.from || left.to - right.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) {
    builder.add(entry.from, entry.to, entry.decoration);
  }
  return builder.finish();
}

function addLineDecorations(
  entries: Array<{ from: number; to: number; decoration: Decoration }>,
  doc: string
): void {
  headingPattern.lastIndex = 0;
  for (const match of doc.matchAll(headingPattern)) {
    if (match.index === undefined) {
      continue;
    }
    entries.push({
      from: match.index,
      to: match.index,
      decoration: Decoration.line({ class: `cm-md-heading cm-md-heading-${match[1].length}` })
    });
  }
}

function addInlineMarkDecorations(
  entries: Array<{ from: number; to: number; decoration: Decoration }>,
  doc: string
): void {
  addMatches(entries, doc, inlineCodePattern, 'cm-md-inline-code', 0);
  addMatches(entries, doc, boldPattern, 'cm-md-strong', 0);
  addMatches(entries, doc, italicPattern, 'cm-md-emphasis', 1);
  addMatches(entries, doc, linkPattern, 'cm-md-link', 0);
}

function addMatches(
  entries: Array<{ from: number; to: number; decoration: Decoration }>,
  doc: string,
  pattern: RegExp,
  className: string,
  prefixLength: number
): void {
  pattern.lastIndex = 0;
  for (const match of doc.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    const from = match.index + prefixLength;
    const to = match.index + match[0].length;
    if (from < to) {
      entries.push({ from, to, decoration: Decoration.mark({ class: className }) });
    }
  }
}

function addCitationDecorations(
  entries: Array<{ from: number; to: number; decoration: Decoration }>,
  doc: string,
  sources: RetrievedKnowledgeSource[]
): void {
  const sourceByRef = new Map(sources.map((source) => [source.publicRef.toLowerCase(), source]));
  citationGroupPattern.lastIndex = 0;
  for (const match of doc.matchAll(citationGroupPattern)) {
    if (match.index === undefined) {
      continue;
    }
    const citationSources = sourcesForCitationGroup(match[0], sourceByRef);
    const fallbackRefs = refsForCitationGroup(match[0]);
    entries.push({
      from: match.index,
      to: match.index + match[0].length,
      decoration: Decoration.replace({
        widget: new CitationWidget(citationSources, fallbackRefs)
      })
    });
  }
}

function refsForCitationGroup(raw: string): string[] {
  citationRefPattern.lastIndex = 0;
  return [...raw.matchAll(citationRefPattern)].map((match) => match[1]);
}

function sourcesForCitationGroup(
  raw: string,
  sourceByRef: Map<string, RetrievedKnowledgeSource>
): RetrievedKnowledgeSource[] {
  const byChunk = new Map<string, RetrievedKnowledgeSource>();
  refsForCitationGroup(raw).forEach((ref) => {
    const source = sourceByRef.get(ref.toLowerCase());
    if (source) {
      byChunk.set(source.chunkId, source);
    }
  });
  return [...byChunk.values()];
}

class CitationWidget extends WidgetType {
  constructor(
    private readonly sources: RetrievedKnowledgeSource[],
    private readonly fallbackRefs: string[]
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    const sources = this.sources.length > 0 ? this.sources : fallbackSources(this.fallbackRefs);
    const first = sources[0];
    element.className = sources.length === 1 ? 'cm-citation-marker' : 'cm-citation-marker cm-citation-stack';
    element.dataset.publicRef = first?.publicRef ?? this.fallbackRefs[0] ?? '';
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', 'Show citation chunk');

    if (sources.length === 1) {
      const label = document.createElement('span');
      label.className = 'cm-citation-label';
      label.textContent = shortTitle(first.itemTitle);
      element.append(label, citationPopover(sources));
      return element;
    }

    const label = document.createElement('span');
    label.className = 'cm-citation-stack-label';
    label.textContent = `${sources.length} sources`;
    const cards = document.createElement('span');
    cards.className = 'cm-citation-stack-cards';
    sources.slice(0, 4).forEach((source, index) => {
      const card = document.createElement('span');
      card.style.setProperty('--stack-index', String(index));
      cards.append(card);
    });
    element.append(label, cards, citationPopover(sources));
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

function citationPopover(sources: RetrievedKnowledgeSource[]): HTMLElement {
  const popover = document.createElement('span');
  popover.className = 'cm-citation-popover';
  sources.forEach((source) => {
    const chunk = document.createElement('span');
    chunk.className = 'cm-citation-popover-chunk';

    const header = document.createElement('span');
    header.className = 'cm-citation-popover-title';
    header.textContent = `${source.itemTitle || 'Source'} · ${source.publicRef}`;

    const body = document.createElement('span');
    body.className = 'cm-citation-popover-snippet';
    body.textContent = source.snippet || source.publicRef;

    chunk.append(header, body);
    popover.append(chunk);
  });
  return popover;
}

function fallbackSources(refs: string[]): RetrievedKnowledgeSource[] {
  return refs.map((ref) => ({
    label: `[${ref}]`,
    publicRef: ref,
    itemId: '',
    itemPublicRef: '',
    itemTitle: 'Source',
    chunkId: ref,
    chunkIndex: 0,
    snippet: `Unresolved citation: ${ref}`,
    score: 0
  }));
}

function shortTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim() || 'Source';
  return normalized.length > 22 ? `${normalized.slice(0, 21).trimEnd()}...` : normalized;
}
