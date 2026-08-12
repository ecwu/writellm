import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { approvedEditorSchema } from './editor-schema'
import {
  buildReadableCitationDecorations,
  readableCitationExtension
} from './readable-citation-extension'

describe('readable citation BlockNote extension', () => {
  it('decorates citations across styled text nodes without changing native JSON', () => {
    const initialContent = [
      {
        id: 'citation-block',
        type: 'paragraph' as const,
        content: [
          { type: 'text' as const, text: 'Claim [Source: Split', styles: {} },
          { type: 'text' as const, text: ' source.pdf, p. 2]', styles: { italic: true } },
          { type: 'text' as const, text: ' remains.', styles: {} }
        ]
      }
    ]
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent,
      extensions: [readableCitationExtension({ onActivate: vi.fn() })]
    })
    const before = JSON.parse(JSON.stringify(editor.document))
    const decorations = buildReadableCitationDecorations(editor._tiptapEditor.state.doc)

    expect(decorations.find()).toHaveLength(1)
    const attributes = (
      decorations.find()[0] as unknown as { type: { attrs: Record<string, string> } }
    ).type.attrs
    expect(attributes).toMatchObject({
      class: 'writellm-readable-citation',
      'data-citation-title': 'Split source.pdf',
      'data-citation-page-index': '1',
      role: 'button',
      tabindex: '0'
    })
    expect(JSON.parse(JSON.stringify(editor.document))).toEqual(before)
  })

  it('recomputes decorations after document edits', () => {
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent: [{ id: 'citation-block', type: 'paragraph', content: 'Plain text' }],
      extensions: [readableCitationExtension({ onActivate: vi.fn() })]
    })
    expect(buildReadableCitationDecorations(editor._tiptapEditor.state.doc).find()).toHaveLength(0)

    editor.updateBlock('citation-block', { content: 'Claim 【来源：论文.pdf，第 4 页】' })

    expect(buildReadableCitationDecorations(editor._tiptapEditor.state.doc).find()).toHaveLength(1)
  })

  it('renders numbered and icon widgets while revealing the full citation at the caret', () => {
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent: [
        { id: 'citation-block', type: 'paragraph', content: 'Claim [Source: Evidence.pdf].' }
      ]
    })
    const numbers = new Map([['Evidence.pdf', 7]])
    const numbered = buildReadableCitationDecorations(editor._tiptapEditor.state.doc, {
      mode: 'numbered',
      numberByTitle: numbers
    }).find()
    expect(numbered).toHaveLength(2)
    expect(
      numbered.some(
        (decoration) =>
          (decoration as unknown as { type: { attrs?: Record<string, string> } }).type.attrs
            ?.class === 'writellm-readable-citation-source-hidden'
      )
    ).toBe(true)
    const widget = numbered.find(
      (decoration) =>
        typeof (decoration as unknown as { type: { toDOM?: unknown } }).type.toDOM === 'function'
    ) as unknown as { type: { spec: { key: string }; toDOM: () => HTMLElement } }
    expect(widget.type.spec.key).toContain('numbered:7')

    const icon = buildReadableCitationDecorations(editor._tiptapEditor.state.doc, {
      mode: 'icon',
      numberByTitle: numbers
    }).find()
    const iconWidget = icon.find(
      (decoration) =>
        typeof (decoration as unknown as { type: { toDOM?: unknown } }).type.toDOM === 'function'
    ) as unknown as { type: { spec: { key: string }; toDOM: () => HTMLElement } }
    expect(iconWidget.type.spec.key).toContain('icon:7')

    const fullAtCaret = buildReadableCitationDecorations(
      editor._tiptapEditor.state.doc,
      { mode: 'numbered', numberByTitle: numbers },
      { from: 10, to: 10 }
    ).find()
    expect(fullAtCaret).toHaveLength(1)
  })
})
