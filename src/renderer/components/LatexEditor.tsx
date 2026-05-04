import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { RetrievedKnowledgeSource } from '../../shared/types';

type EditorSelectionRange = {
  startOffset: number;
  endOffset: number;
};

export function LatexEditor({
  value,
  onChange,
  onSelectionChange,
  onCitationClick,
  citationSources = []
}: {
	  value: string;
	  onChange: (value: string) => void;
	  onSelectionChange?: (range: EditorSelectionRange) => void;
	  onCitationClick?: (publicRef: string) => void;
	  citationSources?: RetrievedKnowledgeSource[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCitationClickRef = useRef(onCitationClick);
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onCitationClickRef.current = onCitationClick;
  }, [onChange, onSelectionChange, onCitationClick]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          StreamLanguage.define(stex),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          citationDecorations,
          EditorView.domEventHandlers({
            click(event) {
              const target = event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>('.cm-citation-marker')
                : null;
              const publicRef = target?.dataset.publicRef;
              if (!publicRef || !onCitationClickRef.current) {
                return false;
              }
              event.preventDefault();
              onCitationClickRef.current(publicRef);
              return true;
            }
          }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString();
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
    if (!view || value === valueRef.current) {
      return;
    }
    valueRef.current = value;
    syncingRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value
      }
    });
    syncingRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({ effects: setCitationSources.of(citationSources) });
  }, [citationSources]);

  return <div ref={hostRef} className="latex-editor" />;
}

const citationGroupPattern = /((?:\[[a-f0-9]{7}\.c\d+\]\s*)+)/gi;
const citationRefPattern = /\[([a-f0-9]{7}\.c\d+)\]/gi;

const setCitationSources = StateEffect.define<RetrievedKnowledgeSource[]>();

const citationDecorations = StateField.define<{
  sources: RetrievedKnowledgeSource[];
  decorations: DecorationSet;
}>({
  create(state) {
    return {
      sources: [],
      decorations: buildCitationDecorations(state.doc.toString(), [])
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
        decorations: buildCitationDecorations(transaction.newDoc.toString(), sources)
      };
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field, (value) => value.decorations);
  }
});

function buildCitationDecorations(doc: string, sources: RetrievedKnowledgeSource[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sourceByRef = new Map(sources.map((source) => [source.publicRef.toLowerCase(), source]));
  citationGroupPattern.lastIndex = 0;
  for (const match of doc.matchAll(citationGroupPattern)) {
    if (match.index === undefined) {
      continue;
    }
    const citationSources = sourcesForCitationGroup(match[0], sourceByRef);
    const fallbackRefs = refsForCitationGroup(match[0]);
    builder.add(
      match.index,
      match.index + match[0].length,
      Decoration.replace({
        widget: new CitationWidget(citationSources, fallbackRefs)
      })
    );
  }
  return builder.finish();
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
    element.title = sources.map(sourceTooltip).join('\n\n');

    if (sources.length === 1) {
      element.textContent = shortTitle(first.itemTitle);
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
      card.title = sourceTooltip(source);
      cards.append(card);
    });
    element.append(label, cards);
    return element;
  }

  ignoreEvent() {
    return false;
  }
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

function sourceTooltip(source: Pick<RetrievedKnowledgeSource, 'itemTitle' | 'publicRef' | 'snippet'>): string {
  return `${source.itemTitle}\n\n${source.snippet || source.publicRef}`;
}
