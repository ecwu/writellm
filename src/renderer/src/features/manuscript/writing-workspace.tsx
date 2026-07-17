import type {
  ManuscriptWorkspace,
  SectionRevision,
  UpdateManuscriptBriefInput
} from '../../../../shared/contracts/manuscript'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Bot, FileText, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { KnowledgeManager } from '@/features/knowledge/knowledge-manager'
import { ManuscriptBriefDialog } from './manuscript-brief-dialog'
import { OutlineEditPanel, type OutlineMove } from './outline-edit-panel'
import { ManuscriptPreview } from './manuscript-preview'
import {
  SectionEditor,
  type EditorSelectionContext,
  type SectionEditorHandle,
  type SaveState
} from './section-editor'

export function WritingWorkspace(props: {
  projectSessionId: string
  projectName: string
  lifecycleState: string
  globalAlert: React.ReactNode
  onOpenSettings(): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const workspaceKey = useMemo(
    () => ['manuscript-workspace', props.projectSessionId] as const,
    [props.projectSessionId]
  )
  const workspaceQuery = useQuery({
    queryKey: workspaceKey,
    queryFn: () => window.desktop.manuscript.workspace({ projectSessionId: props.projectSessionId })
  })
  const workspace = workspaceQuery.data
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [activeWorkspace, setActiveWorkspace] = useState<'manuscript' | 'knowledge'>('manuscript')
  const [newSectionParent, setNewSectionParent] = useState<string | null | undefined>(undefined)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [deleteSectionId, setDeleteSectionId] = useState<string | null>(null)
  const [editorSaveState, setEditorSaveState] = useState<SaveState>('saved')
  const [metadataTitle, setMetadataTitle] = useState('')
  const [metadataError, setMetadataError] = useState(false)
  const [outlineEditOpen, setOutlineEditOpen] = useState(false)
  const editorRef = useRef<SectionEditorHandle>(null)
  const activeSectionIdRef = useRef<string | null>(null)
  const metadataDraftSectionIdRef = useRef<string | null>(null)
  const metadataCanonicalUpdatedAtRef = useRef<string | null>(null)
  const metadataSaveRef = useRef<Promise<boolean> | null>(null)
  const metadataDraftRef = useRef({ title: '' })
  const selectionContextRef = useRef<(EditorSelectionContext & { sectionId: string }) | null>(null)

  const editorQuery = useQuery({
    queryKey: ['manuscript-section', props.projectSessionId, activeSectionId],
    queryFn: () =>
      window.desktop.editor.loadSection({
        projectSessionId: props.projectSessionId,
        sectionId: activeSectionId as string
      }),
    enabled: activeSectionId !== null
  })

  const previewQuery = useQuery({
    queryKey: ['manuscript-preview', props.projectSessionId],
    queryFn: () => window.desktop.manuscript.preview({ projectSessionId: props.projectSessionId }),
    enabled: previewOpen,
    staleTime: 0
  })

  const mutation = useMutation({
    mutationFn: (operation: () => Promise<ManuscriptWorkspace>) => operation(),
    onSuccess: (next) => queryClient.setQueryData(workspaceKey, next)
  })

  const activateSection = useCallback(
    async (sectionId: string): Promise<void> => {
      await window.desktop.editor.setActiveSection({
        projectSessionId: props.projectSessionId,
        sectionId
      })
      const target = queryClient
        .getQueryData<ManuscriptWorkspace>(workspaceKey)
        ?.sections.find((item) => item.section.sectionId === sectionId)
      if (target) {
        setMetadataTitle(target.section.title)
        metadataDraftRef.current = { title: target.section.title }
        metadataDraftSectionIdRef.current = sectionId
        metadataCanonicalUpdatedAtRef.current = target.section.updatedAt
        setMetadataError(false)
      }
      activeSectionIdRef.current = sectionId
      setActiveSectionId(sectionId)
    },
    [props.projectSessionId, queryClient, workspaceKey]
  )

  useEffect(() => {
    if (!workspace) return
    if (workspace.sections.length === 0) {
      activeSectionIdRef.current = null
      setActiveSectionId(null)
      return
    }
    if (!workspace.sections.some((item) => item.section.sectionId === activeSectionId)) {
      const fallback = workspace.sections[0]?.section.sectionId
      if (fallback !== undefined) {
        void activateSection(fallback).catch(() =>
          props.onError('The initial manuscript section could not be activated.')
        )
      }
    }
  }, [activateSection, activeSectionId, props, workspace])

  const activeSummary = workspace?.sections.find(
    (item) => item.section.sectionId === activeSectionId
  )

  const outlineMoveAvailability = useMemo(() => {
    if (!workspace || !activeSummary) {
      return { up: false, down: false, indent: false, outdent: false }
    }
    const section = activeSummary.section
    const siblings = workspace.sections.filter(
      (item) => item.section.parentSectionId === section.parentSectionId
    )
    return {
      up: section.position > 0,
      down: section.position < siblings.length - 1,
      indent: section.position > 0,
      outdent: section.parentSectionId !== null
    }
  }, [activeSummary, workspace])

  useEffect(() => {
    if (!activeSummary) return
    const sectionChanged = metadataDraftSectionIdRef.current !== activeSummary.section.sectionId
    const canonicalChanged =
      metadataCanonicalUpdatedAtRef.current !== activeSummary.section.updatedAt
    const draft = metadataDraftRef.current
    const draftDirty = draft.title !== activeSummary.section.title
    if (!sectionChanged && (!canonicalChanged || draftDirty || metadataError)) return
    setMetadataTitle(activeSummary.section.title)
    metadataDraftRef.current = { title: activeSummary.section.title }
    metadataDraftSectionIdRef.current = activeSummary.section.sectionId
    metadataCanonicalUpdatedAtRef.current = activeSummary.section.updatedAt
    setMetadataError(false)
  }, [activeSummary, metadataError])

  const runMutation = useCallback(
    async (operation: () => Promise<ManuscriptWorkspace>): Promise<ManuscriptWorkspace | null> => {
      try {
        return await mutation.mutateAsync(operation)
      } catch {
        props.onError('The manuscript changed or the requested update could not be applied.')
        return null
      }
    },
    [mutation, props]
  )

  const saveMetadata = useCallback(async (): Promise<boolean> => {
    if (metadataSaveRef.current !== null) return metadataSaveRef.current
    const operation = (async (): Promise<boolean> => {
      if (!activeSummary) return true
      const draft = metadataDraftRef.current
      if (draft.title === activeSummary.section.title) return true
      if (draft.title.trim().length === 0) {
        props.onError('Section titles cannot be empty.')
        return false
      }
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      const currentSummary = current?.sections.find(
        (item) => item.section.sectionId === activeSummary.section.sectionId
      )
      if (!current || !currentSummary) return false
      const result = await runMutation(() =>
        window.desktop.manuscript.updateSection({
          projectSessionId: props.projectSessionId,
          update: {
            baseOutlineVersion: current.outlineVersion,
            sectionId: activeSummary.section.sectionId,
            title: draft.title.trim()
          }
        })
      )
      setMetadataError(result === null)
      return result !== null
    })()
    metadataSaveRef.current = operation
    try {
      return await operation
    } finally {
      if (metadataSaveRef.current === operation) metadataSaveRef.current = null
    }
  }, [activeSummary, props, queryClient, runMutation, workspaceKey])

  const flushCurrent = useCallback(async (): Promise<boolean> => {
    try {
      await editorRef.current?.flush()
      return await saveMetadata()
    } catch {
      props.onError('Save the current section before leaving it. Your local edits are preserved.')
      return false
    }
  }, [props, saveMetadata])

  const selectSection = useCallback(
    async (sectionId: string): Promise<void> => {
      if (sectionId === activeSectionId || !(await flushCurrent())) return
      try {
        await activateSection(sectionId)
      } catch {
        props.onError('The selected section could not be activated.')
      }
    },
    [activateSection, activeSectionId, flushCurrent, props]
  )

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void window.desktop.editor
      .subscribeFlush({ projectSessionId: props.projectSessionId }, (request) => {
        if (disposed) return
        void (async () => {
          if (editorRef.current) {
            await editorRef.current.finalFlush(request)
            return
          }
          if (request.sectionId !== undefined && request.sectionRevisionId !== undefined) {
            await window.desktop.editor.acknowledgeFlush({
              ...request,
              sectionId: request.sectionId,
              sectionRevisionId: request.sectionRevisionId
            })
            return
          }
          const currentWorkspace =
            queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey) ??
            (await window.desktop.manuscript.workspace({
              projectSessionId: props.projectSessionId
            }))
          const sectionId =
            activeSectionIdRef.current ?? currentWorkspace.sections[0]?.section.sectionId
          if (sectionId === undefined) throw new Error('No section is available for final flush')
          const current = await window.desktop.editor.loadSection({
            projectSessionId: props.projectSessionId,
            sectionId
          })
          await window.desktop.editor.acknowledgeFlush({
            ...request,
            sectionId,
            sectionRevisionId: current.revision.sectionRevisionId
          })
        })().catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err))
          window.desktop.diagnostics.reportRendererError({
            event: 'renderer.unhandled_rejection',
            message: error.message,
            ...(error.stack === undefined ? {} : { stack: error.stack }),
            source: 'writing-workspace.final-flush'
          })
          setEditorSaveState('failed')
        })
      })
      .then((release) => {
        if (disposed) release()
        else unsubscribe = release
      })
      .catch(() => setEditorSaveState('failed'))
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [props.projectSessionId, queryClient, workspaceKey])

  const orderedIds = workspace?.sections.map((item) => item.section.sectionId) ?? []
  const activeIndex = activeSectionId === null ? -1 : orderedIds.indexOf(activeSectionId)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setAgentOpen((current) => !current)
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void flushCurrent()
      } else if (event.altKey && event.key === 'ArrowUp' && activeIndex > 0) {
        event.preventDefault()
        void selectSection(orderedIds[activeIndex - 1] as string)
      } else if (event.altKey && event.key === 'ArrowDown' && activeIndex < orderedIds.length - 1) {
        event.preventDefault()
        void selectSection(orderedIds[activeIndex + 1] as string)
      }
    }
    const handleSave = (): void => void flushCurrent()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('writellm:save', handleSave)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('writellm:save', handleSave)
    }
  }, [activeIndex, flushCurrent, orderedIds, selectSection])

  const updateRevision = (revision: SectionRevision): void => {
    queryClient.setQueryData<ManuscriptWorkspace>(workspaceKey, (current) => {
      if (!current) return current
      const sections = current.sections.map((item) => {
        if (item.section.sectionId !== revision.sectionId) return item
        const { content: _content, ...summary } = revision
        return {
          section: { ...item.section, currentRevisionId: revision.sectionRevisionId },
          revision: summary
        }
      })
      return {
        ...current,
        sections,
        wordCount: sections.reduce((total, item) => total + item.revision.wordCount, 0),
        characterCount: sections.reduce((total, item) => total + item.revision.characterCount, 0)
      }
    })
    queryClient.setQueryData(
      ['manuscript-section', props.projectSessionId, revision.sectionId],
      (current: Awaited<ReturnType<typeof window.desktop.editor.loadSection>> | undefined) =>
        current ? { ...current, revision } : current
    )
  }

  const moveSection = async (
    sectionId: string,
    parentSectionId: string | null,
    position: number
  ): Promise<void> => {
    if (!(await flushCurrent())) return
    const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
    if (!current) return
    await runMutation(() =>
      window.desktop.manuscript.moveSection({
        projectSessionId: props.projectSessionId,
        move: { baseOutlineVersion: current.outlineVersion, sectionId, parentSectionId, position }
      })
    )
  }

  const moveActive = async (kind: OutlineMove): Promise<void> => {
    if (!workspace || !activeSummary) return
    const section = activeSummary.section
    const siblings = workspace.sections
      .map((item) => item.section)
      .filter((item) => item.parentSectionId === section.parentSectionId)
    if (kind === 'up' && section.position > 0) {
      await moveSection(section.sectionId, section.parentSectionId, section.position - 1)
    } else if (kind === 'down' && section.position < siblings.length - 1) {
      await moveSection(section.sectionId, section.parentSectionId, section.position + 1)
    } else if (kind === 'indent' && section.position > 0) {
      const previous = siblings[section.position - 1]
      if (previous) {
        const childCount = workspace.sections.filter(
          (item) => item.section.parentSectionId === previous.sectionId
        ).length
        await moveSection(section.sectionId, previous.sectionId, childCount)
      }
    } else if (kind === 'outdent' && section.parentSectionId !== null) {
      const parent = workspace.sections.find(
        (item) => item.section.sectionId === section.parentSectionId
      )?.section
      if (parent) {
        await moveSection(section.sectionId, parent.parentSectionId, parent.position + 1)
      }
    }
  }

  const openPreview = async (): Promise<void> => {
    if (!(await flushCurrent())) return
    setPreviewOpen(true)
    await queryClient.invalidateQueries({
      queryKey: ['manuscript-preview', props.projectSessionId]
    })
  }

  const runPanelEditorAction = async (
    action: () => Promise<void>,
    failureMessage: string
  ): Promise<void> => {
    if (!(await flushCurrent())) return
    try {
      await action()
    } catch {
      props.onError(failureMessage)
    }
  }

  const importMarkdownFromPanel = (): Promise<void> =>
    runPanelEditorAction(async () => {
      await editorRef.current?.importMarkdown()
    }, 'Markdown could not be imported into the current section.')

  const exportNativeJsonFromPanel = (): Promise<void> =>
    runPanelEditorAction(async () => {
      await editorRef.current?.exportNativeJson()
    }, 'The native section document could not be exported.')

  const exportMarkdownFromPanel = (): Promise<void> =>
    runPanelEditorAction(async () => {
      await editorRef.current?.exportMarkdown()
    }, 'The Markdown section export could not be created.')

  const previewFromPanel = async (): Promise<void> => {
    try {
      await openPreview()
    } catch {
      props.onError('The manuscript preview could not be loaded.')
    }
  }

  if (activeWorkspace === 'knowledge') {
    return (
      <KnowledgeManager
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        lifecycleState={props.lifecycleState}
        globalAlert={props.globalAlert}
        onOpenManuscript={() => setActiveWorkspace('manuscript')}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
      />
    )
  }

  return (
    <SidebarProvider
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '360px' } as React.CSSProperties}
    >
      <AppSidebar
        projectName={props.projectName}
        workspace={workspace}
        activeWorkspace={activeWorkspace}
        activeSectionId={activeSectionId}
        onSelectSection={(sectionId) => void selectSection(sectionId)}
        onCreateSection={setNewSectionParent}
        onDeleteSection={setDeleteSectionId}
        onMoveSection={(sectionId, parentSectionId, position) =>
          void moveSection(sectionId, parentSectionId, position)
        }
        onOpenBrief={() => setBriefOpen(true)}
        onOpenOutlineEditor={() => setOutlineEditOpen(true)}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
        onOpenManuscript={() => setActiveWorkspace('manuscript')}
        onToggleAgent={() => setAgentOpen((current) => !current)}
        onOpenSettings={props.onOpenSettings}
      />
      <SidebarInset className='min-h-0 overflow-auto'>
        <header className='sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background p-4'>
          <SidebarTrigger className='-ml-1' />
          <Badge className='ml-auto' variant='secondary'>
            {props.lifecycleState}
          </Badge>
        </header>
        <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:px-12 md:py-10 lg:px-20'>
          {props.globalAlert}
          {workspaceQuery.isError ? (
            <Alert variant='destructive'>
              <AlertCircle />
              <AlertTitle>Workspace unavailable</AlertTitle>
              <AlertDescription>
                The manuscript workspace could not be loaded. Retry before editing.
              </AlertDescription>
            </Alert>
          ) : null}
          {workspaceQuery.isPending || editorQuery.isPending ? (
            <div className='flex min-h-96 items-center justify-center gap-2 text-muted-foreground'>
              <LoaderCircle className='size-5 animate-spin' /> Loading writing workspace…
            </div>
          ) : editorQuery.data && activeSummary ? (
            <section className='flex flex-col gap-2'>
              <Input
                id='section-title'
                aria-label='Section title'
                value={metadataTitle}
                onBlur={() => void saveMetadata()}
                onChange={(event) => {
                  metadataDraftRef.current.title = event.target.value
                  setMetadataError(false)
                  setMetadataTitle(event.target.value)
                }}
                className='h-auto border-0 bg-transparent px-0 text-4xl font-semibold tracking-tight shadow-none focus-visible:ring-2 focus-visible:ring-ring max-md:pl-[54px] md:text-5xl'
              />
              {metadataError ? (
                <p className='text-sm text-destructive' role='alert'>
                  The title could not be saved. Press ⌘/Ctrl+S to retry.
                </p>
              ) : null}
              <SectionEditor
                ref={editorRef}
                key={`${props.projectSessionId}:${activeSummary.section.sectionId}`}
                projectSessionId={props.projectSessionId}
                revision={editorQuery.data.revision}
                onRevision={updateRevision}
                onSaveStateChange={setEditorSaveState}
                onSelectionContextChange={(context) => {
                  selectionContextRef.current = {
                    sectionId: activeSummary.section.sectionId,
                    ...context
                  }
                }}
              />
            </section>
          ) : (
            <div className='flex min-h-96 items-center justify-center rounded-lg border border-dashed text-center'>
              <div className='space-y-3'>
                <FileText className='mx-auto size-8 text-muted-foreground' />
                <p className='font-medium'>No section is available</p>
                <Button onClick={() => setNewSectionParent(null)}>Create a section</Button>
              </div>
            </div>
          )}
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            <span>⌘/Ctrl+S save · ⌘/Ctrl+Alt+↑/↓ navigate</span>
            <span>⌘/Ctrl+J toggles the agent panel</span>
          </div>
        </main>
      </SidebarInset>

      <OutlineEditPanel
        open={outlineEditOpen}
        onOpenChange={setOutlineEditOpen}
        activeSection={activeSummary?.section}
        saveState={editorSaveState}
        canMoveUp={outlineMoveAvailability.up}
        canMoveDown={outlineMoveAvailability.down}
        canIndent={outlineMoveAvailability.indent}
        canOutdent={outlineMoveAvailability.outdent}
        onMove={(move) => void moveActive(move)}
        onImportMarkdown={importMarkdownFromPanel}
        onExportNativeJson={exportNativeJsonFromPanel}
        onExportMarkdown={exportMarkdownFromPanel}
        onPreviewAll={previewFromPanel}
      />

      {workspace ? (
        <ManuscriptBriefDialog
          open={briefOpen}
          brief={workspace.brief}
          saving={mutation.isPending}
          error={briefError}
          onOpenChange={setBriefOpen}
          onReload={() => {
            void workspaceQuery.refetch().then(() => {
              setBriefError(null)
            })
          }}
          onSave={async (fields) => {
            setBriefError(null)
            const update: UpdateManuscriptBriefInput = {
              ...fields,
              baseVersion: workspace.brief.version
            }
            const result = await runMutation(() =>
              window.desktop.manuscript.updateBrief({
                projectSessionId: props.projectSessionId,
                update
              })
            )
            if (result === null) setBriefError('The brief changed or could not be saved.')
          }}
        />
      ) : null}

      <ManuscriptPreview
        open={previewOpen}
        assembly={previewQuery.data}
        loading={previewQuery.isPending || previewQuery.isFetching}
        error={previewQuery.isError}
        onOpenChange={setPreviewOpen}
      />

      <Sheet open={agentOpen} onOpenChange={setAgentOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle className='flex items-center gap-2'>
              <Bot className='size-4' /> Writing agent
            </SheetTitle>
            <SheetDescription>
              Unavailable until Phase 9. Your current section and in-memory block selection remain
              ready for the future agent context boundary.
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>

      <Dialog
        open={newSectionParent !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setNewSectionParent(undefined)
            setNewSectionTitle('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create section</DialogTitle>
            <DialogDescription>
              {newSectionParent === null ? 'Add a top-level section.' : 'Add a nested subsection.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label='Section title'
            value={newSectionTitle}
            placeholder='Section title'
            onChange={(event) => setNewSectionTitle(event.target.value)}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setNewSectionParent(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!workspace || newSectionTitle.trim().length === 0 || mutation.isPending}
              onClick={() => {
                if (newSectionParent === undefined) return
                void (async () => {
                  if (!(await flushCurrent())) return
                  const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
                  if (!current) return
                  const position = current.sections.filter(
                    (item) => item.section.parentSectionId === newSectionParent
                  ).length
                  const priorSectionIds = new Set(
                    current.sections.map((item) => item.section.sectionId)
                  )
                  const result = await runMutation(() =>
                    window.desktop.manuscript.createSection({
                      projectSessionId: props.projectSessionId,
                      create: {
                        baseOutlineVersion: current.outlineVersion,
                        parentSectionId: newSectionParent,
                        position,
                        title: newSectionTitle.trim(),
                        objective: null,
                        status: 'planned'
                      }
                    })
                  )
                  if (!result) return
                  const created = result.sections.find(
                    (item) => !priorSectionIds.has(item.section.sectionId)
                  )
                  if (created) await activateSection(created.section.sectionId)
                  setNewSectionParent(undefined)
                  setNewSectionTitle('')
                })().catch(() => props.onError('The new section could not be activated.'))
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteSectionId !== null}
        onOpenChange={(open) => !open && setDeleteSectionId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete section?</DialogTitle>
            <DialogDescription>
              This removes the section and its revision history. Sections with children and the last
              remaining section cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteSectionId(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              disabled={!workspace || mutation.isPending}
              onClick={() => {
                if (deleteSectionId === null) return
                const target = deleteSectionId
                void (async () => {
                  if (!(await flushCurrent())) return
                  const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
                  if (!current) return
                  const result = await runMutation(() =>
                    window.desktop.manuscript.deleteSection({
                      projectSessionId: props.projectSessionId,
                      delete: {
                        baseOutlineVersion: current.outlineVersion,
                        sectionId: target
                      }
                    })
                  )
                  if (!result) return
                  setDeleteSectionId(null)
                  if (activeSectionId === target) {
                    const fallback = result.sections[0]?.section.sectionId
                    if (fallback !== undefined) await activateSection(fallback)
                    else {
                      activeSectionIdRef.current = null
                      setActiveSectionId(null)
                    }
                  }
                })().catch(() => props.onError('The remaining section could not be activated.'))
              }}
            >
              Delete section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  )
}

declare global {
  interface WindowEventMap {
    'writellm:save': Event
  }
}
