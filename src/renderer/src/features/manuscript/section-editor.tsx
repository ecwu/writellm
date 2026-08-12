import type { BlockNoteDocument, SectionRevision } from '../../../../shared/contracts/manuscript'
import type {
  ExpandedCitation,
  ReadableCitationResolutionResult
} from '../../../../shared/contracts/search'
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { AlertCircle, Check, FileSearch, Sigma, Workflow } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useTheme } from '@/theme-provider'
import { CitationCandidatePicker, ExpandedCitationPreview } from '../knowledge/citation-preview'
import { approvedEditorSchema, type ApprovedEditorBlock } from './editor-schema'
import { logicalAssetId, resolveProjectAssetUrl } from './project-asset-url'
import {
  readableCitationExtension,
  type ReadableCitationActivation
} from './readable-citation-extension'

export type SaveState = 'clean' | 'saving' | 'saved' | 'mirror-pending' | 'conflict' | 'failed'

export interface EditorSelectionContext {
  activeBlockId: string
  selectedBlockIds: string[]
}

export interface SectionEditorHandle {
  focus(): void
  flush(): Promise<void>
  finalFlush(request: {
    projectSessionId: string
    closingToken: string
    purpose?: 'close' | 'snapshot' | 'export' | 'mutation'
  }): Promise<void>
  releaseMutationBarrier(): void
  importMarkdown(): Promise<void>
  exportNativeJson(): Promise<void>
  exportMarkdown(): Promise<void>
}

