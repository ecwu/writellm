import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { RetrievedKnowledgeSource } from '../../shared/types';

type EditorSelectionRange = {
  startOffset: number;
  endOffset: number;
};

export type MarkdownEditorHandle = {
  getSelection: () => EditorSelectionRange;
  getValue: () => string;
  replaceRange: (startOffset: number, endOffset: number, text: string) => void;
  focus: () => void;
};

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (range: EditorSelectionRange) => void;
  onCitationClick?: (publicRef: string) => void;
  citationSources?: RetrievedKnowledgeSource[];
  normalizeValue?: (value: string) => string;
  renderMarkdown?: boolean;
  readOnly?: boolean;
}>(function MarkdownEditor({
  value,
  onChange,
  onSelectionChange,
  onCitationClick,
  citationSources = [],
  normalizeValue,
  renderMarkdown = true,
  readOnly = false
}, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const valueRef = useRef(normalizeValue ? normalizeValue(value) : value);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCitationClickRef = useRef(onCitationClick);
  const normalizeValueRef = useRef(normalizeValue);
  const renderMarkdownRef = useRef(renderMarkdown);
  const readOnlyRef = useRef(readOnly);
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onCitationClickRef.current = onCitationClick;
    normalizeValueRef.current = normalizeValue;
    renderMarkdownRef.current = renderMarkdown;
    readOnlyRef.current = readOnly;
  }, [onChange, onSelectionChange, onCitationClick, normalizeValue, renderMarkdown, readOnly]);

  useImperativeHandle(ref, () => ({
    getSelection() {
      const range = viewRef.current?.state.selection.main;
      return {
        startOffset: range?.from ?? 0,
        endOffset: range?.to ?? 0
      };
    },
    getValue() {
      return valueRef.current;
    },
    replaceRange(startOffset, endOffset, text) {
      const view = viewRef.current;
      if (!view || readOnlyRef.current) {
        return;
      }
      const from = Math.max(0, Math.min(startOffset, view.state.doc.length));
      const to = Math.max(from, Math.min(endOffset, view.state.doc.length));
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length }
      });
      view.focus();
    },
    focus() {
      viewRef.current?.focus();
    }
  }), []);

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
          readOnlyCompartmentRef.current.of(readOnlyExtension(readOnlyRef.current)),
          createMarkdownDecorations(renderMarkdownRef.current),
          EditorView.domEventHandlers({
            click(event) {
              if (!renderMarkdownRef.current) {
                return false;
              }
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
              if (target.classList.contains('is-open')) {
                closeCitationPopovers();
                return true;
              }
              closeCitationPopovers();
              openCitationPopover(target);
              return true;
            },
            dblclick(event) {
              if (!renderMarkdownRef.current) {
                return false;
              }
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
    const range = view.state.selection.main;
    onSelectionChangeRef.current?.({
      startOffset: range.from,
      endOffset: range.to
    });

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
    const view = viewRef.current;
    if (!view) {
      return;
    }
    renderMarkdownRef.current = renderMarkdown;
    if (!renderMarkdown) {
      closeCitationPopovers();
    }
    view.dispatch({ effects: setRenderMarkdown.of(renderMarkdown) });
  }, [renderMarkdown]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    readOnlyRef.current = readOnly;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(readOnlyExtension(readOnly))
    });
  }, [readOnly]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        renderMarkdownRef.current &&
        event.target instanceof HTMLElement &&
        (event.target.closest('.cm-citation-marker') || event.target.closest('.cm-citation-popover'))
      ) {
        return;
      }
      closeCitationPopovers();
    }

    function handleViewportChange() {
      const openMarker = document.querySelector<HTMLElement>('.cm-citation-marker.is-open');
      const openPopover = document.querySelector<HTMLElement>('.cm-citation-popover-portal');
      if (!openMarker || !openPopover) {
        return;
      }
      positionCitationPopover(openMarker, openPopover);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      closeCitationPopovers();
    };
  }, []);

  return <div ref={hostRef} className={`markdown-editor${renderMarkdown ? '' : ' is-raw'}${readOnly ? ' is-read-only' : ''}`} />;
});

function readOnlyExtension(readOnly: boolean) {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly)
  ];
}

function closeCitationPopovers(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('.cm-citation-marker.is-open').forEach((element) => {
    if (element !== except) {
      element.classList.remove('is-open');
    }
  });
  if (!except) {
    document.querySelectorAll<HTMLElement>('.cm-citation-popover-portal').forEach((element) => element.remove());
  }
}

