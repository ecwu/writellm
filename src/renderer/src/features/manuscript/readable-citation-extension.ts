import { createExtension, type ExtensionOptions } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { findReadableCitations, type ReadableCitationMatch } from './readable-citation'

const PLUGIN_KEY = new PluginKey<DecorationSet>('writellm-readable-citations')
const CITATION_SELECTOR = '[data-writellm-readable-citation]'

export interface ReadableCitationActivation {
  blockId: string
  citation: Omit<ReadableCitationMatch, 'from' | 'to'>
  element: HTMLElement
}

export const readableCitationExtension = createExtension(
  ({
    options
  }: ExtensionOptions<{ onActivate(activation: ReadableCitationActivation): void }>) => ({
    key: 'writellmReadableCitations',
    prosemirrorPlugins: [
      new Plugin<DecorationSet>({
        key: PLUGIN_KEY,
        state: {
          init: (_configuration, state) => buildReadableCitationDecorations(state.doc),
          apply: (transaction, decorations) =>
            transaction.docChanged
              ? buildReadableCitationDecorations(transaction.doc)
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
  doc: Parameters<typeof DecorationSet.create>[0]
): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    const text = node.textBetween(0, node.content.size, '', '\uFFFC')
    for (const citation of findReadableCitations(text)) {
      decorations.push(
        Decoration.inline(position + 1 + citation.from, position + 1 + citation.to, {
          class: 'writellm-readable-citation',
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
        })
      )
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}
