import { createExtension, type ExtensionOptions } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { CitationDisplayMode } from '../../../../shared/contracts/app'
import { normalizeCitationTitle } from '../../../../shared/readable-citation'
import { findCitationClusters } from '../../../../shared/citation-cluster'
import { findReadableCitations, type ReadableCitationMatch } from './readable-citation'

const PLUGIN_KEY = new PluginKey<DecorationSet>('writellm-readable-citations')
const CITATION_SELECTOR = '[data-writellm-readable-citation]'

export interface ReadableCitationActivation {
  blockId: string
  citation: Omit<ReadableCitationMatch, 'from' | 'to'>
  element: HTMLElement
}

export interface ReadableCitationPresentation {
  mode: CitationDisplayMode
  numberByTitle: ReadonlyMap<string, number>
  numberByCitationKey?: ReadonlyMap<string, number>
  formattedByRaw?: ReadonlyMap<string, string>
}

const FULL_PRESENTATION: ReadableCitationPresentation = {
  mode: 'full',
  numberByTitle: new Map()
}

export const readableCitationExtension = createExtension(
  ({
    options
  }: ExtensionOptions<{
    onActivate(activation: ReadableCitationActivation): void
    getPresentation?(): ReadableCitationPresentation
  }>) => ({
    key: 'writellmReadableCitations',
    prosemirrorPlugins: [
      new Plugin<DecorationSet>({
        key: PLUGIN_KEY,
        state: {
          init: (_configuration, state) =>
            buildReadableCitationDecorations(
              state.doc,
              options.getPresentation?.() ?? FULL_PRESENTATION,
              state.selection
            ),
          apply: (transaction, decorations) =>
            transaction.docChanged || transaction.selectionSet || transaction.getMeta(PLUGIN_KEY)
              ? buildReadableCitationDecorations(
                  transaction.doc,
                  options.getPresentation?.() ?? FULL_PRESENTATION,
                  transaction.selection
                )
              : decorations.map(transaction.mapping, transaction.doc)
        },
        props: {
          decorations: (state) => PLUGIN_KEY.getState(state) ?? DecorationSet.empty,
          handleClick: (view, _position, event) =>
            activateReadableCitation(event.target, view.dom, options.onActivate),
          handleKeyDown: (view, event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return false
            if (!activateReadableCitation(event.target, view.dom, options.onActivate)) return false
            event.preventDefault()
            return true
          }
        }
      })
    ]
  })
)

export function activateReadableCitation(
  target: EventTarget | null,
  editorDom: HTMLElement,
  onActivate: (activation: ReadableCitationActivation) => void
): boolean {
  const element = target instanceof Element ? target.closest<HTMLElement>(CITATION_SELECTOR) : null
  if (element === null || !editorDom.contains(element)) return false
  const blockId = element.closest<HTMLElement>('[data-id]')?.dataset.id
  const title = element.dataset.citationTitle
  const raw = element.dataset.citationRaw
  const syntax = element.dataset.citationSyntax
  if (
    blockId === undefined ||
    title === undefined ||
    raw === undefined ||
    (syntax !== 'english' && syntax !== 'chinese')
  ) {
    return false
  }
  const rawPageIndex = element.dataset.citationPageIndex
  const pageIndex = rawPageIndex === undefined ? undefined : Number(rawPageIndex)
  if (pageIndex !== undefined && (!Number.isSafeInteger(pageIndex) || pageIndex < 0)) return false
  onActivate({
    blockId,
    element,
    citation: { raw, syntax, title, ...(pageIndex === undefined ? {} : { pageIndex }) }
  })
  return true
}