function openCitationPopover(marker: HTMLElement): void {
  const sources = citationSourcesByMarker.get(marker);
  if (!sources?.length) {
    return;
  }
  const popover = citationPopover(sources);
  popover.classList.add('cm-citation-popover-portal');
  document.body.append(popover);
  marker.classList.add('is-open');
  positionCitationPopover(marker, popover);
}

function positionCitationPopover(marker: HTMLElement, popover: HTMLElement): void {
  const margin = 12;
  const gap = 6;
  const markerRect = marker.getBoundingClientRect();
  popover.style.left = '0px';
  popover.style.top = '0px';
  popover.style.maxHeight = `${Math.max(160, window.innerHeight - margin * 2)}px`;
  const popoverRect = popover.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
  const left = Math.min(Math.max(markerRect.left, margin), maxLeft);
  const below = markerRect.bottom + gap;
  const above = markerRect.top - popoverRect.height - gap;
  const top = below + popoverRect.height <= window.innerHeight - margin ? below : Math.max(margin, above);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
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
const citationTrailingPunctuationPattern = /^[。．，、；：！？!?.,;:)\]）】〉》」』]/;
const headingPattern = /^(#{1,6})\s+(.+)$/gm;
const inlineCodePattern = /`([^`\n]+)`/g;
const boldPattern = /\*\*([^*\n]+)\*\*/g;
const italicPattern = /(^|[^*])\*([^*\n]+)\*/g;
const linkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;

const setCitationSources = StateEffect.define<RetrievedKnowledgeSource[]>();
const setRenderMarkdown = StateEffect.define<boolean>();
const citationSourcesByMarker = new WeakMap<HTMLElement, RetrievedKnowledgeSource[]>();

function createMarkdownDecorations(initialRenderMarkdown: boolean) {
  return StateField.define<{
    sources: RetrievedKnowledgeSource[];
    renderMarkdown: boolean;
    decorations: DecorationSet;
  }>({
    create(state) {
      return {
        sources: [],
        renderMarkdown: initialRenderMarkdown,
        decorations: initialRenderMarkdown ? buildMarkdownDecorations(state.doc.toString(), []) : Decoration.none
      };
    },
    update(value, transaction) {
      let sources = value.sources;
      let renderMarkdown = value.renderMarkdown;
      for (const effect of transaction.effects) {
        if (effect.is(setCitationSources)) {
          sources = effect.value;
        } else if (effect.is(setRenderMarkdown)) {
          renderMarkdown = effect.value;
        }
      }
      if (transaction.docChanged || sources !== value.sources || renderMarkdown !== value.renderMarkdown) {
        return {
          sources,
          renderMarkdown,
          decorations: renderMarkdown ? buildMarkdownDecorations(transaction.newDoc.toString(), sources) : Decoration.none
        };
      }
      return value;
    },
    provide(field) {
      return EditorView.decorations.from(field, (value) => value.decorations);
    }
  });
}

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
    const matchEnd = match.index + match[0].length;
    const trailingPunctuation = doc.slice(matchEnd).match(citationTrailingPunctuationPattern)?.[0] ?? '';
    entries.push({
      from: match.index,
      to: matchEnd + trailingPunctuation.length,
      decoration: Decoration.replace({
        widget: new CitationWidget(citationSources, fallbackRefs, trailingPunctuation)
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
    private readonly fallbackRefs: string[],
    private readonly trailingPunctuation: string
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
    citationSourcesByMarker.set(element, sources);

    const pill = document.createElement('span');
    pill.className = sources.length === 1 ? 'cm-citation-pill' : 'cm-citation-pill cm-citation-stack-pill';

    if (sources.length === 1) {
      const label = document.createElement('span');
      label.className = 'cm-citation-label';
      label.textContent = shortTitle(first.itemTitle);
      pill.append(label);
      element.append(pill);
      if (this.trailingPunctuation) {
        element.append(citationPunctuation(this.trailingPunctuation));
      }
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
    pill.append(label, cards);
    element.append(pill);
    if (this.trailingPunctuation) {
      element.append(citationPunctuation(this.trailingPunctuation));
    }
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

function citationPunctuation(value: string): HTMLElement {
  const punctuation = document.createElement('span');
  punctuation.className = 'cm-citation-trailing-punctuation';
  punctuation.textContent = value;
  return punctuation;
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
