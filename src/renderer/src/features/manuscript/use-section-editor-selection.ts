import { matchesShortcut } from '@/lib/keyboard-shortcuts'
import {
  agentQuickActionSelectedTextSchema,
  type AgentQuickActionId,
  type AgentQuickActionRequest
} from '../../../../shared/contracts/agent-quick-actions'
import type { SectionRevision } from '../../../../shared/contracts/manuscript'
import { captureCommentSegments } from './comment-highlight-extension'
import { selectionContainsStructuredSource } from './inline-math-guard'
import type { EditorExactSelectionSnapshot, EditorSelectionContext } from './section-editor'
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

type SelectionDocument = Parameters<typeof captureCommentSegments>[0]

interface SelectionEditor {
  getSelection(): { blocks: readonly { id: string }[] } | undefined
  getSelectedText(): string
  getTextCursorPosition(): { block: { id: string } }
  prosemirrorView: {
    hasFocus(): boolean
    state: {
      doc: SelectionDocument
      selection: { empty: boolean; from: number; to: number }
    }
  }
}

interface UseSectionEditorSelectionOptions {
  editor: SelectionEditor
  baseRevisionRef: { readonly current: Pick<SectionRevision, 'sectionRevisionId' | 'contentHash'> }
  active?: boolean
  onSelectionContextChange?(context: EditorSelectionContext): void
  onQuickActionRequest?(
    request: AgentQuickActionRequest,
    selection: EditorExactSelectionSnapshot
  ): void
  onQuickActionError?(message: string): void
  onAddComment?(selection: EditorExactSelectionSnapshot): void
  setQuickActionMenuOpen: Dispatch<SetStateAction<boolean>>
  setCustomQuickActionOpen: Dispatch<SetStateAction<boolean>>
  setCustomInstruction: Dispatch<SetStateAction<string>>
  setCustomSelection: Dispatch<SetStateAction<EditorExactSelectionSnapshot | null>>
}

export interface SectionEditorSelectionController {
  captureSelection(): EditorExactSelectionSnapshot | null
  clearSelectionSnapshot(): void
  handleSelectionChange(): void
  handleQuickActionShortcut(event: KeyboardEvent): void
  requestAddComment(): void
  requestQuickAction(action: AgentQuickActionId): void
}

