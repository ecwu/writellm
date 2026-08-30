import type { BlockNoteInlineContent } from './contracts/manuscript'

export function blockNoteInlinePlainText(content: readonly BlockNoteInlineContent[]): string {
  return content
    .map((node) =>
      node.type === 'link'
        ? node.content.map((child) => child.text).join('')
        : node.type === 'math'
          ? '\uFFFC'
          : node.text
    )
    .join('')
}
