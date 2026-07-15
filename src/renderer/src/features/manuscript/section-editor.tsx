import type { BlockNoteDocument, SectionRevision } from '../../../../shared/contracts/manuscript'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { AlertCircle, Check, Download, LoaderCircle, Upload } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { approvedEditorSchema, type ApprovedEditorBlock } from './editor-schema'

type SaveState = 'clean' | 'saving' | 'saved' | 'mirror-pending' | 'conflict' | 'failed'

export function SectionEditor(props: {
  projectSessionId: string
  revision: SectionRevision
  onRevision(revision: SectionRevision): void
}): React.JSX.Element {
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
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [readOnly, setReadOnly] = useState(false)
  const baseRef = useRef(props.revision)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const runningRef = useRef<Promise<void> | null>(null)
  const replacingImportedDocumentRef = useRef(false)

  const save = async (closingToken?: string): Promise<void> => {
    if (runningRef.current !== null) await runningRef.current
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
          document: JSON.parse(JSON.stringify(editor.document)) as BlockNoteDocument
        }
        try {
          const result =
            closingToken === undefined
              ? await window.desktop.editor.saveSectionDocument(input)
              : await window.desktop.editor.finalFlushSave({ ...input, closingToken })
          baseRef.current = result.revision
          props.onRevision(result.revision)
          setSaveState(
            result.disposition === 'saved_materialization_pending' ? 'mirror-pending' : 'saved'
          )
        } catch (error) {
          dirtyRef.current = true
          const conflict = String(error).toLowerCase().includes('section body has changed')
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

  const handleFlush = useEffectEvent(
    async (request: { projectSessionId: string; closingToken: string }): Promise<void> => {
      setReadOnly(true)
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
      await save(request.closingToken)
      await window.desktop.editor.acknowledgeFlush({
        ...request,
        sectionRevisionId: baseRef.current.sectionRevisionId
      })
    }
  )

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void window.desktop.editor
      .subscribeFlush({ projectSessionId: props.projectSessionId }, (request) => {
        if (disposed) return
        void handleFlush(request).catch(() => setSaveState('failed'))
      })
      .then((release) => {
        if (disposed) release()
        else unsubscribe = release
      })
      .catch(() => setSaveState('failed'))
    return () => {
      disposed = true
      if (timerRef.current !== undefined) clearTimeout(timerRef.current)
      unsubscribe?.()
    }
  }, [props.projectSessionId])

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
                  try {
                    const result = await window.desktop.editor.importMarkdown({
                      projectSessionId: props.projectSessionId,
                      sectionId: base.sectionId,
                      baseRevisionId: base.sectionRevisionId,
                      baseContentHash: base.contentHash,
                      document
                    })
                    baseRef.current = result.revision
                    props.onRevision(result.revision)
                    setSaveState(
                      result.disposition === 'saved_materialization_pending'
                        ? 'mirror-pending'
                        : 'saved'
                    )
                  } catch (error) {
                    dirtyRef.current = true
                    setSaveState(
                      String(error).toLowerCase().includes('section body has changed')
                        ? 'conflict'
                        : 'failed'
                    )
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
          setSaveState('clean')
          if (timerRef.current !== undefined) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => void save().catch(() => undefined), 650)
        }}
        className='min-h-72 py-6'
      />
      {saveState === 'conflict' && (
        <p className='border-t px-4 py-3 text-sm text-destructive'>
          This section changed elsewhere. Your local document is preserved and has not overwritten
          the database version.
        </p>
      )}
      {saveState === 'failed' && (
        <p className='border-t px-4 py-3 text-sm text-destructive'>
          The latest edit could not be fully saved or its project mirror needs repair. Keep this
          editor open and retry by editing again.
        </p>
      )}
      {saveState === 'mirror-pending' && (
        <p className='border-t px-4 py-3 text-sm text-muted-foreground'>
          Content is saved in the project database. Its portable mirror will be repaired when the
          project is reopened.
        </p>
      )}
    </div>
  )
}

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
