import type { KnowledgeItem, ParsedKnowledgeDocument } from '../../../../shared/contracts/knowledge'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock3,
  File,
  FileCheck2,
  FileUp,
  FolderOpen,
  LibraryBig,
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
  lifecycleState: string
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
          <Badge className='ml-auto' variant='secondary'>
            {props.lifecycleState}
          </Badge>
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
              onParse={() => void parseSelected()}
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
              stats={stats}
              jobs={jobs}
              items={items}
              busy={busy}
              projectSessionId={props.projectSessionId}
              onImport={importFiles}
              onError={props.onError}
            />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function KnowledgeOverview(props: {
  stats: KnowledgeStats
  jobs: JobStatus[]
  items: KnowledgeItem[]
  busy: boolean
  projectSessionId: string
  onImport(): void
  onError(message: string): void
}): React.JSX.Element {
  return (
    <>
      <section
        className='flex min-h-[calc(100dvh-6.5rem)] flex-1 items-center justify-center py-12'
        aria-labelledby='knowledge-overview-title'
      >
        <div className='w-full max-w-4xl'>
          <div className='flex flex-col items-center text-center'>
            <LibraryBig className='size-6 text-primary' />
            <h1
              id='knowledge-overview-title'
              className='mt-3 text-2xl font-semibold tracking-tight'
            >
              Knowledge base
            </h1>
            <p className='mt-1 max-w-xl text-sm text-muted-foreground'>
              Your project sources, parsed content, and search index in one place.
            </p>
            <Button
              className='mt-5'
              data-testid='knowledge-upload-button'
              onClick={props.onImport}
              disabled={props.busy}
            >
              {props.busy ? <LoaderCircle className='animate-spin' /> : <FileUp />}
              Upload files
            </Button>
          </div>
          <div className='mt-8'>
            <StatusOverview stats={props.stats} jobs={props.jobs} />
          </div>
          {props.items.length === 0 ? (
            <p className='mt-8 text-center text-sm text-muted-foreground'>
              Upload a PDF, document, slide deck, or image to get started.
            </p>
          ) : null}
        </div>
      </section>
      {props.items.length > 0 ? (
        <section className='border-t py-10' aria-labelledby='knowledge-search-title'>
          <div className='mx-auto max-w-2xl'>
            <div className='mb-4 text-center'>
              <h2
                id='knowledge-search-title'
                className='flex items-center justify-center gap-2 text-sm font-semibold'
              >
                <Search className='size-4' /> Search knowledge
              </h2>
              <p className='mt-1 text-xs text-muted-foreground'>
                Find passages across every parsed source in this project.
              </p>
            </div>
            <KnowledgeSearch
              projectSessionId={props.projectSessionId}
              items={props.items}
              onError={props.onError}
            />
          </div>
        </section>
      ) : null}
    </>
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

function StatusOverview(props: { stats: KnowledgeStats; jobs: JobStatus[] }): React.JSX.Element {
  const activeJobs = props.jobs.filter(
    (job) => job.state === 'queued' || job.state === 'running'
  ).length
  return (
    <section className='flex overflow-x-auto border-y' aria-label='Knowledge status'>
      <StatusMetric
        label='Files'
        value={props.stats.total}
        hint={`${props.stats.stored} stored`}
        icon={<File />}
      />
      <StatusMetric
        label='Parsed'
        value={props.stats.parsed}
        hint={`${props.stats.parsing} in progress`}
        icon={<FileCheck2 />}
      />
      <StatusMetric
        label='Embeddings'
        value={props.stats.embeddingsSucceeded}
        hint={`${props.stats.embeddingsPending} queued or running`}
        icon={<Zap />}
      />
      <StatusMetric
        label='Failed'
        value={props.stats.failed}
        hint='Needs attention'
        icon={<AlertCircle />}
        danger={props.stats.failed > 0}
      />
      <StatusMetric
        label='Queue'
        value={activeJobs}
        hint={activeJobs === 0 ? 'Up to date' : 'Active tasks'}
        icon={<Clock3 />}
      />
    </section>
  )
}

function StatusMetric(props: {
  label: string
  value: number
  hint: string
  icon: React.ReactNode
  danger?: boolean
}): React.JSX.Element {
  return (
    <div className='flex min-w-40 flex-1 items-center gap-3 border-r px-4 py-3 last:border-r-0'>
      <div
        className={`[&_svg]:size-4 ${props.danger ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {props.icon}
      </div>
      <div className='min-w-0'>
        <div className='flex items-baseline gap-2'>
          <span className='text-lg font-semibold tabular-nums'>{props.value}</span>
          <span className='text-xs font-medium text-muted-foreground'>{props.label}</span>
        </div>
        <p
          className={`truncate text-[11px] ${props.danger ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {props.hint}
        </p>
      </div>
    </div>
  )
}

function KnowledgeDetails(props: {
  projectSessionId: string
  item: KnowledgeItem
  parsed: ParsedKnowledgeDocument | undefined
  parsedLoading: boolean
  busy: boolean
  onParse(): void
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
            <Badge variant={props.item.state === 'failed' ? 'destructive' : 'secondary'}>
              {props.item.state}
            </Badge>
            {props.parsed?.active ? <Badge variant='outline'>Parsed</Badge> : null}
            <Button
              variant='outline'
              size='sm'
              disabled={props.busy || props.item.state !== 'stored'}
              onClick={props.onParse}
            >
              {parseInProgress ? <LoaderCircle className='animate-spin' /> : <RefreshCw />}
              {parseInProgress ? 'Parsing…' : 'Reparse'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='icon-sm' aria-label='More file actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
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
  parsing: number
  failed: number
  embeddingsSucceeded: number
  embeddingsPending: number
}

function getStats(
  items: KnowledgeItem[],
  parsedById: Map<string, ParsedKnowledgeDocument | undefined>,
  jobs: JobStatus[]
): KnowledgeStats {
  const parsed = items.filter((item) => parsedById.get(item.knowledgeItemId)?.active).length
  const parsing = items.filter((item) =>
    isParseInProgress(parsedById.get(item.knowledgeItemId)?.parseState)
  ).length
  const failed = items.filter(
    (item) =>
      item.state === 'failed' ||
      parsedById.get(item.knowledgeItemId)?.parseState === 'failed' ||
      parsedById.get(item.knowledgeItemId)?.normalizationState === 'failed'
  ).length
  const embeddings = jobs.filter((job) => job.type === 'embedding.batch')
  return {
    total: items.length,
    stored: items.filter((item) => item.state === 'stored').length,
    parsed,
    parsing,
    failed,
    embeddingsSucceeded: embeddings.filter((job) => job.state === 'succeeded').length,
    embeddingsPending: embeddings.filter((job) => job.state === 'queued' || job.state === 'running')
      .length
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
    'embedding.batch': 'Embedding generation',
    'index.build': 'Index build',
    'index.item-delete': 'Remove from index',
    'index.item-upsert': 'Update search index',
    'index.publish': 'Publish search index',
    'index.rebuild': 'Rebuild search index',
    'mineru.download': 'Download parse result',
    'mineru.normalize': 'Normalize parsed content',
    'mineru.poll': 'Check parser status',
    'mineru.submit': 'Submit to parser',
    'import.validate': 'Validate import',
    'rerank.request': 'Rerank search results'
  }
  return labels[type] ?? type
}