export function buildReadableCitationDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  presentation: ReadableCitationPresentation = FULL_PRESENTATION,
  selection?: { from: number; to: number }
): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, '', '\uFFFC')
    const citations: PresentableCitation[] = [
      ...findReadableCitations(text).map((citation) => ({ ...citation, citationKeys: [] })),
      ...findCitationClusters(text).map((cluster) => ({
        from: cluster.from,
        to: cluster.to,
        raw: cluster.raw,
        syntax: cluster.syntax,
        title: cluster.items[0]?.citationKey ?? '',
        citationKeys: cluster.items.map((item) => item.citationKey),
        ...(cluster.items[0]?.locator === undefined
          ? {}
          : { pageIndex: cluster.items[0].locator.startPageIndex })
      }))
    ].sort((left, right) => left.from - right.from)
    for (const citation of citations) {
      const from = position + 1 + citation.from
      const to = position + 1 + citation.to
      const selected = selection !== undefined && selection.from <= to && selection.to >= from
      const numbers =
        citation.citationKeys.length === 0
          ? [presentation.numberByTitle.get(normalizeCitationTitle(citation.title))].filter(
              (value): value is number => value !== undefined
            )
          : citation.citationKeys
              .map(
                (key) =>
                  presentation.numberByCitationKey?.get(key) ?? presentation.numberByTitle.get(key)
              )
              .filter((value): value is number => value !== undefined)
      const formatted = presentation.formattedByRaw?.get(citation.raw)
      const allNumbersAvailable = numbers.length === Math.max(1, citation.citationKeys.length)
      const compactReady =
        (presentation.mode === 'icon' && allNumbersAvailable) ||
        (presentation.mode === 'numbered' && allNumbersAvailable) ||
        (presentation.mode === 'formatted' && formatted !== undefined)
      if (presentation.mode !== 'full' && !selected && compactReady) {
        const compactMode = presentation.mode
        decorations.push(
          Decoration.inline(from, to, {
            class: 'writellm-readable-citation-source-hidden',
            'aria-hidden': 'true'
          }),
          Decoration.widget(to, () => citationWidget(citation, compactMode, numbers, formatted), {
            side: 1,
            key: `${compactMode}:${numbers.join(',')}:${formatted ?? ''}:${from}:${citation.raw}`
          })
        )
        continue
      }
      decorations.push(
        Decoration.inline(from, to, citationAttributes(citation, 'writellm-readable-citation'))
      )
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

export function refreshReadableCitationDecorations(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(PLUGIN_KEY, true))
}

function citationWidget(
  citation: PresentableCitation,
  mode: Exclude<CitationDisplayMode, 'full'>,
  numbers: readonly number[],
  formatted?: string
): HTMLElement {
  const element = document.createElement('span')
  for (const [key, value] of Object.entries(
    citationAttributes(citation, `writellm-readable-citation writellm-readable-citation-${mode}`)
  )) {
    element.setAttribute(key, value)
  }
  element.dataset.citationNumber = numbers.join(',')
  if (mode === 'numbered') {
    element.textContent = `[${numbers.join('; ')}]`
  } else if (mode === 'formatted') {
    element.textContent = formatted ?? citation.raw
  } else {
    element.append(createReferenceIcon())
  }
  return element
}

interface PresentableCitation extends ReadableCitationMatch {
  citationKeys: readonly string[]
}

function citationAttributes(
  citation: ReadableCitationMatch,
  className: string
): Record<string, string> {
  return {
    class: className,
    'data-writellm-readable-citation': 'true',
    'data-citation-title': citation.title,
    'data-citation-raw': citation.raw,
    'data-citation-syntax': citation.syntax,
    ...(citation.pageIndex === undefined
      ? {}
      : { 'data-citation-page-index': String(citation.pageIndex) }),
    role: 'button',
    tabindex: '0',
    'aria-label': `Preview source: ${citation.title}`
  }
}

function createReferenceIcon(): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.classList.add('lucide', 'lucide-book-open-text')
  for (const d of [
    'M12 7v14',
    'M16 12h2',
    'M16 8h2',
    'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
    'M6 12h2',
    'M6 8h2'
  ]) {
    const path = document.createElementNS(namespace, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}