type CitationDialogState =
  | { phase: 'loading'; request: ReadableCitationActivation }
  | { phase: 'resolved'; request: ReadableCitationActivation; citation: ExpandedCitation }
  | {
      phase: 'ambiguous'
      request: ReadableCitationActivation
      citations: ExpandedCitation[]
    }
  | {
      phase: 'unavailable'
      request: ReadableCitationActivation
      reason: Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
    }
  | { phase: 'error'; request: ReadableCitationActivation }

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
  const { resolvedTheme } = useTheme()
  const closingRef = useRef(false)
  const pendingAssetResolutionsRef = useRef(new Set<Promise<string>>())
  const baseRef = useRef(props.revision)
  const citationActivationHandlerRef = useRef<(activation: ReadableCitationActivation) => void>(
    () => undefined
  )
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
  const editor = useCreateBlockNote(
    {
      schema: approvedEditorSchema,
      initialContent,
      extensions: [
        readableCitationExtension({
          onActivate: (activation) => citationActivationHandlerRef.current(activation)
        })
      ],
      uploadFile: async (file) => {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          throw new Error('Only PNG, JPEG, and WebP images are supported')
        }
        const result = await window.desktop.editor.uploadAsset({
          projectSessionId: props.projectSessionId,
          originalName: file.name,
          mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
          dataBase64: await fileToBase64(file)
        })
        return result.logicalUrl
      },
      resolveFileUrl: (url) => {
        if (closingRef.current) return Promise.resolve('')
        const resolution = resolveProjectAssetUrl(
          url,
          props.projectSessionId,
          window.desktop.editor.resolveAsset
        )
        pendingAssetResolutionsRef.current.add(resolution)
        void resolution.then(
          () => pendingAssetResolutionsRef.current.delete(resolution),
          () => pendingAssetResolutionsRef.current.delete(resolution)
        )
        return resolution
      }
    },
    [props.projectSessionId]
  )
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [readOnly, setReadOnly] = useState(false)
  const [citationDialog, setCitationDialog] = useState<CitationDialogState | null>(null)
  const citationRequestSequenceRef = useRef(0)
  const citationTriggerRef = useRef<HTMLElement | null>(null)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const runningRef = useRef<Promise<void> | null>(null)
  const replacingImportedDocumentRef = useRef(false)
  const saveBlockedRef = useRef(false)

  const resolveCitation = useCallback(
    (request: ReadableCitationActivation): void => {
      const sequence = ++citationRequestSequenceRef.current
      citationTriggerRef.current = request.element
      setCitationDialog({ phase: 'loading', request })
      void window.desktop.knowledge
        .resolveReadableCitation({
          projectSessionId: props.projectSessionId,
          sectionRevisionId: baseRef.current.sectionRevisionId,
          blockId: request.blockId,
          title: request.citation.title,
          ...(request.citation.pageIndex === undefined
            ? {}
            : { pageIndex: request.citation.pageIndex })
        })
        .then((result) => {
          if (citationRequestSequenceRef.current !== sequence) return
          if (result.status === 'resolved') {
            setCitationDialog({ phase: 'resolved', request, citation: result.citation })
          } else if (result.status === 'ambiguous') {
            setCitationDialog({ phase: 'ambiguous', request, citations: result.citations })
          } else {
            setCitationDialog({ phase: 'unavailable', request, reason: result.reason })
          }
        })
        .catch(() => {
          if (citationRequestSequenceRef.current === sequence) {
            setCitationDialog({ phase: 'error', request })
          }
        })
    },
    [props.projectSessionId]
  )

  useEffect(() => {
    citationActivationHandlerRef.current = resolveCitation
  }, [resolveCitation])

  useEffect(() => {
    props.onSaveStateChange?.(saveState)
  }, [props.onSaveStateChange, saveState])

  const save = async (
    closingToken?: string,
    revisionSource: 'manual_autosave' | 'manual_checkpoint' = 'manual_autosave',
    purpose?: 'close' | 'snapshot' | 'export' | 'mutation'
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

  const importMarkdown = async (): Promise<void> => {
    if (readOnly || saveState === 'conflict') return
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,text/markdown,text/plain'
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.oncancel = () => resolve(null)
      input.click()
    })
    if (file === null) return

    try {
      if (runningRef.current !== null) await runningRef.current
      const base = baseRef.current
      const parsedBlocks = await file
        .text()
        .then(preprocessRichMarkdown)
        .then((markdown) => editor.tryParseMarkdownToBlocks(markdown))
        .then(convertImportedRichBlocks)
      const blocks = await resolveImportedImages(parsedBlocks, props.projectSessionId)
      assertSafeImportedImages(blocks)
      replacingImportedDocumentRef.current = true
      editor.replaceBlocks(editor.document, blocks)
      setSaveState('saving')
      const document = JSON.parse(JSON.stringify(blocks)) as BlockNoteDocument
      const response = await window.desktop.editor.importMarkdown({
        projectSessionId: props.projectSessionId,
        sectionId: base.sectionId,
        baseRevisionId: base.sectionRevisionId,
        baseContentHash: base.contentHash,
        document
      })
      if (!response.ok) throw new Error(response.error.message)
      const result = response.result
      baseRef.current = result.revision
      dirtyRef.current = false
      saveBlockedRef.current = false
      props.onRevision(result.revision)
      setSaveState(
        result.disposition === 'saved_materialization_pending' ? 'mirror-pending' : 'saved'
      )
    } catch (error) {
      dirtyRef.current = true
      saveBlockedRef.current = true
      setSaveState('failed')
      throw error
    }
  }

  const exportNativeJson = async (): Promise<void> => {
    try {
      await window.desktop.editor.exportNativeJson({
        projectSessionId: props.projectSessionId,
        sectionId: baseRef.current.sectionId
      })
    } catch (error) {
      setSaveState('failed')
      throw error
    }
  }

  const exportMarkdown = async (): Promise<void> => {
    try {
      const revision = baseRef.current
      await window.desktop.editor.exportMarkdown({
        projectSessionId: props.projectSessionId,
        sectionId: revision.sectionId,
        sectionRevisionId: revision.sectionRevisionId,
        contentHash: revision.contentHash,
        markdown: exportRichMarkdown(editor, revision.content as ApprovedEditorBlock[])
      })
    } catch (error) {
      setSaveState('failed')
      throw error
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
    focus() {
      editor.focus()
    },
    async flush() {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      await save(undefined, 'manual_checkpoint')
    },
    async finalFlush(request) {
      if (request.purpose === 'close') {
        closingRef.current = true
        await Promise.allSettled([...pendingAssetResolutionsRef.current])
      }
      if (request.purpose !== 'snapshot') setReadOnly(true)
      try {
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
      } catch (error) {
        if (request.purpose === 'close') closingRef.current = false
        if (request.purpose === 'mutation') setReadOnly(false)
        throw error
      }
    },
    releaseMutationBarrier() {
      setReadOnly(false)
    },
    importMarkdown,
    exportNativeJson,
    exportMarkdown
  }))

  return (
    <div className='min-h-80'>
      <BlockNoteView
        data-testid='section-editor'
        editor={editor}
        theme={resolvedTheme}
        slashMenu={false}
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
        className='writing-editor min-h-[32rem] py-6'
      >
        <SuggestionMenuController
          triggerCharacter='/'
          getItems={async (query) =>
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                {
                  title: 'Mermaid',
                  subtext: 'Insert an editable Mermaid diagram',
                  aliases: ['diagram', 'figure', 'flowchart'],
                  group: 'Rich media',
                  icon: <Workflow className='size-4' />,
                  onItemClick: () =>
                    insertOrUpdateBlockForSlashMenu(editor, {
                      type: 'mermaid',
                      props: { source: '', caption: '', textAlignment: 'center', previewWidth: 720 }
                    })
                },
                {
                  title: 'Math',
                  subtext: 'Insert a display LaTeX formula',
                  aliases: ['latex', 'equation', 'formula'],
                  group: 'Rich media',
                  icon: <Sigma className='size-4' />,
                  onItemClick: () =>
                    insertOrUpdateBlockForSlashMenu(editor, {
                      type: 'math',
                      props: { source: '', caption: '', textAlignment: 'center', previewWidth: 720 }
                    })
                }
              ],
              query
            )
          }
        />
      </BlockNoteView>
      <div className='flex justify-end px-1 py-2'>
        <SaveStatus state={saveState} />
      </div>
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
      <CitationSourceDialog
        projectSessionId={props.projectSessionId}
        state={citationDialog}
        onOpenChange={(open) => {
          if (open) return
          citationRequestSequenceRef.current += 1
          setCitationDialog(null)
        }}
        onRetry={resolveCitation}
        onSelect={(request, citation) =>
          setCitationDialog({ phase: 'resolved', request, citation })
        }
        onCloseAutoFocus={(event) => {
          const trigger = citationTriggerRef.current
          if (trigger === null || !trigger.isConnected) return
          event.preventDefault()
          trigger.focus()
        }}
      />
    </div>
  )
})

