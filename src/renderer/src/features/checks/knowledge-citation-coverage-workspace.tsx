import type {
  KnowledgeCitationCoverageFilter,
  KnowledgeCitationCoverageItem,
  KnowledgeCitationCoveragePageResult
} from '../../../../shared/contracts/knowledge'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, FileQuestion, ListChecks, RefreshCw, Search } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { WorkspaceRail } from '@/components/app-sidebar'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const PAGE_SIZE = 50
const indexJobTypes = new Set(['build_index_generation', 'remove_index_item', 'rebuild_index'])

export function KnowledgeCitationCoverageWorkspace(props: {
  projectSessionId: string
  projectName: string
  onOpenManuscript(): void
  onOpenKnowledge(): void
  onOpenAssets(): void
  onOpenReferences(): void
  onOpenIssues(): void
  onOpenWritingRules(): void
  onOpenFind(): void
  onOpenSettings(): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<KnowledgeCitationCoverageFilter>('all')
  const [query, setQuery] = useState('')
  const [staleReloading, setStaleReloading] = useState(false)
  const deferredQuery = useDeferredValue(query.trim())
  const queryKey = useMemo(
    () => ['knowledge-citation-coverage', props.projectSessionId, filter, deferredQuery] as const,
    [deferredQuery, filter, props.projectSessionId]
  )
  const coverage = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      window.desktop.knowledge.citationCoveragePage({
        projectSessionId: props.projectSessionId,
        filter,
        query: deferredQuery,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
        limit: PAGE_SIZE
      }),
    getNextPageParam: (page) =>
      page.state === 'ready' ? (page.nextCursor ?? undefined) : undefined,
    refetchInterval: ({ state }) => (state.data?.pages[0]?.state === 'preparing' ? 1_000 : false)
  })
  const resetCoverage = useCallback(() => {
    void queryClient.resetQueries({
      queryKey: ['knowledge-citation-coverage', props.projectSessionId]
    })
  }, [props.projectSessionId, queryClient])

  useEffect(() => {
    resetCoverage()
  }, [resetCoverage])

  useEffect(() => {
    if (!coverage.data?.pages.some((page) => page.state === 'stale')) return
    setStaleReloading(true)
    resetCoverage()
  }, [coverage.data?.pages, resetCoverage])

  const firstPage = coverage.data?.pages[0]
  useEffect(() => {
    if (firstPage?.state === 'ready') setStaleReloading(false)
  }, [firstPage])

  useEffect(() => {
    let disposed = false
    const unsubscribe: Array<() => void> = []
    const retain = (release: () => void): void => {
      if (disposed) release()
      else unsubscribe.push(release)
    }
    void window.desktop.agent
      .subscribeSectionChanged({ projectSessionId: props.projectSessionId }, resetCoverage)
      .then(retain)
      .catch(() => props.onError('Citation coverage could not watch manuscript changes.'))
    void window.desktop.jobs
      .subscribe({ projectSessionId: props.projectSessionId }, ({ job }) => {
        if (
          indexJobTypes.has(job.type) &&
          (job.state === 'succeeded' || job.state === 'failed' || job.state === 'cancelled')
        ) {
          resetCoverage()
        }
      })
      .then(retain)
      .catch(() => props.onError('Citation coverage could not watch index changes.'))
    return () => {
      disposed = true
      for (const release of unsubscribe) release()
    }
  }, [props.onError, props.projectSessionId, resetCoverage])

  const readyPages = coverage.data?.pages.filter(
    (page): page is Extract<KnowledgeCitationCoveragePageResult, { state: 'ready' }> =>
      page.state === 'ready'
  )
  const items = readyPages?.flatMap((page) => page.items) ?? []
  const ready = readyPages?.[0]

  return (
    <SidebarProvider
      data-testid='checks-workspace'
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '280px' } as React.CSSProperties}
    >
      <Sidebar
        collapsible='icon'
        className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      >
        <WorkspaceRail
          activeWorkspace='checks'
          onOpenChecks={() => undefined}
          onOpenKnowledge={props.onOpenKnowledge}
          onOpenAssets={props.onOpenAssets}
          onOpenManuscript={props.onOpenManuscript}
          onOpenReferences={props.onOpenReferences}
          onOpenIssues={props.onOpenIssues}
          onOpenWritingRules={props.onOpenWritingRules}
          onOpenFind={props.onOpenFind}
          onOpenSettings={props.onOpenSettings}
        />
        <Sidebar collapsible='none' className='min-w-0 flex-1 overflow-hidden'>
          <SidebarHeader className='border-b p-4'>
            <div className='flex items-center gap-2'>
              <ListChecks className='size-4' aria-hidden='true' />
              <span className='font-medium'>Checks</span>
            </div>
            <p className='text-xs text-muted-foreground'>Read-only manuscript audits</p>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Knowledge</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive aria-current='page'>
                      <ListChecks />
                      <span>Citation coverage</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </Sidebar>

      <SidebarInset className='min-h-0 overflow-auto'>
        <header className='sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background p-4'>
          <SidebarTrigger className='-ml-1' />
          <Separator orientation='vertical' className='mr-2 data-[orientation=vertical]:h-4' />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className='max-w-48 truncate'>{props.projectName}</BreadcrumbItem>
              <BreadcrumbItem>
                <BreadcrumbPage>Citation coverage</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>

        <main className='mx-auto flex w-full max-w-6xl flex-col gap-8 p-5 md:p-8'>
          <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-start'>
            <div className='max-w-3xl'>
              <h1 className='text-2xl font-semibold tracking-tight'>Knowledge citation coverage</h1>
              <p className='mt-2 text-sm leading-6 text-muted-foreground'>
                Shows which articles in the current text index are cited by the saved manuscript.
                Titles match exactly after Unicode normalization and trimming; page numbers do not
                affect article matching.
              </p>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={resetCoverage}
              disabled={coverage.isFetching}
            >
              {coverage.isFetching ? <Spinner /> : <RefreshCw />}
              Refresh
            </Button>
          </div>

          {coverage.isPending ? (
            <CoverageSkeleton />
          ) : coverage.isError ? (
            <CoverageEmpty
              icon={<AlertCircle />}
              title='Coverage could not be loaded'
              description='Retry the check. Your manuscript and Knowledge sources were not changed.'
              action={<Button onClick={() => void coverage.refetch()}>Retry</Button>}
            />
          ) : firstPage?.state === 'preparing' ? (
            <CoverageEmpty
              icon={<Spinner />}
              title='Knowledge index is preparing'
              description='Coverage will appear when the latest source collection becomes active.'
            />
          ) : firstPage?.state === 'unavailable' ? (
            <CoverageEmpty
              icon={<AlertCircle />}
              title='Knowledge index is unavailable'
              description='Retry after the index utility becomes available. An older generation is never shown here.'
              action={<Button onClick={resetCoverage}>Retry</Button>}
            />
          ) : ready === undefined ? (
            <CoverageSkeleton />
          ) : (
            <>
              <CoverageSummary page={ready} />

              {staleReloading ? (
                <div role='status' className='flex items-center gap-2 border-y py-3 text-sm'>
                  <Spinner />
                  The manuscript or index changed. Reloading the first page…
                </div>
              ) : null}

              {ready.summary.indexedSourceCount === 0 ? (
                <div className='border-y py-4 text-sm'>
                  <p className='font-medium'>No indexed Knowledge articles</p>
                  <p className='mt-1 text-muted-foreground'>
                    Coverage is not computable until a current text index contains at least one
                    article. Unmatched manuscript citations remain available under Needs attention.
                  </p>
                </div>
              ) : null}

              {ready.summary.citedSourceCount === 0 &&
              ready.summary.unmatchedCitationOccurrenceCount === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  No canonical Knowledge citations are present in the saved manuscript.
                </p>
              ) : null}

              <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
                <ToggleGroup
                  type='single'
                  variant='outline'
                  value={filter}
                  onValueChange={(value) => {
                    if (value !== '') setFilter(value as KnowledgeCitationCoverageFilter)
                  }}
                  aria-label='Coverage filter'
                  className='max-w-full overflow-x-auto'
                >
                  <ToggleGroupItem value='all'>All</ToggleGroupItem>
                  <ToggleGroupItem value='cited'>Cited</ToggleGroupItem>
                  <ToggleGroupItem value='uncited'>Uncited</ToggleGroupItem>
                  <ToggleGroupItem value='attention'>Needs attention</ToggleGroupItem>
                </ToggleGroup>
                <div className='relative w-full lg:max-w-xs'>
                  <Search
                    className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
                    aria-hidden='true'
                  />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder='Search article titles'
                    aria-label='Search article titles'
                    className='pl-9'
                  />
                </div>
              </div>

              {items.length === 0 ? (
                <CoverageEmpty
                  icon={<FileQuestion />}
                  title='No results for this view'
                  description='Change the filter or title search to see other coverage entries.'
                />
              ) : (
                <CoverageLedger items={items} />
              )}

              <div className='flex items-center justify-between gap-4 border-t pt-4 text-sm text-muted-foreground'>
                <span>
                  Showing {items.length} of {ready.filteredTotal}
                </span>
                {coverage.hasNextPage ? (
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={coverage.isFetchingNextPage}
                    onClick={() => void coverage.fetchNextPage()}
                  >
                    {coverage.isFetchingNextPage ? <Spinner /> : null}
                    Load more
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function CoverageSummary(props: {
  page: Extract<KnowledgeCitationCoveragePageResult, { state: 'ready' }>
}): React.JSX.Element {
  const { summary } = props.page
  const percentage = summary.coverageRatio === null ? null : Math.round(summary.coverageRatio * 100)
  const metrics = [
    ['Coverage', percentage === null ? '—' : `${percentage}%`],
    ['Indexed', summary.indexedSourceCount],
    ['Cited', summary.citedSourceCount],
    ['Uncited', summary.uncitedSourceCount],
    ['Needs attention', summary.attentionCount]
  ] as const
  return (
    <section aria-label='Coverage summary' className='space-y-4'>
      <dl className='grid grid-cols-2 divide-x divide-y border-y sm:grid-cols-5 sm:divide-y-0'>
        {metrics.map(([label, value]) => (
          <div key={label} className='px-4 py-3 first:pl-0 sm:first:pl-4'>
            <dt className='text-xs text-muted-foreground'>{label}</dt>
            <dd className='mt-1 text-lg font-semibold tabular-nums'>{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className='mb-2 flex items-center justify-between text-xs text-muted-foreground'>
          <span>Uniquely cited indexed articles</span>
          <span className='tabular-nums'>
            {percentage === null ? 'Not computable' : `${percentage}%`}
          </span>
        </div>
        <Progress value={percentage ?? 0} aria-label='Citation coverage' />
      </div>
    </section>
  )
}

function CoverageLedger(props: { items: KnowledgeCitationCoverageItem[] }): React.JSX.Element {
  return (
    <section aria-label='Citation coverage entries'>
      <div className='hidden md:block'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Article</TableHead>
              <TableHead className='w-28'>Type</TableHead>
              <TableHead className='w-40'>Status</TableHead>
              <TableHead className='w-28 text-right'>Citations</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.items.map((item) => (
              <CoverageTableRow key={itemKey(item)} item={item} />
            ))}
          </TableBody>
        </Table>
      </div>
      <div className='divide-y border-y md:hidden'>
        {props.items.map((item) => (
          <div key={itemKey(item)} className='space-y-2 py-4'>
            <div className='flex items-start justify-between gap-3'>
              <p className='min-w-0 break-words text-sm font-medium'>{itemTitle(item)}</p>
              <CoverageBadge item={item} />
            </div>
            <div className='flex items-center justify-between text-xs text-muted-foreground'>
              <span>
                {item.kind === 'source' ? item.extension?.toUpperCase() || 'Unknown' : 'Citation'}
              </span>
              <span className='tabular-nums'>
                {item.citationCount} {item.citationCount === 1 ? 'citation' : 'citations'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CoverageTableRow(props: { item: KnowledgeCitationCoverageItem }): React.JSX.Element {
  return (
    <TableRow>
      <TableCell className='font-medium'>{itemTitle(props.item)}</TableCell>
      <TableCell className='text-muted-foreground'>
        {props.item.kind === 'source'
          ? props.item.extension?.toUpperCase() || 'Unknown'
          : 'Citation'}
      </TableCell>
      <TableCell>
        <CoverageBadge item={props.item} />
      </TableCell>
      <TableCell className='text-right tabular-nums'>{props.item.citationCount}</TableCell>
    </TableRow>
  )
}

function CoverageBadge(props: { item: KnowledgeCitationCoverageItem }): React.JSX.Element {
  if (props.item.kind === 'unmatched_citation') return <Badge variant='warning'>Not indexed</Badge>
  if (props.item.status === 'cited') return <Badge variant='success'>Cited</Badge>
  if (props.item.status === 'ambiguous') return <Badge variant='warning'>Ambiguous title</Badge>
  return <Badge variant='secondary'>Uncited</Badge>
}

function CoverageEmpty(props: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <Empty className='min-h-72 border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>{props.icon}</EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
      {props.action}
    </Empty>
  )
}

function CoverageSkeleton(): React.JSX.Element {
  const metricSkeletons = ['coverage', 'indexed', 'cited', 'uncited', 'attention']
  const rowSkeletons = ['one', 'two', 'three', 'four', 'five', 'six']
  return (
    <div role='status' aria-label='Loading citation coverage' className='space-y-8'>
      <div className='grid grid-cols-2 gap-4 sm:grid-cols-5'>
        {metricSkeletons.map((key) => (
          <div key={key} className='space-y-2 py-3'>
            <Skeleton className='h-3 w-20' />
            <Skeleton className='h-7 w-14' />
          </div>
        ))}
      </div>
      <Skeleton className='h-2 w-full' />
      <div className='space-y-3'>
        {rowSkeletons.map((key) => (
          <Skeleton key={key} className='h-11 w-full' />
        ))}
      </div>
    </div>
  )
}

function itemTitle(item: KnowledgeCitationCoverageItem): string {
  return item.kind === 'source' ? item.displayName : item.title
}

function itemKey(item: KnowledgeCitationCoverageItem): string {
  return item.kind === 'source' ? item.knowledgeItemId : `unmatched:${item.title}`
}
