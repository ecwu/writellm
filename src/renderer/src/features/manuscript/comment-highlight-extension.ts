import { createExtension, type ExtensionOptions } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { CommentAnchorSegment } from '../../../../shared/contracts/manuscript-comments'

export interface CommentDecorationAnchor {
  threadId: string
  resolved: boolean
  segments: readonly CommentAnchorSegment[]
}

type ProseMirrorNode = Parameters<typeof DecorationSet.create>[0]
const PLUGIN_KEY = new PluginKey<DecorationSet>('writellm-comment-highlights')

export const commentHighlightExtension = createExtension(
  ({
    options
  }: ExtensionOptions<{
    getAnchors(): readonly CommentDecorationAnchor[]
    getSelectedThreadId(): string | null
    onActivate(threadIds: readonly string[]): void
  }>) => ({
    key: 'writellmCommentHighlights',
    prosemirrorPlugins: [
      new Plugin<DecorationSet>({
        key: PLUGIN_KEY,
        state: {
          init: (_configuration, state) =>
            buildCommentDecorations(state.doc, options.getAnchors(), options.getSelectedThreadId()),
          apply: (transaction, decorations) =>
            transaction.getMeta(PLUGIN_KEY)
              ? buildCommentDecorations(
                  transaction.doc,
                  options.getAnchors(),
                  options.getSelectedThreadId()
                )
              : decorations.map(transaction.mapping, transaction.doc)
        },
        props: {
          decorations: (state) => PLUGIN_KEY.getState(state) ?? DecorationSet.empty,
          handleClick: (view, position) => {
            const threadIds = activeThreadIdsAtPosition(view, position)
            if (threadIds.length === 0) return false
            options.onActivate(threadIds)
            return true
          }
        }
      })
    ]
  })
)

export function refreshCommentHighlights(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(PLUGIN_KEY, true))
}

export function buildCommentDecorations(
  doc: ProseMirrorNode,
  anchors: readonly CommentDecorationAnchor[],
  selectedThreadId: string | null
): DecorationSet {
  const byBlock = new Map<
    string,
    Array<{ threadId: string; resolved: boolean; from: number; to: number }>
  >()
  for (const anchor of anchors) {
    for (const segment of anchor.segments) {
      const values = byBlock.get(segment.blockId) ?? []
      values.push({
        threadId: anchor.threadId,
        resolved: anchor.resolved,
        from: segment.from,
        to: segment.to
      })
      byBlock.set(segment.blockId, values)
    }
  }
  const decorations: Decoration[] = []
  visitTextblocks(doc, (node, position, blockId) => {
    if (blockId === null) return
    for (const value of byBlock.get(blockId) ?? []) {
      const from = position + 1 + Math.min(value.from, node.content.size)
      const to = position + 1 + Math.min(value.to, node.content.size)
      if (from >= to) continue
      decorations.push(
        Decoration.inline(from, to, {
          class:
            value.threadId === selectedThreadId
              ? 'writellm-comment-anchor writellm-comment-anchor-selected'
              : value.resolved
                ? 'writellm-comment-anchor writellm-comment-anchor-resolved'
                : 'writellm-comment-anchor',
          'data-comment-thread-id': value.threadId
        })
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

export function captureCommentSegments(
  doc: ProseMirrorNode,
  from: number,
  to: number
): CommentAnchorSegment[] {
  const segments: CommentAnchorSegment[] = []
  visitTextblocks(doc, (node, position, blockId) => {
    if (blockId === null) return
    const contentFrom = position + 1
    const contentTo = contentFrom + node.content.size
    const overlapFrom = Math.max(from, contentFrom)
    const overlapTo = Math.min(to, contentTo)
    if (overlapFrom < overlapTo)
      segments.push({ blockId, from: overlapFrom - contentFrom, to: overlapTo - contentFrom })
  })
  return segments
}

function activeThreadIdsAtPosition(view: EditorView, position: number): string[] {
  const ids = new Set<string>()
  for (const decoration of (PLUGIN_KEY.getState(view.state) ?? DecorationSet.empty).find(
    position,
    position
  )) {
    const id = (decoration as unknown as { type: { attrs?: Record<string, unknown> } }).type
      .attrs?.['data-comment-thread-id']
    if (typeof id === 'string') ids.add(id)
  }
  return [...ids]
}

function visitTextblocks(
  doc: ProseMirrorNode,
  visitor: (node: ProseMirrorNode, position: number, blockId: string | null) => void
): void {
  const visit = (
    node: ProseMirrorNode,
    position: number,
    inheritedBlockId: string | null
  ): void => {
    const blockId = typeof node.attrs.id === 'string' ? node.attrs.id : inheritedBlockId
    if (node.isTextblock) visitor(node, position, blockId)
    node.forEach((child, offset) => {
      visit(child, position + offset + (node === doc ? 0 : 1), blockId)
    })
  }
  visit(doc, 0, null)
}
