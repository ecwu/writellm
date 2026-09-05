import type {
  ManuscriptReferenceEntry,
  UpdateManuscriptBriefInput
} from '../../../../shared/contracts/manuscript'
import type {
  ExpandedCitation,
  ReadableCitationResolutionResult
} from '../../../../shared/contracts/search'
import type { PublicationPreview } from '../../../../shared/contracts/publication'
import type { CommentThreadSummary } from '../../../../shared/contracts/manuscript-comments'
import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  FolderOpen,
  MoreHorizontal,
  Upload
} from 'lucide-react'
import { AppSidebar } from '@/components/app-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { AgentPanel } from '@/features/agent/agent-panel'
import {
  CitationCandidatePicker,
  ExpandedCitationPreview
} from '@/features/knowledge/citation-preview'
import { WritingRulesPanel } from '@/features/writing-rules/writing-rules-panel'
import { ManuscriptBriefDialog } from './manuscript-brief-dialog'
import { OutlineEditPanel } from './outline-edit-panel'
import { ManuscriptImportDialog } from './manuscript-import-dialog'
import { ManuscriptFindPanel } from './manuscript-find-panel'
import { SectionEditor, type EditorExactSelectionSnapshot, type SaveState } from './section-editor'
import { CommentsPanel, type PendingCommentSelection } from './comments-panel'
import type { WritingWorkspaceProps } from './writing-workspace'
import type { WritingWorkspaceController } from './use-writing-workspace-controller'

