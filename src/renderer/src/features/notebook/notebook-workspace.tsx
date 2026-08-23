import type { KnowledgeItem } from '../../../../shared/contracts/knowledge'
import {
  NOTEBOOK_MAX_QUESTION_BYTES,
  type NotebookChatCitation,
  type NotebookChatEvent,
  type NotebookChatSnapshot,
  type NotebookSourceScope
} from '../../../../shared/contracts/notebook'
import type { AgentProviderCatalog } from '../../../../shared/contracts/providers'
import type { ExpandedCitation } from '../../../../shared/contracts/search'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  FileQuestion,
  FileText,
  Info,
  LibraryBig,
  NotebookPen,
  PanelLeft,
  ShieldCheck,
  Square
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorkspaceRail } from '@/components/app-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage
} from '@/components/ui/breadcrumb'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { AgentMarkdown } from '@/features/agent/agent-markdown'
import { AgentModelPicker } from '@/features/agent/agent-model-picker'
import { ExpandedCitationPreview } from '@/features/knowledge/citation-preview'

const EMPTY_CATALOG: AgentProviderCatalog = {
  presets: [],
  defaultSelection: null,
  defaultThinkingLevel: 'off'
}

interface NotebookNavigationProps {
  onOpenManuscript(): void
  onOpenPreview(): void
  onOpenKnowledge(): void
  onOpenChecks(): void
  onOpenAssets(): void
  onOpenReferences(): void
  onOpenIssues(): void
  onOpenWritingRules(): void
  onOpenFind(): void
  onOpenSettings(): void
}

