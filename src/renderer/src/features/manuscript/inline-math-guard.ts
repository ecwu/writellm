import { createExtension, type ExtensionOptions } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { MAX_INLINE_MATH_SOURCE_BYTES } from '../../../../shared/contracts/manuscript'

const PLUGIN_KEY = new PluginKey('writellm-inline-math-guard')

interface ProseMirrorContentNodeLike {
  readonly textContent: string
  readonly type: { readonly name: string }
}

interface ProseMirrorNodeLike extends ProseMirrorContentNodeLike {
  descendants(callback: (node: ProseMirrorContentNodeLike) => boolean): void
  nodesBetween(
    from: number,
    to: number,
    callback: (node: ProseMirrorContentNodeLike) => boolean
  ): void
}

export const inlineMathGuardExtension = createExtension(
  ({ options }: ExtensionOptions<{ onReject(): void }>) => ({
    key: 'writellmInlineMathGuard',
    prosemirrorPlugins: [
      new Plugin({
        key: PLUGIN_KEY,
        filterTransaction: (transaction) => {
          if (!transaction.docChanged || isInlineMathDocumentValid(transaction.doc)) return true
          options.onReject()
          return false
        }
      })
    ]
  })
)

export function isInlineMathDocumentValid(document: ProseMirrorNodeLike): boolean {
  let valid = true
  document.descendants((node) => {
    if (node.type.name !== 'math') return valid
    const source = node.textContent
    if (
      source.length > 8_192 ||
      /[\r\n\0]/u.test(source) ||
      new TextEncoder().encode(source).byteLength > MAX_INLINE_MATH_SOURCE_BYTES
    ) {
      valid = false
      return false
    }
    return true
  })
  return valid
}

export function selectionContainsInlineMath(
  document: ProseMirrorNodeLike,
  from: number,
  to: number
): boolean {
  let found = false
  document.nodesBetween(from, to, (node) => {
    if (node.type.name !== 'math') return !found
    found = true
    return false
  })
  return found
}
