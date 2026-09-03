import { findCitationClusters } from '../../../../shared/citation-cluster'
import type { ApprovedBlockNoteEditor } from './editor-schema'
import { findReadableCitations } from './readable-citation'

const DISALLOWED_PARENT_TYPES = new Set(['codeBlock', 'diagram', 'math', 'mathBlock'])

export function isCitationCommandAllowed(editor: ApprovedBlockNoteEditor, query: string): boolean {
  const state = editor.prosemirrorView.state
  if (!state.selection.empty) return false
  const cursor = state.selection.$from
  if (cursor.marks().some((mark) => mark.type.name === 'code')) return false
  for (let depth = cursor.depth; depth >= 0; depth -= 1) {
    if (DISALLOWED_PARENT_TYPES.has(cursor.node(depth).type.name)) return false
  }

  const commandLength = query.length + 1
  const commandStart = cursor.parentOffset - commandLength
  if (commandStart < 0) return false
  const parentText = cursor.parent.textBetween(0, cursor.parent.content.size, '', '\uFFFC')
  const withoutCommand = `${parentText.slice(0, commandStart)}${parentText.slice(cursor.parentOffset)}`
  return ![...findCitationClusters(withoutCommand), ...findReadableCitations(withoutCommand)].some(
    (citation) => citation.from < commandStart && citation.to > commandStart
  )
}