function CitationSourceDialog(props: {
  projectSessionId: string
  state: CitationDialogState | null
  onOpenChange(open: boolean): void
  onRetry(request: ReadableCitationActivation): void
  onSelect(request: ReadableCitationActivation, citation: ExpandedCitation): void
  onCloseAutoFocus(event: Event): void
}): React.JSX.Element {
  const state = props.state
  const title =
    state?.phase === 'resolved'
      ? state.citation.title
      : state?.phase === 'ambiguous'
        ? 'Choose source evidence'
        : state?.phase === 'loading'
          ? 'Resolving citation'
          : state?.phase === 'error'
            ? 'Source preview unavailable'
            : 'Source link unavailable'
  const description =
    state?.phase === 'resolved'
      ? `${state.citation.headingPath.join(' / ') || 'Normalized source chunk'}${
          state.citation.page === undefined ? '' : ` · Page ${state.citation.page + 1}`
        }`
      : state?.phase === 'ambiguous'
        ? 'This citation is linked to more than one evidence chunk. Choose the one to preview.'
        : state?.phase === 'loading'
          ? 'Checking accepted Agent proposal provenance and the active knowledge index.'
          : state?.phase === 'error'
            ? 'The citation resolver failed unexpectedly. Retry without leaving the editor.'
            : unavailableMessage(state?.phase === 'unavailable' ? state.reason : 'unlinked')

  return (
    <Dialog open={state !== null} onOpenChange={props.onOpenChange}>
      <DialogContent
        className='max-h-[85vh] max-w-3xl! overflow-y-auto'
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {state?.phase === 'loading' ? (
          <div
            className='flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground'
            role='status'
          >
            <Spinner /> Resolving source link…
          </div>
        ) : null}
        {state?.phase === 'resolved' ? (
          <ExpandedCitationPreview
            projectSessionId={props.projectSessionId}
            citation={state.citation}
          />
        ) : null}
        {state?.phase === 'ambiguous' ? (
          <CitationCandidatePicker
            citations={state.citations}
            onSelect={(citation) => props.onSelect(state.request, citation)}
          />
        ) : null}
        {state?.phase === 'unavailable' ? (
          <div className='flex gap-3 rounded-md bg-muted/50 px-4 py-3 text-sm' role='status'>
            <FileSearch className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
            <p>{unavailableMessage(state.reason)}</p>
          </div>
        ) : null}
        {state?.phase === 'error' ? (
          <div className='flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-4 py-3 text-sm'>
            <p>The source preview could not be loaded. The citation text is unchanged.</p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => props.onRetry(state.request)}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function unavailableMessage(
  reason: Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
): string {
  switch (reason) {
    case 'unlinked':
      return 'No verifiable source association was found for this citation. It may have been entered or copied manually.'
    case 'source_missing':
      return 'The linked source is no longer available in the active knowledge index.'
    case 'index_unavailable':
      return 'The knowledge index is still preparing. Try this citation again when indexing is complete.'
    case 'resolution_limit':
      return 'The citation is older than the bounded provenance history available for interactive preview.'
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Image could not be read'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Image could not be encoded'))
        return
      }
      const separator = result.indexOf(',')
      if (separator < 0) {
        reject(new Error('Image could not be encoded'))
        return
      }
      resolve(result.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function preprocessRichMarkdown(markdown: string): string {
  return markdown.replace(
    /(^|\n)\$\$[ \t]*\n?([\s\S]*?)\n?[ \t]*\$\$(?=\n|$)/g,
    (_match, prefix: string, source: string) => `${prefix}\`\`\`writellm-math\n${source}\n\`\`\``
  )
}

function convertImportedRichBlocks(blocks: ApprovedEditorBlock[]): ApprovedEditorBlock[] {
  return blocks.map((block) => {
    const children = convertImportedRichBlocks(block.children)
    if (block.type !== 'codeBlock') return { ...block, children }
    const language = block.props.language.toLowerCase()
    const source = inlineText(block.content)
    if (language === 'mermaid' || language === 'writellm-math') {
      return {
        id: block.id,
        type: language === 'mermaid' ? 'mermaid' : 'math',
        props: {
          source,
          caption: '',
          textAlignment: 'center',
          previewWidth: 720
        },
        children
      } as ApprovedEditorBlock
    }
    return { ...block, children }
  })
}

function assertSafeImportedImages(blocks: ApprovedEditorBlock[]): void {
  for (const block of blocks) {
    if (block.type === 'image' && block.props.url !== '') logicalAssetId(block.props.url)
    assertSafeImportedImages(block.children)
  }
}

async function resolveImportedImages(
  blocks: ApprovedEditorBlock[],
  projectSessionId: string
): Promise<ApprovedEditorBlock[]> {
  return Promise.all(
    blocks.map(async (block) => {
      const children = await resolveImportedImages(block.children, projectSessionId)
      if (block.type !== 'image' || block.props.url.startsWith('writellm-asset:')) {
        return { ...block, children }
      }
      const result = await window.desktop.editor.resolveImportAsset({
        projectSessionId,
        reference: block.props.url
      })
      return { ...block, props: { ...block.props, url: result.logicalUrl }, children }
    })
  )
}

function exportRichMarkdown(
  editor: ReturnType<typeof useCreateBlockNote<{ schema: typeof approvedEditorSchema }>>,
  blocks: ApprovedEditorBlock[]
): string {
  const markdownBlocks = blocks.map(toMarkdownBlock)
  return editor
    .blocksToMarkdownLossy(markdownBlocks)
    .replace(/```writellm-math\n([\s\S]*?)\n```/g, (_match, source: string) => `$$\n${source}\n$$`)
}

function toMarkdownBlock(block: ApprovedEditorBlock): ApprovedEditorBlock {
  const children = block.children.map(toMarkdownBlock)
  if (block.type !== 'mermaid' && block.type !== 'math') return { ...block, children }
  return {
    id: block.id,
    type: 'codeBlock',
    props: { language: block.type === 'mermaid' ? 'mermaid' : 'writellm-math' },
    content: [{ type: 'text', text: block.props.source, styles: {} }],
    children
  } as ApprovedEditorBlock
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((value) => {
      if (value === null || typeof value !== 'object') return ''
      const record = value as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .join('')
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
      {state === 'saving' ? <Spinner /> : null}
      {state === 'saved' ? <Check /> : null}
      {state === 'conflict' || state === 'failed' ? <AlertCircle /> : null}
      {labels[state]}
    </Badge>
  )
}
