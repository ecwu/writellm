import type {
  KnowledgeCitationCoverageFilter,
  KnowledgeCitationCoverageItem,
  KnowledgeCitationCoveragePageResult
} from '../../../../shared/contracts/knowledge'
import type { JobStatusEvent } from '../../../../shared/contracts/jobs'
import type { MutationSectionChanged } from '../../../../shared/contracts/agent-mutations'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, FileQuestion, RefreshCw, Search } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { WorkspaceRail } from '@/components/app-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { SidebarProvider } from '@/components/ui/sidebar'
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
import { useDesktopSubscription } from '@/hooks/use-desktop-subscription'

const PAGE_SIZE = 50
const indexJobTypes = new Set(['build_index_generation', 'remove_index_item', 'rebuild_index'])

export function KnowledgeCitationCoverageWorkspace(props: {
  projectSessionId: string
  projectName: string
  onOpenManuscript(): void
  onOpenPreview(): void
  onOpenKnowledge(): void
  onOpenNotebook?(): void
  onOpenAssets(): void
  onOpenReferences(): void
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

  useDesktopSubscription<MutationSectionChanged>(
    (listener) =>
      window.desktop.agent.subscribeSectionChanged(
        { projectSessionId: props.projectSessionId },
        listener
      ),
    () => resetCoverage(),
    {
      source: 'knowledge-citation-coverage.manuscript-subscription',
      dependencies: [props.projectSessionId, resetCoverage],
      onError: () => props.onError('Citation coverage could not watch manuscript changes.')
    }
  )
  useDesktopSubscription<JobStatusEvent>(
    (listener) =>
      window.desktop.jobs.subscribe({ projectSessionId: props.projectSessionId }, listener),
    ({ job }) => {
      if (
        indexJobTypes.has(job.type) &&
        (job.state === 'succeeded' || job.state === 'failed' || job.state === 'cancelled')
      ) {
        resetCoverage()
      }
    },
    {
      source: 'knowledge-citation-coverage.index-subscription',
      dependencies: [props.projectSessionId, resetCoverage],
      onError: () => props.onError('Citation coverage could not watch index changes.')
    }
  )

  const readyPages = coverage.data?.pages.filter(
    (page): page is Extract<KnowledgeCitationCoveragePageResult, { state: 'ready' }> =>
      page.state === 'ready'
  )
  const items = readyPages?.flatMap((page) => page.items) ?? []
  const ready = readyPages?.[0]

  return (
    <SidebarProvider data-testid='checks-workspace' className='min-h-0 flex-1'>
      <WorkspaceRail
        activeWorkspace='checks'
        onOpenPreview={props.onOpenPreview}
        onOpenChecks={() => undefined}
        onOpenKnowledge={props.onOpenKnowledge}
        onOpenNotebook={props.onOpenNotebook}
        onOpenAssets={props.onOpenAssets}
        onOpenManuscript={props.onOpenManuscript}
        onOpenReferences={props.onOpenReferences}
        onOpenWritingRules={props.onOpenWritingRules}
        onOpenFind={props.onOpenFind}
        onOpenSettings={props.onOpenSettings}
      />
      <main className='mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-6 overflow-auto p-5 md:p-8'>
        <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-start'>
          <div className='max-w-3xl'>
            <h1 className='text-2xl font-semibold tracking-tight'>Citation coverage</h1>
            <p className='mt-2 text-sm leading-6 text-muted-foreground'>
              Compare indexed sources with citations in the saved manuscript.
            </p>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant='ghost' size='sm' className='px-0'>
                  How matching works
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className='text-sm text-muted-foreground'>
                Project citekeys identify references. Older title citations match exact reference
                titles, with the original Knowledge filename as a fallback.
              </CollapsibleContent>
            </Collapsible>
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
                  placeholder='Search title, citekey, or file'
                  aria-label='Search title, citekey, or file'
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
              <div className='min-w-0'>
                <p className='break-words text-sm font-medium'>{itemTitle(item)}</p>
                {item.kind === 'source' ? <CoverageIdentity item={item} /> : null}
              </div>
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
      <TableCell>
        <div className='font-medium'>{itemTitle(props.item)}</div>
        {props.item.kind === 'source' ? <CoverageIdentity item={props.item} /> : null}
      </TableCell>
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
  if (props.item.kind === 'unmatched_citation') {
    return (
      <Badge variant='warning'>
        {props.item.citationKey === null ? 'Not indexed' : 'Unknown citekey'}
      </Badge>
    )
  }
  if (props.item.status === 'cited') return <Badge variant='success'>Cited</Badge>
  if (props.item.status === 'ambiguous') {
    return <Badge variant='warning'>Ambiguous legacy title</Badge>
  }
  return <Badge variant='secondary'>Uncited</Badge>
}

function CoverageIdentity(props: {
  item: Extract<KnowledgeCitationCoverageItem, { kind: 'source' }>
}): React.JSX.Element {
  return (
    <p className='mt-1 break-all text-xs text-muted-foreground'>
      {props.item.citationKey === null ? 'No Reference key' : `@${props.item.citationKey}`}
      {props.item.displayName === props.item.title ? '' : ` · ${props.item.displayName}`}
    </p>
  )
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
  return item.title
}

function itemKey(item: KnowledgeCitationCoverageItem): string {
  return item.kind === 'source'
    ? item.knowledgeItemId
    : `unmatched:${item.citationKey ?? item.title}`
}