export function WritingWorkspaceView(input: {
  props: WritingWorkspaceProps
  controller: WritingWorkspaceController
}): React.JSX.Element {
  const { props, controller } = input
  const [commentThreads, setCommentThreads] = useState<CommentThreadSummary[]>([])
  const [commentHighlightThreads, setCommentHighlightThreads] = useState<CommentThreadSummary[]>([])
  const [selectedCommentThreadId, setSelectedCommentThreadId] = useState<string | null>(null)
  const [commentDraftSelection, setCommentDraftSelection] =
    useState<PendingCommentSelection | null>(null)
  const [commentPromptRequest, setCommentPromptRequest] = useState<{
    requestId: string
    threadIds: string[]
  } | null>(null)
  const [overlappingCommentThreadIds, setOverlappingCommentThreadIds] = useState<string[]>([])
  const {
    alternateWorkspace,
    queryClient,
    workspaceKey,
    workspaceQuery,
    referencesQuery,
    versionHistoryStatusQuery,
    workspace,
    activeSectionId,
    briefOpen,
    setBriefOpen,
    briefError,
    setBriefError,
    publicationOpen,
    setPublicationOpen,
    importOpen,
    setImportOpen,
    importPlan,
    importLoading,
    importApplying,
    importError,
    publicationQuery,
    wideAgentLayout,
    sideChatGroupRef,
    sideChatGroupElementRef,
    activeWorkspace,
    setActiveWorkspace,
    setCitationDraft,
    referenceDialog,
    setReferenceDialog,
    referenceRequestSequenceRef,
    editorSaveState,
    setEditorSaveState,
    metadataTitle,
    setMetadataTitle,
    metadataError,
    setMetadataError,
    outlineEditOpen,
    setOutlineEditOpen,
    outlineSearchFocus,
    setOutlineSearchFocus,
    editorAutoFocus,
    editorRef,
    manuscriptScrollRef,
    metadataDraftRef,
    selectionContext,
    setSelectionContext,
    quickActionRequest,
    setQuickActionRequest,
    findQuery,
    findCaseSensitive,
    findScope,
    findStatuses,
    findResult,
    findLoading,
    findLoadingMore,
    findError,
    selectedFindMatchId,
    setSelectedFindMatchId,
    replaceOpen,
    replacement,
    replacementPlan,
    replacementCandidates,
    selectedReplacementIds,
    setSelectedReplacementIds,
    replacementLoading,
    replacementLoadingMore,
    replacementApplying,
    replacementMessage,
    replacementUndoCapabilities,
    createReplacementCheckpoint,
    setCreateReplacementCheckpoint,
    sectionTitleRef,
    effectiveReferenceIndex,
    citationNumberByTitle,
    openReference,
    editorQuery,
    mutation,
    activeSummary,
    currentRevisionIds,
    sectionTitles,
    runMutation,
    saveMetadata,
    flushCurrent,
    startQuickAction,
    selectSection,
    followAgentSection,
    runFind,
    reviewReplacements,
    loadMoreReplacements,
    applyReplacements,
    undoReplacement,
    changeFindQuery,
    changeFindCaseSensitive,
    changeFindScope,
    changeFindStatuses,
    changeReplacement,
    changeReplaceOpen,
    activateFindHit,
    refreshAfterAgentMutation,
    openFind,
    closeFind,
    updateRevision,
    updateOutlineSection,
    moveOutlineSection,
    createOutlineSection,
    deleteOutlineSection,
    openPreviewWorkspace,
    openManuscriptImport,
    cancelManuscriptImport,
    applyManuscriptImport,
    exportNativeJsonForActiveSection,
    exportMarkdownForActiveSection,
    openPublicationPreflight,
    openOutlineEditor,
    openChecksFromManuscript
  } = controller
  if (alternateWorkspace !== null) return alternateWorkspace

  const openCommentThread = (thread: CommentThreadSummary): void => {
    setOverlappingCommentThreadIds([])
    setSelectedCommentThreadId(thread.threadId)
    void selectSection(thread.sectionId).then((selected) => {
      if (!selected) return
      requestAnimationFrame(() => editorRef.current?.revealComment(thread.threadId))
    })
  }

  const findCommentSummary = (threadId: string): CommentThreadSummary | undefined =>
    commentHighlightThreads.find((thread) => thread.threadId === threadId) ??
    commentThreads.find((thread) => thread.threadId === threadId)

  return (
    <SidebarProvider className='min-h-0 flex-1' defaultSidebarWidth={360}>
      <AppSidebar
        projectName={props.projectName}
        workspace={workspace}
        references={effectiveReferenceIndex}
        referencesLoading={referencesQuery.isPending}
        referencesError={referencesQuery.isError}
        activeWorkspace={activeWorkspace}
        activeSectionId={activeSectionId}
        onSelectSection={(sectionId) => void selectSection(sectionId)}
        onOpenBrief={() => setBriefOpen(true)}
        onOpenOutlineEditor={() => void openOutlineEditor()}
        onOpenPreview={() => void openPreviewWorkspace()}
        onOpenKnowledge={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('knowledge')
        }}
        onOpenNotebook={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('notebook')
        }}
        onOpenChecks={() => void openChecksFromManuscript()}
        onOpenAssets={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('assets')
        }}
        onOpenReferences={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('references')
        }}
        onOpenWritingRules={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('writing_rules')
        }}
        onOpenFind={openFind}
        onOpenComments={() => setActiveWorkspace('comments')}
        onCloseFind={closeFind}
        onOpenReference={openReference}
        onOpenManuscript={() => {
          editorRef.current?.clearSearchTarget()
          setSelectedFindMatchId(null)
          setActiveWorkspace('manuscript')
        }}
        onOpenSettings={props.onOpenSettings}
        findPanel={
          <ManuscriptFindPanel
            query={findQuery}
            onQueryChange={changeFindQuery}
            caseSensitive={findCaseSensitive}
            onCaseSensitiveChange={changeFindCaseSensitive}
            scope={findScope}
            onScopeChange={changeFindScope}
            statuses={findStatuses}
            onStatusesChange={changeFindStatuses}
            result={findResult}
            loading={findLoading}
            loadingMore={findLoadingMore}
            error={findError}
            selectedMatchId={selectedFindMatchId}
            onActivate={(hit) => void activateFindHit(hit)}
            onLoadMore={() => {
              if (findResult?.nextCursor) void runFind(findResult.nextCursor)
            }}
            replaceOpen={replaceOpen}
            onReplaceOpenChange={changeReplaceOpen}
            replacement={replacement}
            onReplacementChange={changeReplacement}
            replacementPlan={replacementPlan}
            replacementCandidates={replacementCandidates}
            selectedCandidateIds={selectedReplacementIds}
            onCandidatesChecked={(candidateIds, checked) =>
              setSelectedReplacementIds((current) => {
                const next = new Set(current)
                for (const candidateId of candidateIds) {
                  if (checked) next.add(candidateId)
                  else next.delete(candidateId)
                }
                return next
              })
            }
            onReviewReplacements={() => void reviewReplacements()}
            onLoadMoreReplacements={() => void loadMoreReplacements()}
            onApplyReplacements={() => void applyReplacements()}
            onUndoReplacement={() => void undoReplacement()}
            canUndoReplacement={replacementUndoCapabilities.length > 0}
            checkpointAvailable={versionHistoryStatusQuery.data?.state === 'ready'}
            createCheckpoint={createReplacementCheckpoint}
            onCreateCheckpointChange={setCreateReplacementCheckpoint}
            replacementLoading={replacementLoading}
            replacementLoadingMore={replacementLoadingMore}
            replacementApplying={replacementApplying}
            replacementMessage={replacementMessage}
          />
        }
        writingRulesPanel={
          <WritingRulesPanel
            projectSessionId={props.projectSessionId}
            workspace={workspace}
            onWorkspace={(next) => queryClient.setQueryData(workspaceKey, next)}
            onError={props.onError}
          />
        }
        commentsPanel={
          <CommentsPanel
            projectSessionId={props.projectSessionId}
            activeSectionId={activeSectionId}
            revisionKey={JSON.stringify(currentRevisionIds)}
            visible={activeWorkspace === 'comments'}
            draftSelection={commentDraftSelection}
            selectedThreadId={selectedCommentThreadId}
            onDraftConsumed={() => setCommentDraftSelection(null)}
            onThreads={setCommentThreads}
            onHighlightThreads={setCommentHighlightThreads}
            onSelect={(thread) => {
              if (thread === null) {
                setSelectedCommentThreadId(null)
                return
              }
              openCommentThread(thread)
            }}
            onDelegate={(threadIds) => {
              setCommentPromptRequest({ requestId: crypto.randomUUID(), threadIds: [...threadIds] })
              props.onAgentOpenChange(true)
            }}
            onReanchor={async (thread) => {
              if (thread.sectionId !== activeSectionId)
                throw new Error('Open the comment section before linking a selection')
              const saved = await flushCurrent()
              if (!saved) throw new Error('Manuscript selection could not be saved')
              const selection = editorRef.current?.captureSelection()
              if (selection === null || selection === undefined)
                throw new Error('Select manuscript text before linking the comment')
              await window.desktop.manuscript.reanchorComment({
                projectSessionId: props.projectSessionId,
                threadId: thread.threadId,
                expectedVersion: thread.version,
                revisionId: selection.capturedRevisionId,
                contentHash: selection.capturedContentHash,
                quote: selection.selectedText,
                segments: selection.commentSegments
              })
            }}
            onError={props.onError}
          />
        }
      />
      <ResizablePanelGroup
        orientation='horizontal'
        className='min-w-0 flex-1'
        disabled={!wideAgentLayout}
        groupRef={sideChatGroupRef}
        elementRef={sideChatGroupElementRef}
      >
        <ResizablePanel
          id='manuscript'
          className={props.agentOpen ? 'overflow-hidden max-xl:hidden' : 'overflow-hidden'}
          defaultSize={props.agentOpen && !wideAgentLayout ? '0' : undefined}
          minSize={props.agentOpen && wideAgentLayout ? 520 : 0}
          collapsible={props.agentOpen}
        >
          <SidebarInset ref={manuscriptScrollRef} className='size-full min-h-0 overflow-auto'>
            <header className='sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background p-4'>
              <SidebarTrigger className='-ml-1' />
              <Badge className='ml-auto' variant='secondary'>
                {props.lifecycleState}
              </Badge>
            </header>
            <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:px-12 md:py-10 lg:px-20'>
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
                  <Spinner /> Loading writing workspace…
                </div>
              ) : editorQuery.data && activeSummary ? (
                <section className='flex flex-col gap-2'>
                  <div className='flex min-w-0 items-start gap-2'>
                    <Textarea
                      ref={sectionTitleRef}
                      id='section-title'
                      aria-label='Section title'
                      rows={1}
                      maxLength={SECTION_TITLE_MAX_LENGTH}
                      value={metadataTitle}
                      onBlur={() => void saveMetadata()}
                      onChange={(event) => {
                        const title = normalizeSectionTitleDraft(event.target.value)
                        metadataDraftRef.current.title = title
                        setMetadataError(false)
                        setMetadataTitle(title)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        void saveMetadata().then((saved) => {
                          if (saved) editorRef.current?.focus()
                        })
                      }}
                      className='h-auto min-h-0 min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-0 py-0 text-4xl font-semibold tracking-tight shadow-none [field-sizing:content] focus-visible:ring-2 focus-visible:ring-ring max-md:pl-[54px] md:text-5xl'
                    />
                    <div className='flex shrink-0 items-center gap-2 pt-1'>
                      <Badge variant='outline' className='max-md:hidden'>
                        {editorSaveStateLabels[editorSaveState]}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='outline' size='icon-sm' aria-label='Section actions'>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuLabel>Section actions</DropdownMenuLabel>
                          <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => void openPublicationPreflight()}>
                              <FileCheck2 /> Publication preflight
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void openManuscriptImport()}>
                              <Upload /> Import manuscript
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void openManuscriptImport('directory')}
                            >
                              <FolderOpen /> Import LaTeX project folder
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void exportNativeJsonForActiveSection()}
                            >
                              <Download /> Export Native JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void exportMarkdownForActiveSection()}
                            >
                              <Download /> Export Markdown
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {metadataError ? (
                    <p className='text-sm text-destructive' role='alert'>
                      The title could not be saved. Press ⌘/Ctrl+S to retry.
                    </p>
                  ) : null}
                  <SectionEditor
                    ref={editorRef}
                    key={`${props.projectSessionId}:${activeSummary.section.sectionId}:${editorQuery.data.revision.sectionRevisionId}`}
                    projectSessionId={props.projectSessionId}
                    revision={editorQuery.data.revision}
                    citationNumberByTitle={citationNumberByTitle}
                    autoFocus={editorAutoFocus}
                    onRevision={updateRevision}
                    onCitationDocumentChange={(content) => {
                      setCitationDraft({
                        sectionId: editorQuery.data.revision.sectionId,
                        sectionRevisionId: editorQuery.data.revision.sectionRevisionId,
                        content
                      })
                    }}
                    onSaveStateChange={setEditorSaveState}
                    onSelectionContextChange={(context) => {
                      setSelectionContext({
                        sectionId: activeSummary.section.sectionId,
                        ...context
                      })
                    }}
                    onQuickActionRequest={(request, selection) => {
                      void startQuickAction(request, selection)
                    }}
                    onQuickActionError={props.onError}
                    onSearchTargetInvalidated={() => setSelectedFindMatchId(null)}
                    comments={commentHighlightThreads.filter(
                      (thread) => thread.sectionId === activeSummary.section.sectionId
                    )}
                    selectedCommentThreadId={selectedCommentThreadId}
                    onActivateComments={(threadIds) => {
                      if (threadIds.length > 1) {
                        setOverlappingCommentThreadIds([...threadIds])
                        setActiveWorkspace('comments')
                        return
                      }
                      const threadId = threadIds[0]
                      if (threadId === undefined) return
                      const thread = findCommentSummary(threadId)
                      if (thread !== undefined) openCommentThread(thread)
                      setActiveWorkspace('comments')
                    }}
                    onAddComment={(selection: EditorExactSelectionSnapshot) => {
                      void flushCurrent().then((saved) => {
                        if (!saved) return
                        const current = editorRef.current?.captureSelection()
                        if (
                          current === null ||
                          current === undefined ||
                          current.selectedText !== selection.selectedText
                        ) {
                          props.onError(
                            'The selected text changed while saving. Select it again and retry.'
                          )
                          return
                        }
                        setCommentDraftSelection({
                          sectionId: activeSummary.section.sectionId,
                          ...current
                        })
                        setSelectedCommentThreadId(null)
                        setActiveWorkspace('comments')
                      })
                    }}
                  />
                </section>
              ) : (
                <div className='flex min-h-96 items-center justify-center rounded-lg border border-dashed text-center'>
                  <div className='flex flex-col gap-3'>
                    <FileText className='mx-auto size-8 text-muted-foreground' />
                    <p className='font-medium'>No section is available</p>
                    <Button onClick={() => void openOutlineEditor()}>Open outline editor</Button>
                  </div>
                </div>
              )}
              <div className='flex items-center justify-between text-xs text-muted-foreground'>
                <span>⌘/Ctrl+S save · ⇧⌘/Ctrl+K quick actions · ⌘/Ctrl+Alt+↑/↓ navigate</span>
                <span>⌘/Ctrl+J toggles the agent panel</span>
              </div>
            </main>
          </SidebarInset>
        </ResizablePanel>
        {props.agentOpen ? (
          <>
            <ResizableHandle
              withHandle
              className={wideAgentLayout ? undefined : 'hidden'}
              data-testid='agent-panel-resize-handle'
            />
            <ResizablePanel
              id='agent'
              className='overflow-hidden'
              defaultSize={wideAgentLayout ? 480 : '100'}
              minSize={wideAgentLayout ? 360 : 0}
              maxSize={wideAgentLayout ? 640 : '100%'}
              groupResizeBehavior='preserve-pixel-size'
              disabled={!wideAgentLayout}
            >
              <AgentPanel
                open
                onOpenChange={props.onAgentOpenChange}
                onOpenSettings={props.onOpenSettings}
                projectSessionId={props.projectSessionId}
                activeSectionId={activeSectionId}
                sectionTitles={sectionTitles}
                currentRevisionIds={currentRevisionIds}
                selection={selectionContext}
                quickActionRequest={quickActionRequest}
                promptRequest={commentPromptRequest}
                onPromptHandled={(requestId, started) => {
                  if (!started) {
                    props.onError('The Agent could not start for the selected comments. Try again.')
                    return
                  }
                  setCommentPromptRequest((current) =>
                    current?.requestId === requestId ? null : current
                  )
                }}
                onQuickActionHandled={(requestId) => {
                  setQuickActionRequest((current) =>
                    current?.requestId === requestId ? null : current
                  )
                }}
                onFollowSection={followAgentSection}
                flushCurrent={flushCurrent}
                refreshManuscript={refreshAfterAgentMutation}
                onError={props.onError}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      <Dialog
        open={overlappingCommentThreadIds.length > 1}
        onOpenChange={(open) => {
          if (!open) setOverlappingCommentThreadIds([])
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select a comment</DialogTitle>
            <DialogDescription>
              Several comments cover this text. Choose the thread you want to open.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            {overlappingCommentThreadIds.map((threadId) => {
              const thread = findCommentSummary(threadId)
              return (
                <Button
                  key={threadId}
                  variant='outline'
                  className='h-auto justify-start whitespace-normal text-left'
                  onClick={() => {
                    if (thread === undefined) return
                    openCommentThread(thread)
                  }}
                >
                  <span className='min-w-0'>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {thread?.sectionTitle ?? 'Comment'}
                    </span>
                    <span className='line-clamp-2 block'>
                      {thread?.latestMessagePreview ??
                        'This comment is no longer in the current list.'}
                    </span>
                  </span>
                </Button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {workspace ? (
        <OutlineEditPanel
          open={outlineEditOpen}
          workspace={workspace}
          activeSectionId={activeSectionId}
          focusTarget={outlineSearchFocus}
          onFocusTargetConsumed={() => setOutlineSearchFocus(null)}
          onRequestClose={() => setOutlineEditOpen(false)}
          onUpdateSection={updateOutlineSection}
          onMoveSection={moveOutlineSection}
          onCreateSection={createOutlineSection}
          onDeleteSection={deleteOutlineSection}
          onOpenSection={selectSection}
        />
      ) : null}

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

      <PublicationPreflightDialog
        open={publicationOpen}
        preview={publicationQuery.data}
        pending={publicationQuery.isPending || publicationQuery.isFetching}
        error={publicationQuery.isError}
        onOpenChange={setPublicationOpen}
        onRetry={() => void publicationQuery.refetch()}
        onNavigate={(target) => {
          setPublicationOpen(false)
          void selectSection(target.sectionId).then((selected) => {
            if (!selected || target.blockId === null) return
            requestAnimationFrame(() => editorRef.current?.revealBlock(target.blockId ?? ''))
          })
        }}
      />

      <ManuscriptImportDialog
        key={importPlan?.planId ?? 'empty-import-plan'}
        open={importOpen}
        plan={importPlan}
        loading={importLoading}
        applying={importApplying}
        error={importError}
        onOpenChange={(open) => {
          if (open) setImportOpen(true)
          else void cancelManuscriptImport()
        }}
        onApply={applyManuscriptImport}
        onCancel={cancelManuscriptImport}
      />

      <ReferenceSourceDialog
        projectSessionId={props.projectSessionId}
        state={referenceDialog}
        onOpenChange={(open) => {
          if (open) return
          referenceRequestSequenceRef.current += 1
          setReferenceDialog(null)
        }}
        onRetry={openReference}
        onSelect={(entry, citation) => {
          setReferenceDialog({ phase: 'resolved', entry, citation })
        }}
      />
    </SidebarProvider>
  )
}

const editorSaveStateLabels: Record<SaveState, string> = {
  clean: 'Unsaved body',
  saving: 'Saving body',
  saved: 'Saved',
  'mirror-pending': 'Saved, mirror pending',
  conflict: 'Conflict',
  failed: 'Save failed'
}

const SECTION_TITLE_MAX_LENGTH = 500

function PublicationPreflightDialog(props: {
  open: boolean
  preview: PublicationPreview | undefined
  pending: boolean
  error: boolean
  onOpenChange(open: boolean): void
  onRetry(): void
  onNavigate(target: NonNullable<PublicationPreview['findings'][number]['target']>): void
}): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Publication preflight</DialogTitle>
          <DialogDescription>
            One captured publication model drives DOCX, LaTeX, and PDF output.
          </DialogDescription>
        </DialogHeader>
        {props.pending ? (
          <div className='flex min-h-40 items-center justify-center gap-2 text-muted-foreground'>
            <Spinner /> Verifying manuscript and assets…
          </div>
        ) : props.error || props.preview === undefined ? (
          <Alert variant='destructive'>
            <AlertCircle />
            <AlertTitle>Preflight unavailable</AlertTitle>
            <AlertDescription className='flex items-center justify-between gap-3'>
              The current publication state could not be captured.
              <Button size='sm' variant='outline' onClick={props.onRetry}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className='grid gap-4'>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              <PreflightMetric label='Nodes' value={props.preview.nodeCount} />
              <PreflightMetric label='Figures' value={props.preview.figureCount} />
              <PreflightMetric label='References' value={props.preview.referenceCount} />
              <PreflightMetric
                label='Findings'
                value={props.preview.errorCount + props.preview.warningCount}
              />
            </div>
            <Alert variant={props.preview.ready ? 'default' : 'destructive'}>
              {props.preview.ready ? <CheckCircle2 /> : <AlertCircle />}
              <AlertTitle>
                {props.preview.ready ? 'Ready to publish' : 'Resolve publication errors'}
              </AlertTitle>
              <AlertDescription>
                {props.preview.errorCount} errors · {props.preview.warningCount} warnings · source{' '}
                {props.preview.sourceHash.slice(0, 12)}
              </AlertDescription>
            </Alert>
            <div className='grid gap-4 rounded-md border p-4 sm:grid-cols-[minmax(0,1fr)_12rem]'>
              <div className='grid content-start gap-2 text-sm'>
                <p className='font-medium'>Print layout</p>
                <p className='text-muted-foreground'>
                  {props.preview.options.pageSize === 'A4'
                    ? 'A4 · 210 × 297 mm'
                    : 'Letter · 8.5 × 11 in'}
                </p>
                <p className='text-muted-foreground'>
                  Margins {props.preview.options.marginsMm.top} /{' '}
                  {props.preview.options.marginsMm.right} / {props.preview.options.marginsMm.bottom}{' '}
                  / {props.preview.options.marginsMm.left} mm
                </p>
                <div className='flex flex-wrap gap-2 pt-1'>
                  <Badge variant='outline'>{props.preview.options.template}</Badge>
                  <Badge variant='outline'>Page numbers</Badge>
                  {props.preview.options.includeTableOfContents ? (
                    <Badge variant='outline'>Table of contents</Badge>
                  ) : null}
                  {props.preview.options.includeReferences ? (
                    <Badge variant='outline'>References</Badge>
                  ) : null}
                </div>
              </div>
              <div
                className={`mx-auto flex w-32 flex-col border bg-background p-3 shadow-sm ${
                  props.preview.options.pageSize === 'A4' ? 'aspect-[210/297]' : 'aspect-[8.5/11]'
                }`}
                role='img'
                aria-label={`${props.preview.options.pageSize} print page preview`}
              >
                <div className='mt-3 h-2 w-3/4 rounded-sm bg-foreground/70' />
                <div className='mt-4 h-1 w-full rounded-sm bg-muted-foreground/30' />
                <div className='mt-1 h-1 w-11/12 rounded-sm bg-muted-foreground/30' />
                <div className='mt-1 h-1 w-4/5 rounded-sm bg-muted-foreground/30' />
                <div className='mt-auto text-center text-[8px] text-muted-foreground'>1</div>
              </div>
            </div>
            {props.preview.findings.length === 0 ? (
              <p className='rounded-md border p-4 text-sm text-muted-foreground'>
                No publication losses or blocking issues were found.
              </p>
            ) : (
              <div className='grid gap-2'>
                {props.preview.findings.map((finding) => (
                  <button
                    key={finding.findingId}
                    type='button'
                    className='flex w-full items-start gap-3 rounded-md border p-3 text-left hover:bg-muted/50 disabled:cursor-default'
                    disabled={finding.target === null}
                    onClick={() => finding.target && props.onNavigate(finding.target)}
                  >
                    <Badge variant={finding.severity === 'error' ? 'destructive' : 'secondary'}>
                      {finding.severity}
                    </Badge>
                    <span className='min-w-0 flex-1 text-sm'>{finding.message}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PreflightMetric(props: { label: string; value: number }): React.JSX.Element {
  return (
    <div className='rounded-md border p-3'>
      <p className='text-xs text-muted-foreground'>{props.label}</p>
      <p className='mt-1 text-lg font-semibold tabular-nums'>{props.value}</p>
    </div>
  )
}

function ReferenceSourceDialog(props: {
  projectSessionId: string
  state: ReferenceDialogState | null
  onOpenChange(open: boolean): void
  onRetry(entry: ManuscriptReferenceEntry): void
  onSelect(entry: ManuscriptReferenceEntry, citation: ExpandedCitation): void
}): React.JSX.Element {
  const state = props.state
  const title =
    state?.phase === 'resolved'
      ? state.citation.title
      : state?.phase === 'ambiguous'
        ? 'Choose source evidence'
        : state?.phase === 'loading'
          ? `Resolving [${state.entry.number}]`
          : state?.phase === 'error'
            ? 'Source preview unavailable'
            : 'Source link unavailable'
  const description =
    state?.phase === 'resolved'
      ? `${state.citation.headingPath.join(' / ') || 'Normalized source chunk'}${
          state.citation.page === undefined ? '' : ` · Page ${state.citation.page + 1}`
        }`
      : state?.phase === 'ambiguous'
        ? 'This reference matches more than one evidence chunk. Choose the one to preview.'
        : state?.phase === 'loading'
          ? `Checking occurrences of ${state.entry.title} in manuscript order.`
          : state?.phase === 'error'
            ? 'The citation resolver failed unexpectedly. Retry without leaving the manuscript.'
            : referenceUnavailableMessage(
                state?.phase === 'unavailable' ? state.reason : 'unlinked'
              )
  return (
    <Dialog open={state !== null} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] max-w-3xl! overflow-y-auto'>
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
            onSelect={(citation) => props.onSelect(state.entry, citation)}
          />
        ) : null}
        {state?.phase === 'unavailable' ? (
          <div className='flex gap-3 rounded-md bg-muted/50 px-4 py-3 text-sm' role='status'>
            <FileSearch className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
            <p>{referenceUnavailableMessage(state.reason)}</p>
          </div>
        ) : null}
        {state?.phase === 'error' ? (
          <div className='flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-4 py-3 text-sm'>
            <p>The source preview could not be loaded. The reference index is unchanged.</p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => props.onRetry(state.entry)}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function referenceUnavailableMessage(
  reason: Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
): string {
  switch (reason) {
    case 'unlinked':
      return 'No verifiable source association was found for any occurrence of this reference.'
    case 'source_missing':
      return 'The linked source is no longer available in the active knowledge index.'
    case 'index_unavailable':
      return 'The knowledge index is still preparing. Try this reference again when indexing is complete.'
    case 'resolution_limit':
      return 'The reference is older than the bounded provenance history available for interactive preview.'
  }
}

function normalizeSectionTitleDraft(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

type ReferenceDialogState =
  | { phase: 'loading'; entry: ManuscriptReferenceEntry }
  | { phase: 'resolved'; entry: ManuscriptReferenceEntry; citation: ExpandedCitation }
  | { phase: 'ambiguous'; entry: ManuscriptReferenceEntry; citations: ExpandedCitation[] }
  | {
      phase: 'unavailable'
      entry: ManuscriptReferenceEntry
      reason: Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
    }
  | { phase: 'error'; entry: ManuscriptReferenceEntry }