export function NotebookWorkspace(
  props: NotebookNavigationProps & {
    projectSessionId: string
    projectName: string
    onError(message: string): void
  }
): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<NotebookChatSnapshot | null>(null)
  const snapshotRef = useRef<NotebookChatSnapshot | null>(null)
  const pendingEventsRef = useRef<NotebookChatEvent[]>([])
  const [composer, setComposer] = useState('')
  const [commandBusy, setCommandBusy] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [citationDialog, setCitationDialog] = useState<{
    citation: NotebookChatCitation
    expanded: ExpandedCitation | null
    loading: boolean
    unavailable: boolean
  } | null>(null)
  const itemsQuery = useQuery({
    queryKey: ['knowledge-items', props.projectSessionId],
    queryFn: () => window.desktop.knowledge.list({ projectSessionId: props.projectSessionId }),
    refetchInterval: snapshot?.sourceReadiness === 'preparing' ? 1_000 : false
  })
  const providersQuery = useQuery({
    queryKey: ['provider-settings'],
    queryFn: () => window.desktop.providers.snapshot()
  })
  const providerCatalog = providersQuery.data?.agentCatalog ?? EMPTY_CATALOG
  const availableModelPresets = useMemo(
    () =>
      providerCatalog.presets
        .filter((preset) => preset.enabled && preset.authConfigured)
        .map((preset) => ({
          ...preset,
          models: preset.models.filter((model) => model.enabled)
        }))
        .filter((preset) => preset.models.length > 0),
    [providerCatalog]
  )

  const applySnapshot = useCallback((candidate: NotebookChatSnapshot): void => {
    if ((snapshotRef.current?.revision ?? -1) > candidate.revision) return
    snapshotRef.current = candidate
    setSnapshot(candidate)
  }, [])

  const applyEvent = useCallback(
    (event: NotebookChatEvent): void => {
      if (event.kind === 'snapshot') {
        applySnapshot(event.snapshot)
        return
      }
      const current = snapshotRef.current
      if (current === null) {
        pendingEventsRef.current.push(event)
        return
      }
      if (event.revision <= current.revision) return
      const next = {
        ...current,
        revision: event.revision,
        messages: current.messages.map((message) =>
          message.messageId === event.messageId && message.role === 'assistant'
            ? { ...message, content: `${message.content}${event.delta}` }
            : message
        )
      }
      applySnapshot(next)
    },
    [applySnapshot]
  )

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | null = null
    snapshotRef.current = null
    setSnapshot(null)
    setConnectionError(false)
    void window.desktop.notebook
      .subscribe({ projectSessionId: props.projectSessionId }, applyEvent)
      .then((subscription) => {
        if (disposed) {
          subscription.unsubscribe()
          return
        }
        unsubscribe = subscription.unsubscribe
        applySnapshot(subscription.snapshot)
        const pending = pendingEventsRef.current.splice(0).sort((a, b) => a.revision - b.revision)
        for (const event of pending) applyEvent(event)
      })
      .catch(() => {
        if (!disposed) setConnectionError(true)
      })
    return () => {
      disposed = true
      pendingEventsRef.current = []
      unsubscribe?.()
    }
  }, [applyEvent, applySnapshot, props.projectSessionId])

  useEffect(() => {
    if (snapshot?.sourceReadiness !== 'preparing') return
    let disposed = false
    const refresh = (): void => {
      void window.desktop.notebook
        .snapshot({ projectSessionId: props.projectSessionId })
        .then((candidate) => {
          if (!disposed) applySnapshot(candidate)
        })
        .catch(() => {
          if (!disposed) setConnectionError(true)
        })
    }
    const interval = window.setInterval(refresh, 1_000)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [applySnapshot, props.projectSessionId, snapshot?.sourceReadiness])

  const runCommand = async (
    operation: () => Promise<NotebookChatSnapshot>,
    failureMessage: string
  ): Promise<void> => {
    setCommandBusy(true)
    try {
      applySnapshot(await operation())
    } catch {
      props.onError(failureMessage)
    } finally {
      setCommandBusy(false)
    }
  }

  const startTurn = async (): Promise<void> => {
    const content = composer.trim()
    if (content.length === 0 || snapshot === null) return
    setCommandBusy(true)
    try {
      const result = await window.desktop.notebook.startTurn({
        projectSessionId: props.projectSessionId,
        content
      })
      applySnapshot(result.snapshot)
      setComposer('')
    } catch {
      props.onError('Notebook could not start that question. Check sources and model settings.')
    } finally {
      setCommandBusy(false)
    }
  }

  const setSources = (sourceScope: NotebookSourceScope): void => {
    void runCommand(
      () =>
        window.desktop.notebook.setSources({
          projectSessionId: props.projectSessionId,
          sourceScope
        }),
      'Notebook sources could not be changed.'
    )
  }

  const openCitation = async (citation: NotebookChatCitation): Promise<void> => {
    setCitationDialog({ citation, expanded: null, loading: true, unavailable: false })
    try {
      const expanded = await window.desktop.knowledge.expandCitations({
        projectSessionId: props.projectSessionId,
        citationIds: [citation.citationId]
      })
      setCitationDialog({
        citation,
        expanded: expanded[0] ?? null,
        loading: false,
        unavailable: expanded.length === 0
      })
    } catch {
      setCitationDialog({ citation, expanded: null, loading: false, unavailable: true })
    }
  }

  const items = itemsQuery.data ?? []
  const availableIds = snapshot?.availableKnowledgeItemIds ?? []
  const availableSet = useMemo(() => new Set(availableIds), [availableIds])
  const selectedIds = useMemo(() => {
    if (snapshot === null) return new Set<string>()
    return new Set(
      snapshot.sourceScope.mode === 'all'
        ? snapshot.availableKnowledgeItemIds
        : snapshot.sourceScope.knowledgeItemIds.filter((id) => availableSet.has(id))
    )
  }, [availableSet, snapshot])
  const active = snapshot !== null && snapshot.phase !== 'idle'
  const canAsk =
    snapshot !== null &&
    !active &&
    !commandBusy &&
    selectedIds.size > 0 &&
    snapshot.modelSelection !== null &&
    composer.trim().length > 0

  return (
    <SidebarProvider
      data-testid='notebook-workspace'
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '340px' } as React.CSSProperties}
    >
      <Sidebar
        collapsible='icon'
        className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      >
        <WorkspaceRail
          activeWorkspace='notebook'
          onOpenPreview={props.onOpenPreview}
          onOpenKnowledge={props.onOpenKnowledge}
          onOpenNotebook={() => undefined}
          onOpenChecks={props.onOpenChecks}
          onOpenAssets={props.onOpenAssets}
          onOpenManuscript={props.onOpenManuscript}
          onOpenReferences={props.onOpenReferences}
          onOpenIssues={props.onOpenIssues}
          onOpenWritingRules={props.onOpenWritingRules}
          onOpenFind={props.onOpenFind}
          onOpenSettings={props.onOpenSettings}
        />
        <NotebookSourcesSidebar
          items={items}
          loading={itemsQuery.isPending || snapshot === null}
          snapshot={snapshot}
          availableSet={availableSet}
          selectedIds={selectedIds}
          disabled={active || commandBusy}
          onOpenKnowledge={props.onOpenKnowledge}
          onSetSources={setSources}
        />
      </Sidebar>
      <SidebarInset className='flex min-h-0 min-w-0 flex-col overflow-hidden'>
        <header className='flex shrink-0 items-center gap-2 border-b bg-background p-4'>
          <SidebarTrigger className='-ml-1' />
          <Separator orientation='vertical' className='mr-2 data-[orientation=vertical]:h-4' />
          <Breadcrumb className='min-w-0'>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage className='max-w-40 truncate'>{props.projectName}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbItem>
                <BreadcrumbPage>Notebook</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className='ml-auto flex min-w-0 items-center gap-2'>
            <Badge variant='secondary' className='shrink-0 tabular-nums'>
              {selectedIds.size} {selectedIds.size === 1 ? 'source' : 'sources'}
            </Badge>
            <AgentModelPicker
              presets={availableModelPresets}
              selection={snapshot?.modelSelection ?? null}
              disabled={snapshot === null || active || commandBusy}
              compact
              onSelect={(modelSelection) =>
                runCommand(
                  () =>
                    window.desktop.notebook.setModel({
                      projectSessionId: props.projectSessionId,
                      modelSelection
                    }),
                  'Notebook model could not be changed.'
                )
              }
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={snapshot === null || snapshot.messages.length === 0 || commandBusy}
              onClick={() =>
                void runCommand(
                  () => window.desktop.notebook.clear({ projectSessionId: props.projectSessionId }),
                  'Notebook chat could not be cleared.'
                )
              }
            >
              Clear chat
            </Button>
          </div>
        </header>

        <div className='flex min-h-0 flex-1 flex-col'>
          <NotebookConversation
            snapshot={snapshot}
            connectionError={connectionError}
            hasKnowledge={items.length > 0}
            onOpenKnowledge={props.onOpenKnowledge}
            onCitation={(citation) => void openCitation(citation)}
          />
          <div className='shrink-0 border-t bg-background px-4 py-3'>
            <div className='mx-auto grid w-full max-w-3xl gap-2'>
              {snapshot?.lastError !== null && snapshot?.lastError !== undefined ? (
                <Alert variant='destructive' className='py-2'>
                  <Info />
                  <AlertTitle>Answer unavailable</AlertTitle>
                  <AlertDescription>{snapshot.lastError}</AlertDescription>
                </Alert>
              ) : null}
              <InputGroup
                data-disabled={selectedIds.size === 0 || snapshot?.modelSelection === null}
              >
                <InputGroupTextarea
                  value={composer}
                  maxLength={NOTEBOOK_MAX_QUESTION_BYTES}
                  rows={2}
                  aria-label='Ask selected Knowledge sources'
                  placeholder={
                    selectedIds.size === 0
                      ? 'Select at least one indexed source'
                      : snapshot?.modelSelection === null
                        ? 'Choose a model to ask a question'
                        : 'Ask your selected sources…'
                  }
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      if (canAsk) void startTurn()
                    }
                  }}
                />
                <InputGroupAddon align='block-end' className='justify-between'>
                  <span className='text-xs font-normal'>Shift + Enter for a new line</span>
                  {active ? (
                    <InputGroupButton
                      size='icon-sm'
                      variant='outline'
                      aria-label='Stop Notebook answer'
                      disabled={snapshot.phase === 'stopping' || commandBusy}
                      onClick={() =>
                        void runCommand(
                          () =>
                            window.desktop.notebook.stopTurn({
                              projectSessionId: props.projectSessionId
                            }),
                          'Notebook answer could not be stopped.'
                        )
                      }
                    >
                      {snapshot.phase === 'stopping' ? <Spinner /> : <Square />}
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      size='icon-sm'
                      variant='default'
                      aria-label='Ask Notebook'
                      disabled={!canAsk}
                      onClick={() => void startTurn()}
                    >
                      {commandBusy ? <Spinner /> : <ArrowUp />}
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
              <p className='flex items-start gap-1.5 px-1 text-xs leading-5 text-muted-foreground'>
                <ShieldCheck className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
                WriteLLM does not save this chat. Your model provider receives the question and
                retrieved passages under its own retention policy.
              </p>
            </div>
          </div>
        </div>
      </SidebarInset>

      <Dialog
        open={citationDialog !== null}
        onOpenChange={(open) => !open && setCitationDialog(null)}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{citationDialog?.citation.title ?? 'Citation'}</DialogTitle>
            <DialogDescription>
              {citationDialog?.citation.page === null || citationDialog === null
                ? 'Retrieved Knowledge evidence'
                : `Page ${citationDialog.citation.page + 1} · Retrieved Knowledge evidence`}
            </DialogDescription>
          </DialogHeader>
          {citationDialog?.loading ? (
            <div className='flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground'>
              <Spinner /> Loading citation…
            </div>
          ) : citationDialog?.expanded ? (
            <ExpandedCitationPreview
              projectSessionId={props.projectSessionId}
              citation={citationDialog.expanded}
            />
          ) : citationDialog?.unavailable ? (
            <Alert variant='destructive'>
              <FileQuestion />
              <AlertTitle>Citation unavailable</AlertTitle>
              <AlertDescription>
                This evidence is no longer available in the current Knowledge index.
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  )
}

function NotebookSourcesSidebar(props: {
  items: KnowledgeItem[]
  loading: boolean
  snapshot: NotebookChatSnapshot | null
  availableSet: ReadonlySet<string>
  selectedIds: ReadonlySet<string>
  disabled: boolean
  onOpenKnowledge(): void
  onSetSources(scope: NotebookSourceScope): void
}): React.JSX.Element {
  const allChecked =
    props.snapshot !== null &&
    props.snapshot.availableKnowledgeItemIds.length > 0 &&
    props.snapshot.availableKnowledgeItemIds.every((id) => props.selectedIds.has(id))
  const someChecked = props.selectedIds.size > 0 && !allChecked

  const toggleItem = (knowledgeItemId: string): void => {
    if (props.snapshot === null || !props.availableSet.has(knowledgeItemId)) return
    const next = new Set(props.selectedIds)
    if (next.has(knowledgeItemId)) next.delete(knowledgeItemId)
    else next.add(knowledgeItemId)
    const available = props.snapshot.availableKnowledgeItemIds
    props.onSetSources(
      next.size === available.length && available.every((id) => next.has(id))
        ? { mode: 'all', knowledgeItemIds: [] }
        : { mode: 'selected', knowledgeItemIds: [...next].sort() }
    )
  }

  return (
    <Sidebar collapsible='none' className='min-w-0 flex-1 overflow-hidden'>
      <SidebarHeader className='gap-3 border-b p-4'>
        <div className='flex items-center gap-2'>
          <NotebookPen className='size-4' aria-hidden='true' />
          <span className='font-medium'>Sources</span>
          <Badge variant='outline' className='ml-auto tabular-nums'>
            {props.selectedIds.size}/{props.snapshot?.availableKnowledgeItemIds.length ?? 0}
          </Badge>
        </div>
        <Field orientation='horizontal'>
          <Checkbox
            id='notebook-select-all'
            checked={someChecked ? 'indeterminate' : allChecked}
            disabled={
              props.disabled ||
              props.snapshot === null ||
              props.snapshot.availableKnowledgeItemIds.length === 0
            }
            onCheckedChange={(checked) =>
              props.onSetSources(
                checked === true
                  ? { mode: 'all', knowledgeItemIds: [] }
                  : { mode: 'selected', knowledgeItemIds: [] }
              )
            }
          />
          <FieldContent>
            <FieldLabel htmlFor='notebook-select-all'>Select all indexed sources</FieldLabel>
            <FieldDescription>Up to 50 sources per answer</FieldDescription>
          </FieldContent>
        </Field>
      </SidebarHeader>
      <SidebarContent className='p-2'>
        {props.loading ? (
          <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
            <Spinner /> Loading sources…
          </div>
        ) : props.items.length === 0 ? (
          <Empty className='gap-3 border-0 p-4'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <LibraryBig />
              </EmptyMedia>
              <EmptyTitle className='text-sm'>No Knowledge sources</EmptyTitle>
              <EmptyDescription>Add and index sources in Knowledge first.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <fieldset className='grid gap-1' aria-label='Notebook Knowledge sources'>
            {props.items.map((item) => {
              const available = props.availableSet.has(item.knowledgeItemId)
              const status = sourceStatus(item, available, props.snapshot?.sourceReadiness)
              const checkboxId = `notebook-source-${item.knowledgeItemId}`
              return (
                <Field
                  key={item.knowledgeItemId}
                  orientation='horizontal'
                  data-disabled={!available}
                  className='rounded-md px-2 py-2 hover:bg-sidebar-accent/60'
                >
                  <Checkbox
                    id={checkboxId}
                    checked={props.selectedIds.has(item.knowledgeItemId)}
                    disabled={props.disabled || !available}
                    onCheckedChange={() => toggleItem(item.knowledgeItemId)}
                  />
                  <FieldContent className='min-w-0'>
                    <FieldLabel htmlFor={checkboxId} className='min-w-0 cursor-pointer'>
                      <FileText className='size-4 shrink-0 text-muted-foreground' />
                      <span className='truncate'>{item.displayName}</span>
                    </FieldLabel>
                    <FieldDescription className='flex items-center gap-1.5 text-xs'>
                      <span className='truncate'>{item.extension?.toUpperCase() ?? 'SOURCE'}</span>
                      <span aria-hidden='true'>·</span>
                      <span>{status}</span>
                    </FieldDescription>
                  </FieldContent>
                </Field>
              )
            })}
          </fieldset>
        )}
      </SidebarContent>
      <SidebarFooter className='border-t p-3'>
        <Button type='button' variant='outline' size='sm' onClick={props.onOpenKnowledge}>
          <LibraryBig /> Manage sources
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}

function NotebookConversation(props: {
  snapshot: NotebookChatSnapshot | null
  connectionError: boolean
  hasKnowledge: boolean
  onOpenKnowledge(): void
  onCitation(citation: NotebookChatCitation): void
}): React.JSX.Element {
  if (props.connectionError) {
    return (
      <div className='flex min-h-0 flex-1 p-6'>
        <Alert variant='destructive' className='m-auto max-w-xl'>
          <Info />
          <AlertTitle>Notebook could not connect</AlertTitle>
          <AlertDescription>Reopen the project and try again.</AlertDescription>
        </Alert>
      </div>
    )
  }
  if (props.snapshot === null) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground'>
        <Spinner /> Opening Notebook…
      </div>
    )
  }
  if (props.snapshot.messages.length === 0) {
    const noSources = props.snapshot.availableKnowledgeItemIds.length === 0
    return (
      <Empty className='min-h-0 flex-1 border-0'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>{noSources ? <LibraryBig /> : <NotebookPen />}</EmptyMedia>
          <EmptyTitle>
            {noSources
              ? props.hasKnowledge
                ? 'Sources are not indexed yet'
                : 'Add Knowledge sources first'
              : 'Ask across your selected sources'}
          </EmptyTitle>
          <EmptyDescription>
            {noSources
              ? 'Notebook can use sources after parsing and indexing finish.'
              : 'Answers stay grounded in retrieved evidence and include clickable citations.'}
          </EmptyDescription>
        </EmptyHeader>
        {noSources ? (
          <EmptyContent>
            <Button type='button' variant='outline' onClick={props.onOpenKnowledge}>
              <LibraryBig /> Open Knowledge
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    )
  }
  const snapshot = props.snapshot
  return (
    <MessageScrollerProvider>
      <MessageScroller className='min-h-0 flex-1'>
        <MessageScrollerViewport>
          <MessageScrollerContent className='mx-auto w-full max-w-3xl gap-6 px-4 py-8'>
            {snapshot.messages.map((message, index) => (
              <MessageScrollerItem
                key={message.messageId}
                scrollAnchor={index === snapshot.messages.length - 1}
              >
                {message.role === 'source_boundary' ? (
                  <Marker variant='separator'>
                    <MarkerIcon>
                      <PanelLeft />
                    </MarkerIcon>
                    <MarkerContent>{message.content}</MarkerContent>
                  </Marker>
                ) : message.role === 'user' ? (
                  <Message align='end'>
                    <MessageContent>
                      <Bubble variant='secondary' align='end'>
                        <BubbleContent className='whitespace-pre-wrap'>
                          {message.content}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                ) : (
                  <Message>
                    <MessageContent>
                      <Bubble variant='ghost'>
                        <BubbleContent>
                          {message.content.length === 0 && message.status === 'streaming' ? (
                            <span className='flex items-center gap-2 text-muted-foreground'>
                              <Spinner />
                              {snapshot.phase === 'retrieving'
                                ? 'Searching selected sources…'
                                : 'Writing an evidence-grounded answer…'}
                            </span>
                          ) : (
                            <AgentMarkdown
                              content={message.content}
                              citationOrdinals={message.citations.map(
                                (citation) => citation.ordinal
                              )}
                              onCitation={(ordinal) => {
                                const citation = message.citations.find(
                                  (candidate) => candidate.ordinal === ordinal
                                )
                                if (citation !== undefined) props.onCitation(citation)
                              }}
                            />
                          )}
                        </BubbleContent>
                      </Bubble>
                      {message.status === 'stopped' || message.status === 'failed' ? (
                        <MessageFooter>
                          {message.status === 'stopped' ? 'Stopped' : 'Answer failed'}
                        </MessageFooter>
                      ) : null}
                    </MessageContent>
                  </Message>
                )}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function sourceStatus(
  item: KnowledgeItem,
  available: boolean,
  readiness: NotebookChatSnapshot['sourceReadiness'] | undefined
): string {
  if (available) return 'Indexed'
  if (item.state === 'failed' || item.normalizationState === 'failed') return 'Failed'
  if (item.state === 'importing' || item.activeParseRevisionId === null) return 'Processing'
  if (readiness === 'preparing') return 'Indexing'
  return 'Not indexed'
}
