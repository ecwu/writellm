import type { KnowledgeItem, ParsedKnowledgeDocument } from '../../../../shared/contracts/knowledge'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  File,
  FileCheck2,
  FileUp,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  PanelLeft,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from '@/components/ui/sidebar'
import { WorkspaceRail } from '@/components/app-sidebar'
import { KnowledgeSearch } from './knowledge-search'
import { ParsedDocumentViewer } from './parsed-document-viewer'

const activeParseStates = new Set([
  'queued',
  'allocating',
  'awaiting_upload',
  'polling',
  'downloading',
  'extracting',
  'publishing'
])

export function KnowledgeManager(props: {
  projectSessionId: string
  projectName: string
  globalAlert: React.ReactNode
  onOpenManuscript(): void
  onOpenSettings(): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const key = ['knowledge-items', props.projectSessionId] as const
  const itemsQuery = useQuery({
    queryKey: key,
    queryFn: () => window.desktop.knowledge.list({ projectSessionId: props.projectSessionId }),
    refetchInterval: 1_000
  })
  const items = itemsQuery.data ?? []
  const jobsQuery = useQuery({
    queryKey: ['knowledge-jobs', props.projectSessionId],
    queryFn: () =>
      window.desktop.jobs.list({ projectSessionId: props.projectSessionId, limit: 100 }),
    refetchInterval: 1_000
  })
  const indexStatusQuery = useQuery({
    queryKey: ['knowledge-index-status', props.projectSessionId],
    queryFn: () =>
      window.desktop.knowledge.indexStatus({ projectSessionId: props.projectSessionId }),
    refetchInterval: 1_000,
    retry: false
  })
  const parsedQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ['parsed-knowledge', props.projectSessionId, item.knowledgeItemId],
      queryFn: () =>
        window.desktop.knowledge.parsedDocument({
          projectSessionId: props.projectSessionId,
          knowledgeItemId: item.knowledgeItemId
        }),
      staleTime: 500,
      refetchInterval: 1_000
    }))
  })
  const parsedById = useMemo(
    () =>
      new Map(
        items.map((item, index) => [item.knowledgeItemId, parsedQueries[index]?.data] as const)
      ),
    [items, parsedQueries]
  )
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (selectedItemId !== null && !items.some((item) => item.knowledgeItemId === selectedItemId)) {
      setSelectedItemId(null)
    }
  }, [items, selectedItemId])

  const selectedItem = items.find((item) => item.knowledgeItemId === selectedItemId)
  const selectedParsed = selectedItemId === null ? undefined : parsedById.get(selectedItemId)
  const selectedParsedQuery =
    selectedItemId === null
      ? undefined
      : parsedQueries[items.findIndex((item) => item.knowledgeItemId === selectedItemId)]
  const jobs = jobsQuery.data?.jobs ?? []
  const stats = getStats(items, parsedById, jobs)
  const embeddingInProgress = jobs.some(
    (job) =>
      job.type === 'build_embedding_generation' &&
      (job.state === 'queued' || job.state === 'running')
  )
  const parsingInProgress = items.some((item) => {
    const parsed = parsedById.get(item.knowledgeItemId)
    return (
      isParseInProgress(parsed?.parseState) ||
      (parsed?.parseState === 'succeeded' && parsed.normalizationState === 'staging')
    )
  })

  const replace = (nextItems: KnowledgeItem[]): void => {
    queryClient.setQueryData(key, nextItems)
  }
  const run = async (operation: () => Promise<KnowledgeItem[]>): Promise<void> => {
    setBusy(true)
    try {
      replace(await operation())
      await queryClient.invalidateQueries({
        queryKey: ['parsed-knowledge', props.projectSessionId]
      })
    } catch {
      props.onError('One or more knowledge files could not be imported or updated.')
      await itemsQuery.refetch()
    } finally {
      setBusy(false)
    }
  }
  const importFiles = (): void => {
    void run(() =>
      window.desktop.knowledge.chooseAndImport({ projectSessionId: props.projectSessionId })
    )
  }
  const importDropped = (files: File[]): void => {
    if (files.length === 0) return
    void run(() =>
      window.desktop.knowledge.importDropped({ projectSessionId: props.projectSessionId, files })
    )
  }
  const parseSelected = async (): Promise<void> => {
    if (selectedItemId === null) return
    setBusy(true)
    try {
      await window.desktop.knowledge.startParse({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: selectedItemId
      })
      await queryClient.invalidateQueries({
        queryKey: ['parsed-knowledge', props.projectSessionId, selectedItemId]
      })
    } catch {
      props.onError('MinerU parsing could not be started. Check the MinerU provider settings.')
    } finally {
      setBusy(false)
    }
  }
  const refreshEmbeddings = async (knowledgeItemId?: string): Promise<void> => {
    setBusy(true)
    try {
      await window.desktop.knowledge.refreshEmbeddings({
        projectSessionId: props.projectSessionId,
        ...(knowledgeItemId === undefined ? {} : { knowledgeItemId })
      })
      await queryClient.invalidateQueries({
        queryKey: ['knowledge-jobs', props.projectSessionId]
      })
    } catch {
      props.onError(
        embeddingInProgress
          ? 'Embedding is already running. Wait for the current task to finish.'
          : 'Embedding could not be started. Check the embedding provider and search index status.'
      )
    } finally {
      setBusy(false)
    }
  }
  const reparseAll = async (): Promise<void> => {
    const sources = items.filter((item) => item.state === 'stored')
    if (sources.length === 0) return
    setBusy(true)
    let failedCount = 0
    try {
      for (const item of sources) {
        try {
          await window.desktop.knowledge.startParse({
            projectSessionId: props.projectSessionId,
            knowledgeItemId: item.knowledgeItemId
          })
        } catch {
          failedCount += 1
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['parsed-knowledge', props.projectSessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ['knowledge-jobs', props.projectSessionId]
        })
      ])
      if (failedCount > 0) {
        props.onError(
          `${failedCount} ${failedCount === 1 ? 'source' : 'sources'} could not be submitted to MinerU.`
        )
      }
    } catch {
      props.onError('The MinerU processing queue could not be refreshed. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const deleteSelected = (): void => {
    if (selectedItemId === null) return
    void run(async () => {
      const next = await window.desktop.knowledge.delete({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: selectedItemId
      })
      return next
    })
  }

  return (
    <SidebarProvider
      data-testid='knowledge-workspace'
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '340px' } as React.CSSProperties}
    >
      <Sidebar
        collapsible='icon'
        className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      >
        <WorkspaceRail
          activeWorkspace='knowledge'
          onOpenKnowledge={() => undefined}
          onOpenManuscript={props.onOpenManuscript}
          onToggleAgent={() => props.onError('The writing agent is unavailable until Phase 9.')}
          onOpenSettings={props.onOpenSettings}
        />
        <KnowledgeSidebar
          items={items}
          parsedById={parsedById}
          jobs={jobs}
          selectedItemId={selectedItemId}
          dragging={dragging}
          busy={busy}
          onSelect={setSelectedItemId}
          onImport={importFiles}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDrop={(files) => {
            setDragging(false)
            importDropped(files)
          }}
        />
      </Sidebar>
      <SidebarInset className='min-h-0 overflow-auto'>
        <header className='sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background p-4'>
          <SidebarTrigger className='-ml-1' />
          <Separator orientation='vertical' className='mr-2 data-[orientation=vertical]:h-4' />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{props.projectName}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbItem>
                <BreadcrumbPage>Knowledge</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className='ml-auto flex min-w-0 items-center gap-2'>
            <KnowledgeHeaderStats
              stats={stats}
              indexed={indexStatusQuery.data?.indexed}
              indexStatusUnavailable={indexStatusQuery.isError}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='icon-sm' aria-label='Knowledge actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem
                  data-testid='knowledge-reparse-all-action'
                  disabled={busy || parsingInProgress || stats.stored === 0}
                  onClick={() => void reparseAll()}
                >
                  {parsingInProgress ? <LoaderCircle className='animate-spin' /> : <RefreshCw />}
                  {parsingInProgress
                    ? 'MinerU processing in progress'
                    : 'Reprocess all with MinerU'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid='knowledge-reembed-all-action'
                  disabled={busy || embeddingInProgress || stats.parsed === 0}
                  onClick={() => void refreshEmbeddings()}
                >
                  {embeddingInProgress ? <LoaderCircle className='animate-spin' /> : <Zap />}
                  {embeddingInProgress ? 'Embedding in progress' : 'Recalculate all embeddings'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className='mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 md:px-8'>
          {props.globalAlert}
          {itemsQuery.isError ? (
            <div className='mt-6 flex items-center gap-2 border-y border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive'>
              <AlertCircle className='size-4' /> Knowledge files could not be loaded.
            </div>
          ) : null}
          {selectedItem ? (
            <KnowledgeDetails
              projectSessionId={props.projectSessionId}
              item={selectedItem}
              parsed={selectedParsed}
              parsedLoading={selectedParsedQuery?.isLoading ?? false}
              busy={busy}
              embeddingInProgress={embeddingInProgress}
              onParse={() => void parseSelected()}
              onRefreshEmbeddings={() => void refreshEmbeddings(selectedItem.knowledgeItemId)}
              onCancelParse={async () => {
                if (selectedItemId === null) return
                setBusy(true)
                try {
                  await window.desktop.knowledge.cancelParse({
                    projectSessionId: props.projectSessionId,
                    knowledgeItemId: selectedItemId
                  })
                  await queryClient.invalidateQueries({
                    queryKey: ['parsed-knowledge', props.projectSessionId, selectedItemId]
                  })
                } catch {
                  props.onError('MinerU parsing could not be stopped. Please try again.')
                } finally {
                  setBusy(false)
                }
              }}
              onOpen={() =>
                void window.desktop.knowledge.openOriginal({
                  projectSessionId: props.projectSessionId,
                  knowledgeItemId: selectedItem.knowledgeItemId
                })
              }
              onReveal={() =>
                void window.desktop.knowledge.reveal({
                  projectSessionId: props.projectSessionId,
                  knowledgeItemId: selectedItem.knowledgeItemId
                })
              }
              onDelete={deleteSelected}
              onClose={() => setSelectedItemId(null)}
              onError={props.onError}
            />
          ) : (
            <KnowledgeOverview
              items={items}
              projectSessionId={props.projectSessionId}
              onError={props.onError}
            />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function KnowledgeOverview(props: {
  items: KnowledgeItem[]
  projectSessionId: string
  onError(message: string): void
}): React.JSX.Element {
  return (
    <section className='flex min-h-[calc(100dvh-6.5rem)] flex-1 justify-center py-12'>
      <div className='w-full max-w-3xl'>
        <div className='mb-6'>
          <h1 className='flex items-center gap-2 text-xl font-semibold tracking-tight'>
            <Search className='size-5' /> Search knowledge
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Find passages across every parsed source in this project.
          </p>
        </div>
        <KnowledgeSearch
          projectSessionId={props.projectSessionId}
          items={props.items}
          onError={props.onError}
        />
        {props.items.length === 0 ? (
          <p className='mt-8 border-y py-6 text-center text-sm text-muted-foreground'>
            Upload and parse a source to make it searchable.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function KnowledgeSidebar(props: {
  items: KnowledgeItem[]
  parsedById: Map<string, ParsedKnowledgeDocument | undefined>
  jobs: JobStatus[]
  selectedItemId: string | null
  dragging: boolean
  busy: boolean
  onSelect(id: string): void
  onImport(): void
  onDragEnter(): void
  onDragLeave(): void
  onDrop(files: File[]): void
}): React.JSX.Element {
  const activeJobs = props.jobs.filter((job) => job.state === 'queued' || job.state === 'running')
  return (
    <Sidebar collapsible='none' className='hidden flex-1 md:flex'>
      <div className='border-b p-4'>
        <div className='flex items-center justify-between gap-2'>
          <div className='min-w-0'>
            <p className='text-sm font-semibold'>Sources</p>
            <p className='text-xs text-muted-foreground'>
              {props.items.length} files in this project
            </p>
          </div>
          <Button
            data-testid='knowledge-upload-button'
            size='icon-sm'
            variant='outline'
            aria-label='Upload files'
            onClick={props.onImport}
            disabled={props.busy}
          >
            {props.busy ? <LoaderCircle className='animate-spin' /> : <FileUp />}
          </Button>
        </div>
        <button
          type='button'
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 text-xs text-muted-foreground transition-[min-height,background-color] outline-none focus-visible:ring-2 focus-visible:ring-ring ${props.dragging ? 'min-h-24 border-primary bg-primary/5 text-primary' : 'min-h-9 hover:bg-muted/50'}`}
          onClick={props.onImport}
          onDragEnter={(event) => {
            event.preventDefault()
            props.onDragEnter()
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            props.onDragLeave()
          }}
          onDrop={(event) => {
            event.preventDefault()
            props.onDrop(Array.from(event.dataTransfer.files))
          }}
        >
          <FileUp className='size-3.5' />
          {props.dragging ? 'Drop files to upload' : 'Drop files here'}
        </button>
      </div>
      <SidebarContent>
        <SidebarGroup className='py-3'>
          <SidebarGroupLabel className='px-3'>File list</SidebarGroupLabel>
          <div className='grid gap-1 px-2'>
            {props.items.map((item) => {
              const parsed = props.parsedById.get(item.knowledgeItemId)
              const parsing = isParseInProgress(parsed?.parseState)
              const failed =
                item.state === 'failed' ||
                parsed?.parseState === 'failed' ||
                parsed?.normalizationState === 'failed'
              return (
                <button
                  type='button'
                  key={item.knowledgeItemId}
                  data-testid={`knowledge-file-${item.knowledgeItemId}`}
                  className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring ${props.selectedItemId === item.knowledgeItemId ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}`}
                  onClick={() => props.onSelect(item.knowledgeItemId)}
                >
                  {parsing || item.state === 'importing' ? (
                    <LoaderCircle className='size-4 shrink-0 animate-spin text-primary' />
                  ) : failed ? (
                    <AlertCircle className='size-4 shrink-0 text-destructive' />
                  ) : parsed?.active ? (
                    <FileCheck2 className='size-4 shrink-0 text-emerald-600' />
                  ) : (
                    <File className='size-4 shrink-0 text-muted-foreground' />
                  )}
                  <span className='min-w-0 flex-1 truncate'>{item.displayName}</span>
                  <span className='text-[10px] uppercase text-muted-foreground'>
                    {item.extension ?? 'file'}
                  </span>
                </button>
              )
            })}
            {props.items.length === 0 ? (
              <p className='px-2 py-6 text-center text-xs text-muted-foreground'>No files yet.</p>
            ) : null}
          </div>
        </SidebarGroup>
        <SidebarGroup className='border-t py-3'>
          <SidebarGroupLabel className='flex items-center justify-between px-3'>
            <span>Task progress</span>
            {activeJobs.length > 0 ? <Badge variant='secondary'>{activeJobs.length}</Badge> : null}
          </SidebarGroupLabel>
          <div className='grid gap-2 px-3'>
            {props.jobs.slice(0, 8).map((job) => (
              <TaskRow key={job.jobId} job={job} />
            ))}
            {props.jobs.length === 0 ? (
              <p className='text-xs text-muted-foreground'>No background tasks.</p>
            ) : null}
          </div>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

function TaskRow(props: { job: JobStatus }): React.JSX.Element {
  const running = props.job.state === 'queued' || props.job.state === 'running'
  const failed = props.job.state === 'failed'
  const progress =
    props.job.progress?.completed !== undefined && props.job.progress.total !== undefined
      ? `${Math.round((props.job.progress.completed / props.job.progress.total) * 100)}%`
      : props.job.state
  return (
    <div className='grid gap-1 text-xs'>
      <div className='flex items-center gap-2'>
        {running ? (
          <LoaderCircle className='size-3 animate-spin text-primary' />
        ) : failed ? (
          <AlertCircle className='size-3 text-destructive' />
        ) : (
          <CheckCircle2 className='size-3 text-emerald-600' />
        )}
        <span className='min-w-0 flex-1 truncate'>{jobLabel(props.job.type)}</span>
        <span className='text-muted-foreground'>{progress}</span>
      </div>
      {props.job.progress?.stage ? (
        <p className='truncate pl-5 text-[10px] text-muted-foreground'>
          {props.job.progress.stage}
        </p>
      ) : null}
    </div>
  )
}

function KnowledgeHeaderStats(props: {
  stats: KnowledgeStats
  indexed: boolean | undefined
  indexStatusUnavailable: boolean
}): React.JSX.Element {
  return (
    <dl
      className='hidden items-center divide-x text-xs xl:flex'
      data-testid='knowledge-header-stats'
    >
      <CompactStatus value={props.stats.total.toLocaleString()} label='Files' />
      <CompactStatus value={props.stats.parsed.toLocaleString()} label='Parsed' />
      <CompactStatus value={props.stats.blocks.toLocaleString()} label='Blocks' />
      <CompactStatus
        value={
          props.indexStatusUnavailable
            ? '—'
            : props.indexed === undefined
              ? '…'
              : props.indexed
                ? 'Yes'
                : 'No'
        }
        label='Indexed'
      />
      <CompactStatus value={props.stats.queue.toLocaleString()} label='Queue' />
    </dl>
  )
}

function CompactStatus(props: { value: string; label: string }): React.JSX.Element {
  return (
    <div
      className='flex items-baseline gap-1.5 px-2.5 first:pl-0 last:pr-0'
      data-testid={`knowledge-stat-${props.label.toLowerCase()}`}
    >
      <dd className='font-semibold tabular-nums'>{props.value}</dd>
      <dt className='text-muted-foreground'>{props.label}</dt>
    </div>
  )
}

function KnowledgeDetails(props: {
  projectSessionId: string
  item: KnowledgeItem
  parsed: ParsedKnowledgeDocument | undefined
  parsedLoading: boolean
  busy: boolean
  embeddingInProgress: boolean
  onParse(): void
  onRefreshEmbeddings(): void
  onCancelParse(): void
  onOpen(): void
  onReveal(): void
  onDelete(): void
  onClose(): void
  onError(message: string): void
}): React.JSX.Element {
  const parseInProgress = isParseInProgress(props.parsed?.parseState)
  const normalizationInProgress =
    props.parsed?.parseState === 'succeeded' && props.parsed.normalizationState === 'staging'
  const hasActiveRevision = props.parsed?.active !== null && props.parsed?.active !== undefined
  return (
    <section className='flex h-[calc(100dvh-6.5rem)] max-h-full min-h-0 flex-col overflow-hidden'>
      <div className='grid gap-4 border-b py-5'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div className='flex min-w-0 items-start gap-3'>
            <div className='mt-0.5 rounded-lg bg-muted p-2'>
              <File className='size-5 text-muted-foreground' />
            </div>
            <div className='min-w-0'>
              <h2 className='truncate text-lg font-semibold'>{props.item.displayName}</h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                {props.item.extension?.toUpperCase() ?? 'FILE'} ·{' '}
                {formatBytes(props.item.byteSize ?? props.item.bytesCopied)}
                {props.item.mimeType ? ` · ${props.item.mimeType}` : ''}
              </p>
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='icon-sm' aria-label='More file actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem
                  data-testid='knowledge-reparse-file-action'
                  disabled={
                    props.busy ||
                    parseInProgress ||
                    normalizationInProgress ||
                    props.item.state !== 'stored'
                  }
                  onClick={props.onParse}
                >
                  {parseInProgress || normalizationInProgress ? (
                    <LoaderCircle className='animate-spin' />
                  ) : (
                    <RefreshCw />
                  )}
                  {parseInProgress || normalizationInProgress
                    ? 'Processing in progress'
                    : 'Reprocess with MinerU'}
                </DropdownMenuItem>
                {hasActiveRevision ? (
                  <DropdownMenuItem
                    data-testid='knowledge-reembed-file-action'
                    disabled={props.busy || props.embeddingInProgress}
                    onClick={props.onRefreshEmbeddings}
                  >
                    {props.embeddingInProgress ? (
                      <LoaderCircle className='animate-spin' />
                    ) : (
                      <Zap />
                    )}
                    {props.embeddingInProgress ? 'Embedding in progress' : 'Recalculate embeddings'}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={props.item.state !== 'stored'} onClick={props.onOpen}>
                  <FolderOpen /> Open file
                </DropdownMenuItem>
                <DropdownMenuItem disabled={props.item.state !== 'stored'} onClick={props.onReveal}>
                  <PanelLeft /> Show in Finder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className='text-destructive focus:text-destructive'
                  onClick={props.onDelete}
                >
                  <Trash2 /> Delete source
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Separator orientation='vertical' className='mx-1 data-[orientation=vertical]:h-5' />
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Close document'
              onClick={props.onClose}
            >
              <X />
            </Button>
          </div>
        </div>
        <div className='flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground'>
          <span>Added {new Date(props.item.createdAt).toLocaleString()}</span>
          {props.item.sha256 ? (
            <span className='max-w-full truncate'>SHA-256 {props.item.sha256.slice(0, 12)}…</span>
          ) : null}
          {props.item.errorCode ? (
            <span className='text-destructive'>{props.item.errorCode}</span>
          ) : null}
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {props.parsedLoading ? (
          <div className='flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground'>
            <LoaderCircle className='animate-spin' /> Loading parse status…
          </div>
        ) : hasActiveRevision ? (
          <ParsedDocumentViewer
            inline
            projectSessionId={props.projectSessionId}
            knowledgeItemId={props.item.knowledgeItemId}
            displayName={props.item.displayName}
            extension={props.item.extension}
            onOpenChange={() => undefined}
            onError={props.onError}
          />
        ) : (
          <div className='flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center'>
            {parseInProgress || normalizationInProgress ? (
              <LoaderCircle className='size-8 animate-spin text-primary' />
            ) : props.parsed?.parseState === 'failed' ? (
              <AlertCircle className='size-8 text-destructive' />
            ) : (
              <Circle className='size-8 text-muted-foreground' />
            )}
            <div>
              <p className='font-medium'>
                {parseInProgress
                  ? 'Parsing in progress'
                  : normalizationInProgress
                    ? 'Preparing parsed result'
                    : props.parsed?.parseState === 'failed'
                      ? 'Parsing failed'
                      : 'Not parsed yet'}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {parseInProgress
                  ? `Current stage: ${props.parsed?.parseState}`
                  : normalizationInProgress
                    ? 'The raw result is ready and is being normalized.'
                    : 'Run parsing to turn this source into searchable project knowledge.'}
              </p>
            </div>
            {parseInProgress ? (
              <Button variant='outline' onClick={props.onCancelParse} disabled={props.busy}>
                <X /> Stop parsing
              </Button>
            ) : normalizationInProgress ? null : (
              <Button
                onClick={props.onParse}
                disabled={props.busy || props.item.state !== 'stored'}
              >
                <Play /> {props.parsed?.parseState === 'failed' ? 'Retry parsing' : 'Start parsing'}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

type KnowledgeStats = {
  total: number
  stored: number
  parsed: number
  blocks: number
  queue: number
}

function getStats(
  items: KnowledgeItem[],
  parsedById: Map<string, ParsedKnowledgeDocument | undefined>,
  jobs: JobStatus[]
): KnowledgeStats {
  const parsed = items.filter((item) => parsedById.get(item.knowledgeItemId)?.active).length
  return {
    total: items.length,
    stored: items.filter((item) => item.state === 'stored').length,
    parsed,
    blocks: items.reduce(
      (total, item) => total + (parsedById.get(item.knowledgeItemId)?.active?.blocks.length ?? 0),
      0
    ),
    queue: jobs.filter((job) => job.state === 'queued' || job.state === 'running').length
  }
}

function isParseInProgress(state: string | null | undefined): boolean {
  return activeParseStates.has(state ?? '')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function jobLabel(type: JobStatus['type']): string {
  const labels: Partial<Record<JobStatus['type'], string>> = {
    mineru_parse: 'Parse with MinerU',
    normalize_parse_revision: 'Normalize parsed content',
    build_index_generation: 'Build search index',
    build_embedding_generation: 'Embedding generation',
    remove_index_item: 'Remove from index',
    rebuild_index: 'Rebuild search index',
    artifact_cleanup: 'Clean up artifacts'
  }
  return labels[type] ?? type
}