export function useSectionEditorSelection(
  options: UseSectionEditorSelectionOptions
): SectionEditorSelectionController {
  const {
    editor,
    baseRevisionRef,
    active,
    onSelectionContextChange,
    onQuickActionRequest,
    onQuickActionError,
    onAddComment,
    setQuickActionMenuOpen,
    setCustomQuickActionOpen,
    setCustomInstruction,
    setCustomSelection
  } = options
  const lastExactSelectionRef = useRef<EditorExactSelectionSnapshot | null>(null)

  const clearSelectionSnapshot = useCallback((): void => {
    lastExactSelectionRef.current = null
  }, [])

  const captureSelection = useCallback((): EditorExactSelectionSnapshot | null => {
    const selection = editor.getSelection()
    const parsedText = agentQuickActionSelectedTextSchema.safeParse(editor.getSelectedText())
    if (selection !== undefined && parsedText.success && selection.blocks.length > 0) {
      const selectedBlockIds = selection.blocks.map((block) => block.id)
      const cursorBlockId = editor.getTextCursorPosition().block.id
      const snapshot = {
        activeBlockId: selectedBlockIds.includes(cursorBlockId)
          ? cursorBlockId
          : (selectedBlockIds[0] ?? cursorBlockId),
        selectedBlockIds,
        selectedText: parsedText.data,
        capturedAt: Date.now(),
        capturedRevisionId: baseRevisionRef.current.sectionRevisionId,
        capturedContentHash: baseRevisionRef.current.contentHash,
        commentSegments: captureCommentSegments(
          editor.prosemirrorView.state.doc,
          editor.prosemirrorView.state.selection.from,
          editor.prosemirrorView.state.selection.to
        )
      }
      lastExactSelectionRef.current = snapshot
      return snapshot
    }
    lastExactSelectionRef.current = null
    return null
  }, [baseRevisionRef, editor])

  const handleSelectionChange = useCallback((): void => {
    const cursor = editor.getTextCursorPosition()
    const selection = editor.getSelection()
    if (selection === undefined || editor.getSelectedText().trim().length === 0) {
      clearSelectionSnapshot()
    }
    onSelectionContextChange?.({
      activeBlockId: cursor.block.id,
      selectedBlockIds: selection?.blocks.map((block) => block.id) ?? [cursor.block.id],
      selectedText: selection === undefined ? null : (captureSelection()?.selectedText ?? null)
    })
  }, [captureSelection, clearSelectionSnapshot, editor, onSelectionContextChange])

  const requestAddComment = useCallback((): void => {
    const proseMirrorSelection = editor.prosemirrorView.state.selection
    if (
      selectionContainsStructuredSource(
        editor.prosemirrorView.state.doc,
        proseMirrorSelection.from,
        proseMirrorSelection.to
      ) ||
      selectionContainsTable(
        editor.prosemirrorView.state.doc,
        proseMirrorSelection.from,
        proseMirrorSelection.to
      )
    ) {
      onQuickActionError?.(
        'Comments currently support prose, lists, and links. Select text outside tables, formulas, or diagrams.'
      )
      return
    }
    const selection = captureSelection()
    if (selection === null || selection.commentSegments.length === 0) {
      onQuickActionError?.('Select manuscript text before adding a comment.')
      return
    }
    onAddComment?.(selection)
  }, [captureSelection, editor, onAddComment, onQuickActionError])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (active === false) return
      if (!matchesShortcut(event, 'comment') || !onAddComment) return
      if (!editor.prosemirrorView.hasFocus() || editor.prosemirrorView.state.selection.empty) return
      event.preventDefault()
      requestAddComment()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [active, editor, onAddComment, requestAddComment])

  const requestQuickAction = useCallback(
    (action: AgentQuickActionId): void => {
      const proseMirrorSelection = editor.prosemirrorView.state.selection
      if (
        selectionContainsStructuredSource(
          editor.prosemirrorView.state.doc,
          proseMirrorSelection.from,
          proseMirrorSelection.to
        )
      ) {
        onQuickActionError?.(
          'Quick actions cannot cross formulas or diagrams. Select prose only, or ask the Agent to edit the whole block.'
        )
        return
      }
      const selection = captureSelection()
      if (selection === null) {
        onQuickActionError?.('Select text in the manuscript before using a quick action.')
        return
      }
      if (action === 'custom') {
        setCustomSelection(selection)
        setCustomInstruction('')
        setCustomQuickActionOpen(true)
        return
      }
      onQuickActionRequest?.({ action }, selection)
    },
    [
      captureSelection,
      editor,
      onQuickActionError,
      onQuickActionRequest,
      setCustomInstruction,
      setCustomQuickActionOpen,
      setCustomSelection
    ]
  )

  const handleQuickActionShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (active === false) return
      if (!matchesShortcut(event, 'quickActions')) return
      if (!editor.prosemirrorView.hasFocus() || editor.prosemirrorView.state.selection.empty) return
      event.preventDefault()
      event.stopPropagation()
      const proseMirrorSelection = editor.prosemirrorView.state.selection
      if (
        selectionContainsStructuredSource(
          editor.prosemirrorView.state.doc,
          proseMirrorSelection.from,
          proseMirrorSelection.to
        )
      ) {
        onQuickActionError?.(
          'Quick actions cannot cross formulas or diagrams. Select prose only, or ask the Agent to edit the whole block.'
        )
        return
      }
      if (captureSelection() === null) {
        onQuickActionError?.('Select text in the manuscript before using a quick action.')
        return
      }
      setQuickActionMenuOpen(true)
    },
    [active, captureSelection, editor, onQuickActionError, setQuickActionMenuOpen]
  )

  return {
    captureSelection,
    clearSelectionSnapshot,
    handleSelectionChange,
    handleQuickActionShortcut,
    requestAddComment,
    requestQuickAction
  }
}

function selectionContainsTable(document: SelectionDocument, from: number, to: number): boolean {
  let found = false
  document.nodesBetween(from, to, (node) => {
    if (!['table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type.name)) return !found
    found = true
    return false
  })
  return found
}
