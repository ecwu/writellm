import { createExtension, type ExtensionOptions } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import {
  MAX_BLOCK_MATH_SOURCE_BYTES,
  MAX_DIAGRAM_SOURCE_BYTES,
  MAX_INLINE_MATH_SOURCE_BYTES
} from '../../../../shared/contracts/manuscript'
import { isMathSourceStructurallySafe } from '../../../../shared/math-source-safety'

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
  ({ options }: ExtensionOptions<{ onReject(message: string): void }>) => ({
    key: 'writellmInlineMathGuard',
    prosemirrorPlugins: [
      new Plugin({
        key: PLUGIN_KEY,
        filterTransaction: (transaction) => {
          if (!transaction.docChanged || isStructuredSourceDocumentValid(transaction.doc)) {
            return true
          }
          options.onReject(
            'Formula or diagram source exceeds its safe size limit or uses a blocked command.'
          )
          return false
        }
      })
    ]
  })
)

export function isStructuredSourceDocumentValid(document: ProseMirrorNodeLike): boolean {
  let valid = true
  document.descendants((node) => {
    const source = node.textContent
    if (node.type.name === 'math') {
      valid =
        source.length <= 8_192 &&
        !/[\r\n\0]/u.test(source) &&
        new TextEncoder().encode(source).byteLength <= MAX_INLINE_MATH_SOURCE_BYTES &&
        isMathSourceStructurallySafe(source)
    } else if (node.type.name === 'mathBlock') {
      valid =
        source.length <= 32_000 &&
        new TextEncoder().encode(source).byteLength <= MAX_BLOCK_MATH_SOURCE_BYTES &&
        isMathSourceStructurallySafe(source)
    } else if (node.type.name === 'diagram') {
      valid =
        !source.includes('\0') &&
        source.length <= 64_000 &&
        new TextEncoder().encode(source).byteLength <= MAX_DIAGRAM_SOURCE_BYTES
    }
    if (!valid) {
      valid = false
      return false
    }
    return true
  })
  return valid
}

export function selectionContainsStructuredSource(
  document: ProseMirrorNodeLike,
  from: number,
  to: number
): boolean {
  let found = false
  document.nodesBetween(from, to, (node) => {
    if (!['math', 'mathBlock', 'diagram'].includes(node.type.name)) return !found
    found = true
    return false
  })
  return found
}
