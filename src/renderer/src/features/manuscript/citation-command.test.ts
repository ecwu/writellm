import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { approvedEditorSchema } from './editor-schema'
import { isCitationCommandAllowed } from './citation-command'

function editorWithText(text: string, beforeFinalCharacter = false) {
  const editor = BlockNoteEditor.create({
    schema: approvedEditorSchema,
    initialContent: [{ id: 'paragraph', type: 'paragraph', content: text }]
  })
  editor.setTextCursorPosition('paragraph', 'end')
  if (beforeFinalCharacter) {
    editor._tiptapEditor.commands.setTextSelection(editor._tiptapEditor.state.selection.from - 1)
  }
  return editor
}

function editorWithBlock(type: 'codeBlock' | 'diagram' | 'mathBlock') {
  const editor = BlockNoteEditor.create({
    schema: approvedEditorSchema,
    initialContent: [{ id: 'structured', type, content: '/cite' }]
  })
  editor.setTextCursorPosition('structured', 'end')
  return editor
}

function editorWithInlineCode() {
  const editor = BlockNoteEditor.create({
    schema: approvedEditorSchema,
    initialContent: [
      {
        id: 'inline-code',
        type: 'paragraph',
        content: [{ type: 'text', text: '/cite', styles: { code: true } }]
      }
    ]
  })
  editor.setTextCursorPosition('inline-code', 'end')
  return editor
}

describe('citation slash command', () => {
  it('allows a collapsed prose cursor after /cite', () => {
    expect(isCitationCommandAllowed(editorWithText('Claim /cite'), 'cite')).toBe(true)
  })

  it('rejects a command typed inside an existing canonical citation', () => {
    expect(isCitationCommandAllowed(editorWithText('Claim [@key/cite]', true), 'cite')).toBe(false)
  })

  it('rejects a command typed inside an existing legacy citation', () => {
    expect(
      isCitationCommandAllowed(editorWithText('Claim [Source: evidence/cite]', true), 'cite')
    ).toBe(false)
  })

  it.each(['codeBlock', 'diagram', 'mathBlock'] as const)(
    'rejects a command in a %s source block',
    (type) => {
      expect(isCitationCommandAllowed(editorWithBlock(type), 'cite')).toBe(false)
    }
  )

  it('rejects a command inside inline code', () => {
    expect(isCitationCommandAllowed(editorWithInlineCode(), 'cite')).toBe(false)
  })
})
