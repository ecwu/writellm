import type { BlockNoteDocument, SectionRevision } from '../../../../shared/contracts/manuscript'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { AlertCircle, Check, Download, LoaderCircle, Upload } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { approvedEditorSchema, type ApprovedEditorBlock } from './editor-schema'

export type SaveState = 'clean' | 'saving' | 'saved' | 'mirror-pending' | 'conflict' | 'failed'

export interface EditorSelectionContext {
  activeBlockId: string
  selectedBlockIds: string[]
}

export interface SectionEditorHandle {
  flush(): Promise<void>
  finalFlush(request: {
    projectSessionId: string
    closingToken: string
    purpose?: 'close' | 'snapshot'
  }): Promise<void>
}

export const SectionEditor = forwardRef<
  SectionEditorHandle,
  {
    projectSessionId: string
    revision: SectionRevision
    onRevision(revision: SectionRevision): void
    onSaveStateChange?(state: SaveState): void
    onSelectionContextChange?(context: EditorSelectionContext): void
  }
>(function SectionEditor(props, ref): React.JSX.Element {
  const initialContent =
    props.revision.content.length === 0
      ? [
          {
            id: crypto.randomUUID(),
            type: 'paragraph' as const,
            props: {
              backgroundColor: 'default',
              textColor: 'default',
              textAlignment: 'left' as const
            },
            content: [],
            children: []
          }
        ]
      : (props.revision.content as ApprovedEditorBlock[])
  const editor = useCreateBlockNote({ schema: approvedEditorSchema, initialContent })
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [readOnly, setReadOnly] = useState(false)
  const baseRef = useRef(props.revision)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const runningRef = useRef<Promise<void> | null>(null)
  const replacingImportedDocumentRef = useRef(false)
  const saveBlockedRef = useRef(false)

  useEffect(() => {
    props.onSaveStateChange?.(saveState)
  }, [props.onSaveStateChange, saveState])

  const save = async (
    closingToken?: string,
    revisionSource: 'manual_autosave' | 'manual_checkpoint' = 'manual_autosave',
    purpose?: 'close' | 'snapshot'
  ): Promise<void> => {
    if (runningRef.current !== null) {
      try {
        await runningRef.current
      } catch (error) {
        if (closingToken === undefined) throw error
      }
    }
    if (!dirtyRef.current && closingToken === undefined) return

    const operation = (async () => {
      do {
        dirtyRef.current = false
        setSaveState('saving')
        const base = baseRef.current
        const input = {
          projectSessionId: props.projectSessionId,
          sectionId: base.sectionId,
          baseRevisionId: base.sectionRevisionId,
          baseContentHash: base.contentHash,
          document: JSON.parse(JSON.stringify(editor.document)) as BlockNoteDocument,
          revisionSource
        }
        let conflict = false
        try {
          const response =
            closingToken === undefined
              ? await window.desktop.editor.saveSectionDocument(input)
              : await window.desktop.editor.finalFlushSave({
                  ...input,
                  closingToken,
                  ...(purpose === undefined ? {} : { purpose })
                })
          if (!response.ok) {
            conflict = true
            throw new Error(response.error.message)
          }
          const result = response.result
          baseRef.current = result.revision
          saveBlockedRef.current = false
          props.onRevision(result.revision)
          setSaveState(
            result.disposition === 'saved_materialization_pending' ? 'mirror-pending' : 'saved'
          )
        } catch (error) {
          dirtyRef.current = true
          saveBlockedRef.current = true
          setSaveState(conflict ? 'conflict' : 'failed')
          throw error
        }
      } while (dirtyRef.current && closingToken === undefined)
    })()
    runningRef.current = operation
    try {
      await operation
    } finally {
      if (runningRef.current === operation) runningRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => editor.focus())
    return () => cancelAnimationFrame(frame)
  }, [editor])

  useImperativeHandle(ref, () => ({
    async flush() {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      await save(undefined, 'manual_checkpoint')
    },
    async finalFlush(request) {
      if (request.purpose !== 'snapshot') setReadOnly(true)
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      await save(request.closingToken, 'manual_checkpoint', request.purpose)
      await window.desktop.editor.acknowledgeFlush({
        ...request,
        sectionId: baseRef.current.sectionId,
        sectionRevisionId: baseRef.current.sectionRevisionId
      })
    }
  }))

  return (
    <div className='min-h-80'>
      <div className='flex flex-wrap items-center justify-end gap-2 border-b px-3 py-2'>
        <Button
          variant='ghost'
          size='sm'
          disabled={readOnly || saveState === 'conflict'}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.md,text/markdown,text/plain'
            input.onchange = () => {
              const file = input.files?.[0]
              if (file === undefined) return
              void file
                .text()
                .then((markdown) => editor.tryParseMarkdownToBlocks(markdown))
                .then(async (blocks) => {
                  if (runningRef.current !== null) await runningRef.current
                  const base = baseRef.current
                  replacingImportedDocumentRef.current = true
                  editor.replaceBlocks(editor.document, blocks)
                  setSaveState('saving')
                  const document = JSON.parse(JSON.stringify(blocks)) as BlockNoteDocument
                  let conflict = false
                  try {
                    const response = await window.desktop.editor.importMarkdown({
                      projectSessionId: props.projectSessionId,
                      sectionId: base.sectionId,
                      baseRevisionId: base.sectionRevisionId,
                      baseContentHash: base.contentHash,
                      document
                    })
                    if (!response.ok) {
                      conflict = true
                      throw new Error(response.error.message)
                    }
                    const result = response.result
                    baseRef.current = result.revision
                    saveBlockedRef.current = false
                    props.onRevision(result.revision)
                    setSaveState(
                      result.disposition === 'saved_materialization_pending'
                        ? 'mirror-pending'
                        : 'saved'
                    )
                  } catch {
                    dirtyRef.current = true
                    saveBlockedRef.current = true
                    setSaveState(conflict ? 'conflict' : 'failed')
                  }
                })
                .catch(() => setSaveState('failed'))
            }
            input.click()
          }}
        >
          <Upload /> Import Markdown
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={() =>
            void window.desktop.editor
              .exportNativeJson({
                projectSessionId: props.projectSessionId,
                sectionId: baseRef.current.sectionId
              })
              .catch(() => setSaveState('failed'))
          }
        >
          <Download /> Native JSON
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            const revision = baseRef.current
            void window.desktop.editor
              .exportMarkdown({
                projectSessionId: props.projectSessionId,
                sectionId: revision.sectionId,
                sectionRevisionId: revision.sectionRevisionId,
                contentHash: revision.contentHash,
                markdown: editor.blocksToMarkdownLossy(revision.content as ApprovedEditorBlock[])
              })
              .catch(() => setSaveState('failed'))
          }}
        >
          <Download /> Markdown
        </Button>
        <SaveStatus state={saveState} />
      </div>
      <BlockNoteView
        editor={editor}
        editable={!readOnly && saveState !== 'conflict'}
        onChange={() => {
          if (replacingImportedDocumentRef.current) {
            replacingImportedDocumentRef.current = false
            return
          }
          dirtyRef.current = true
          if (saveBlockedRef.current) return
          setSaveState('clean')
          if (timerRef.current !== undefined) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => void save().catch(() => undefined), 1_500)
        }}
        onSelectionChange={() => {
          const cursor = editor.getTextCursorPosition()
          const selection = editor.getSelection()
          props.onSelectionContextChange?.({
            activeBlockId: cursor.block.id,
            selectedBlockIds: selection?.blocks.map((block) => block.id) ?? [cursor.block.id]
          })
        }}
        className='min-h-72 py-6'
      />
      {saveState === 'conflict' && (
        <div className='flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-destructive'>
          <p>
            This section changed elsewhere. Your local document is preserved and has not overwritten
            the database version.
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              void window.desktop.editor
                .loadSection({
                  projectSessionId: props.projectSessionId,
                  sectionId: baseRef.current.sectionId
                })
                .then((current) => {
                  const replacement =
                    current.revision.content.length === 0
                      ? [
                          {
                            id: crypto.randomUUID(),
                            type: 'paragraph' as const,
                            props: {
                              backgroundColor: 'default',
                              textColor: 'default',
                              textAlignment: 'left' as const
                            },
                            content: [],
                            children: []
                          }
                        ]
                      : (current.revision.content as ApprovedEditorBlock[])
                  replacingImportedDocumentRef.current = true
                  editor.replaceBlocks(editor.document, replacement)
                  baseRef.current = current.revision
                  dirtyRef.current = false
                  saveBlockedRef.current = false
                  props.onRevision(current.revision)
                  setSaveState('saved')
                })
                .catch(() => setSaveState('failed'))
            }}
          >
            Reload canonical version
          </Button>
        </div>
      )}
      {saveState === 'failed' && (
        <div className='flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-destructive'>
          <p>
            The latest edit could not be fully saved or its project mirror needs repair. Keep this
            editor open and retry the save.
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              saveBlockedRef.current = false
              void save().catch(() => undefined)
            }}
          >
            Retry save
          </Button>
        </div>
      )}
      {saveState === 'mirror-pending' && (
        <p className='border-t px-4 py-3 text-sm text-muted-foreground'>
          Content is saved in the project database. Its portable mirror will be repaired when the
          project is reopened.
        </p>
      )}
    </div>
  )
})

function SaveStatus({ state }: { state: SaveState }): React.JSX.Element {
  const labels: Record<SaveState, string> = {
    clean: 'Unsaved',
    saving: 'Saving',
    saved: 'Saved',
    'mirror-pending': 'Saved, mirror pending',
    conflict: 'Conflict',
    failed: 'Save failed'
  }
  return (
    <Badge variant={state === 'conflict' || state === 'failed' ? 'destructive' : 'outline'}>
      {state === 'saving' ? <LoaderCircle className='animate-spin' /> : null}
      {state === 'saved' ? <Check /> : null}
      {state === 'conflict' || state === 'failed' ? <AlertCircle /> : null}
      {labels[state]}
    </Badge>
  )
}
