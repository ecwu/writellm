import { createExtension, type ExtensionOptions } from '@blocknote/core'
import type { ManuscriptSearchTargetContract } from '../../../../shared/contracts/manuscript-search'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

type ProseMirrorNode = Parameters<typeof DecorationSet.create>[0]

const PLUGIN_KEY = new PluginKey<DecorationSet>('writellm-search-highlight')

export const manuscriptSearchHighlightExtension = createExtension(
  ({
    options
  }: ExtensionOptions<{
    getTarget(): ManuscriptSearchTargetContract | null
    onInvalidated(): void
  }>) => ({
    key: 'writellmSearchHighlight',
    prosemirrorPlugins: [
      new Plugin<DecorationSet>({
        key: PLUGIN_KEY,
        state: {
          init: (_configuration, state) => buildSearchDecorations(state.doc, options.getTarget()),
          apply: (transaction, decorations) => {
            if (transaction.docChanged) {
              if (options.getTarget() !== null) options.onInvalidated()
              return DecorationSet.empty
            }
            return transaction.getMeta(PLUGIN_KEY)
              ? buildSearchDecorations(transaction.doc, options.getTarget())
              : decorations.map(transaction.mapping, transaction.doc)
          }
        },
        props: { decorations: (state) => PLUGIN_KEY.getState(state) ?? DecorationSet.empty }
      })
    ]
  })
)

export function refreshSearchHighlight(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(PLUGIN_KEY, true))
}

export function buildSearchDecorations(
  doc: ProseMirrorNode,
  target: ManuscriptSearchTargetContract | null
): DecorationSet {
  if (target === null || !('blockId' in target)) {
    return DecorationSet.empty
  }
  const bodyTarget = target
  const decorations: Decoration[] = []
  let foundBlock = false
  let tableRowIndex = -1
  let tableCellIndex = -1
  const visit = (node: ProseMirrorNode, position: number, blockId: string | null): void => {
    const ownId = typeof node.attrs.id === 'string' ? node.attrs.id : blockId
    const inTargetBlock = ownId === bodyTarget.blockId
    const nodeType = node.type.name.toLowerCase()
    if (inTargetBlock && nodeType.includes('tablerow')) {
      tableRowIndex += 1
      tableCellIndex = -1
    } else if (
      inTargetBlock &&
      (nodeType.includes('tablecell') || nodeType.includes('tableheader'))
    ) {
      tableCellIndex += 1
    }
    if (inTargetBlock) foundBlock = true
    if (node.isTextblock && inTargetBlock) {
      const shouldDecorate =
        bodyTarget.kind === 'block_inline' ||
        (bodyTarget.kind === 'table_cell' &&
          tableRowIndex === bodyTarget.rowIndex &&
          tableCellIndex === bodyTarget.cellIndex)
      if (shouldDecorate) {
        const from = position + 1 + bodyTarget.flatRange.from
        const to = position + 1 + Math.min(bodyTarget.flatRange.to, node.content.size)
        if (from < to && to <= position + 1 + node.content.size) {
          decorations.push(
            Decoration.inline(from, to, {
              class: 'writellm-search-match',
              'data-writellm-search-match': 'true'
            })
          )
        }
      }
    }
    if (bodyTarget.kind === 'block_caption' && inTargetBlock && node.isBlock && node.nodeSize > 1) {
      decorations.push(
        Decoration.node(position, position + node.nodeSize, {
          class: 'writellm-search-match-block',
          'data-writellm-search-match': 'true'
        })
      )
      return
    }
    node.forEach((child, offset) => {
      visit(child, position + offset + (node === doc ? 0 : 1), ownId)
    })
  }
  visit(doc, 0, null)
  if (!foundBlock) return DecorationSet.empty
  return DecorationSet.create(doc, decorations)
}
