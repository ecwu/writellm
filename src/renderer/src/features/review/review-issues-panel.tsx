import type {
  ReviewIssueCategory,
  ReviewIssueRecord,
  ReviewIssueStatus,
  ReviewPriority
} from '../../../../shared/contracts/review'
import type { ManuscriptWorkspace } from '../../../../shared/contracts/manuscript'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, CornerUpLeft, Unlink, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'

const statuses: ReviewIssueStatus[] = ['open', 'in_progress', 'resolved', 'dismissed']
const priorities: ReviewPriority[] = ['P0', 'P1', 'P2', 'P3']
const categories: ReviewIssueCategory[] = [
  'integrity',
  'structure',
  'citation',
  'evidence',
  'consistency',
  'terminology',
  'translation',
  'audience',
  'style',
  'objective',
  'other'
]

export function ReviewIssuesPanel(props: {
  projectSessionId: string
  workspace: ManuscriptWorkspace | undefined
  onNavigate(issue: ReviewIssueRecord): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ReviewIssueStatus | 'all'>('all')
  const [priority, setPriority] = useState<ReviewPriority | 'all'>('all')
  const [category, setCategory] = useState<ReviewIssueCategory | 'all'>('all')
  const [sectionId, setSectionId] = useState<string | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const key = [
    'review-issues',
    props.projectSessionId,
    status,
    priority,
    category,
    sectionId
  ] as const
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      window.desktop.review.listIssues({
        projectSessionId: props.projectSessionId,
        statuses: status === 'all' ? [] : [status],
        priorities: priority === 'all' ? [] : [priority],
        categories: category === 'all' ? [] : [category],
        sectionId: sectionId === 'all' ? undefined : sectionId,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
        limit: 100
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined
  })
  const issues = useMemo(
    () => query.data?.pages.flatMap((page) => page.issues) ?? [],
    [query.data?.pages]
  )
  const total = query.data?.pages[0]?.total ?? 0
  const selected = issues.find((issue) => issue.issueId === selectedId) ?? null
  const events = useQuery({
    queryKey: ['review-issue-events', props.projectSessionId, selectedId],
    queryFn: () =>
      window.desktop.review.issueEvents({
        projectSessionId: props.projectSessionId,
        issueId: selectedId as string
      }),
    enabled: selectedId !== null
  })
  useEffect(() => {
    if (selectedId !== null && !issues.some((issue) => issue.issueId === selectedId)) {
      setSelectedId(null)
    }
  }, [issues, selectedId])
  const update = useMutation({
    mutationFn: (operation: Parameters<typeof window.desktop.review.updateIssue>[0]['operation']) =>
      window.desktop.review.updateIssue({ projectSessionId: props.projectSessionId, operation }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review-issues', props.projectSessionId] }),
        queryClient.invalidateQueries({ queryKey: ['review-issue-events', props.projectSessionId] })
      ])
    },
    onError: () => props.onError('The issue changed elsewhere. Refresh the Problem Set and retry.')
  })
  const act = (issue: ReviewIssueRecord, action: 'dismiss' | 'reopen' | 'release'): void => {
    update.mutate(
      action === 'dismiss'
        ? {
            action,
            issueId: issue.issueId,
            expectedVersion: issue.version,
            reason: 'Dismissed by the writer.'
          }
        : { action, issueId: issue.issueId, expectedVersion: issue.version }
    )
  }

  return (
    <div
      className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
      data-testid='review-issues-panel'
    >
      <div className='grid grid-cols-2 gap-2 border-b p-3'>
        <Filter
          value={priority}
          label='Priority'
          values={priorities}
          onChange={(value) => setPriority(value as ReviewPriority | 'all')}
        />
        <Filter
          value={status}
          label='Status'
          values={statuses}
          onChange={(value) => setStatus(value as ReviewIssueStatus | 'all')}
        />
        <Filter
          value={category}
          label='Category'
          values={categories}
          onChange={(value) => setCategory(value as ReviewIssueCategory | 'all')}
        />
        <Select value={sectionId} onValueChange={setSectionId}>
          <SelectTrigger size='sm' aria-label='Section'>
            <SelectValue placeholder='Section' />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value='all'>All sections</SelectItem>
              {props.workspace?.sections.map((entry) => (
                <SelectItem key={entry.section.sectionId} value={entry.section.sectionId}>
                  {entry.section.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <ScrollArea className='min-h-0 flex-1'>
        {query.isPending ? (
          <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground' role='status'>
            <Spinner />
            Loading issues…
          </div>
        ) : null}
        {query.isError ? (
          <Alert variant='destructive' className='m-3 w-auto'>
            <AlertTriangle />
            <AlertTitle>Issues could not be loaded</AlertTitle>
            <AlertDescription>
              <p>The current filters are still preserved.</p>
              <Button size='sm' variant='outline' onClick={() => void query.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!query.isPending && !query.isError && issues.length === 0 ? (
          <Empty className='border-0 p-5'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Check />
              </EmptyMedia>
              <EmptyTitle className='text-sm'>No matching issues</EmptyTitle>
              <EmptyDescription>
                Review issues recorded by the Agent will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <ItemGroup className='gap-1 p-2'>
          {issues.map((issue) => (
            <Item
              key={issue.issueId}
              size='sm'
              variant={selectedId === issue.issueId ? 'muted' : 'default'}
              asChild
            >
              <button
                type='button'
                className='w-full text-left'
                onClick={() => setSelectedId(issue.issueId)}
              >
                <Badge variant={priorityVariant(issue.priority)}>{issue.priority}</Badge>
                <ItemContent className='min-w-0'>
                  <ItemTitle className='line-clamp-2'>{issue.title}</ItemTitle>
                  <ItemDescription>
                    {issue.status.replace('_', ' ')} · {issue.category}
                  </ItemDescription>
                </ItemContent>
                {issue.anchorStatus === 'orphaned' ? (
                  <AlertTriangle className='size-4 text-warning' aria-label='Orphaned location' />
                ) : null}
              </button>
            </Item>
          ))}
        </ItemGroup>
        {query.hasNextPage ? (
          <div className='flex justify-center px-3 pb-3'>
            <Button
              size='sm'
              variant='outline'
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? <Spinner data-icon='inline-start' /> : null}
              {query.isFetchingNextPage ? 'Loading…' : `Load more (${issues.length} of ${total})`}
            </Button>
          </div>
        ) : null}
        {selected !== null ? (
          <>
            <Separator />
            <section className='flex flex-col gap-3 p-4' aria-label='Issue details'>
              <div className='flex items-start gap-2'>
                <div className='min-w-0 flex-1'>
                  <h3 className='font-medium leading-snug'>{selected.title}</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Issue {selected.issueId.slice(0, 8)} · version {selected.version}
                  </p>
                </div>
                <Select
                  value={selected.priority}
                  disabled={update.isPending}
                  onValueChange={(value) =>
                    update.mutate({
                      action: 'setPriority',
                      issueId: selected.issueId,
                      expectedVersion: selected.version,
                      priority: value as ReviewPriority
                    })
                  }
                >
                  <SelectTrigger size='sm' className='w-20' aria-label='Issue priority'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {priorities.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <p className='text-sm leading-6'>{selected.description}</p>
              {selected.evidence ? (
                <Alert>
                  <AlertTitle>Evidence</AlertTitle>
                  <AlertDescription className='wrap-break-word'>
                    {selected.evidence}
                  </AlertDescription>
                </Alert>
              ) : null}
              <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
                <dt className='text-muted-foreground'>Location</dt>
                <dd>
                  {selected.anchor === null
                    ? 'Manuscript'
                    : selected.anchorStatus === 'orphaned'
                      ? 'Orphaned'
                      : `Section ${selected.anchor.sectionId.slice(0, 8)}`}
                </dd>
                <dt className='text-muted-foreground'>Source</dt>
                <dd>
                  {selected.sourceAgentSessionId === null
                    ? 'Unknown'
                    : `Conversation ${selected.sourceAgentSessionId.slice(0, 8)}`}
                </dd>
                <dt className='text-muted-foreground'>Proposal</dt>
                <dd>{selected.resolvedByProposalId?.slice(0, 8) ?? 'None'}</dd>
              </dl>
              <div className='flex flex-wrap gap-2'>
                {selected.anchor !== null && selected.anchorStatus === 'current' ? (
                  <Button size='sm' variant='outline' onClick={() => props.onNavigate(selected)}>
                    Go to location
                  </Button>
                ) : null}
                {selected.status === 'dismissed' || selected.status === 'resolved' ? (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={update.isPending}
                    onClick={() => act(selected, 'reopen')}
                  >
                    <CornerUpLeft data-icon='inline-start' /> Reopen
                  </Button>
                ) : null}
                {selected.status === 'in_progress' ? (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={update.isPending}
                    onClick={() => act(selected, 'release')}
                  >
                    <Unlink data-icon='inline-start' /> Release
                  </Button>
                ) : null}
                {selected.status === 'open' || selected.status === 'in_progress' ? (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={update.isPending}
                    onClick={() => act(selected, 'dismiss')}
                  >
                    <X data-icon='inline-start' /> Dismiss
                  </Button>
                ) : null}
              </div>
              <div>
                <h4 className='text-xs font-medium'>History</h4>
                <ol className='mt-2 flex flex-col gap-1 text-xs text-muted-foreground'>
                  {events.data?.map((event) => (
                    <li key={event.eventId}>
                      {event.eventType.replace('_', ' ')} ·{' '}
                      {new Date(event.occurredAt).toLocaleString()}
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </>
        ) : null}
      </ScrollArea>
    </div>
  )
}

function Filter(props: {
  value: string
  label: string
  values: readonly string[]
  onChange(value: string): void
}): React.JSX.Element {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger size='sm' aria-label={props.label}>
        <SelectValue placeholder={props.label} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value='all'>All</SelectItem>
          {props.values.map((value) => (
            <SelectItem key={value} value={value}>
              {value.replace('_', ' ')}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function priorityVariant(
  priority: ReviewPriority
): 'destructive' | 'warning' | 'secondary' | 'outline' {
  if (priority === 'P0') return 'destructive'
  if (priority === 'P1') return 'warning'
  if (priority === 'P2') return 'secondary'
  return 'outline'
}
