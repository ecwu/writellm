import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertCircle, Ban, CheckCircle2, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import type { KnowledgeItem } from '../../../../shared/contracts/knowledge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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
import {
  currentActivity,
  jobLabel,
  jobProgress,
  jobSubjectKey,
  jobSubjectLabel
} from './knowledge-sidebar-model'

export function KnowledgeActivity(props: {
  projectSessionId: string
  jobs: JobStatus[]
  items: KnowledgeItem[]
  unavailable: boolean
  loading: boolean
  onSelect(id: string): void
  onRefresh(): void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const [history, setHistory] = useState(false)
  const [filter, setFilter] = useState('all')
  const activity = currentActivity(props.jobs, props.items)
  const running = activity.filter((job) => job.state === 'running').length
  const queued = activity.filter((job) => job.state === 'queued').length
  const failed = activity.filter((job) => job.state === 'failed').length
  const groups = new Map<string, JobStatus[]>()
  for (const job of activity) {
    const key = jobSubjectKey(job)
    groups.set(key, [...(groups.get(key) ?? []), job])
  }
  const historyQuery = useInfiniteQuery({
    queryKey: ['knowledge-job-history', props.projectSessionId, filter],
    initialPageParam: undefined as { updatedAt: string; jobId: string } | undefined,
    queryFn: ({ pageParam }) =>
      window.desktop.jobs.list({
        projectSessionId: props.projectSessionId,
        limit: 50,
        cursor: pageParam,
        ...(filter === 'all' ? {} : { states: [filter as JobStatus['state']] })
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: history,
    retry: false
  })
  const historyJobs = [
    ...new Map(
      (historyQuery.data?.pages.flatMap((page) => page.jobs) ?? []).map((job) => [job.jobId, job])
    ).values()
  ]
  const openFile = (job: JobStatus): void => {
    if (job.subject.kind === 'file') {
      props.onSelect(job.subject.knowledgeItemId)
      setHistory(false)
    }
  }
  const subject = (job: JobStatus): React.JSX.Element => {
    const id = job.subject.kind === 'file' ? job.subject.knowledgeItemId : null
    return id !== null && props.items.some((item) => item.knowledgeItemId === id) ? (
      <Button
        variant='link'
        size='sm'
        className='h-auto min-w-0 justify-start p-0'
        onClick={() => openFile(job)}
      >
        <span className='truncate'>{jobSubjectLabel(job, props.items)}</span>
      </Button>
    ) : (
      <p className='truncate text-sm font-medium'>{jobSubjectLabel(job, props.items)}</p>
    )
  }
  return (
    <div className='shrink-0' data-testid='knowledge-activity'>
      <Separator />
      <Collapsible
        open={expanded ?? (activity.length > 0 || props.unavailable)}
        onOpenChange={setExpanded}
      >
        <CollapsibleTrigger asChild>
          <Button variant='ghost' className='h-auto w-full justify-between px-4 py-3'>
            <span className='grid min-w-0 gap-1 text-left'>
              <span>Background activity</span>
              <span className='whitespace-normal text-xs font-normal text-muted-foreground'>
                {props.unavailable
                  ? 'Activity unavailable'
                  : props.loading
                    ? 'Loading activity…'
                    : activity.length === 0
                      ? 'No active tasks'
                      : `${running} running · ${queued} queued · ${failed} needs attention`}
              </span>
            </span>
            <ChevronDown />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className='grid max-h-52 gap-4 overflow-y-auto px-4 pb-3'>
            {props.unavailable ? (
              <Button variant='outline' size='sm' onClick={props.onRefresh}>
                Retry loading activity
              </Button>
            ) : (
              [...groups.values()].map((jobs) => (
                <div key={jobSubjectKey(jobs[0])} className='grid min-w-0 gap-1'>
                  {subject(jobs[0])}
                  {jobs.map((job) => (
                    <TaskRow key={job.jobId} job={job} />
                  ))}
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <Button
        variant='ghost'
        size='sm'
        className='w-full justify-between px-4'
        onClick={() => setHistory(true)}
      >
        View activity history <ChevronRight />
      </Button>
      <Dialog open={history} onOpenChange={setHistory}>
        <DialogContent className='flex max-h-[80dvh] flex-col sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Activity history</DialogTitle>
            <DialogDescription>
              Background tasks in this project, newest updates first.
            </DialogDescription>
          </DialogHeader>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger aria-label='Filter activity history'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {['all', 'running', 'queued', 'succeeded', 'failed', 'cancelled'].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === 'all'
                      ? 'All tasks'
                      : value === 'succeeded'
                        ? 'Completed'
                        : value[0].toUpperCase() + value.slice(1)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className='grid min-h-0 gap-4 overflow-y-auto' aria-live='polite'>
            {historyQuery.isPending ? <p>Loading history…</p> : null}
            {historyQuery.isError ? (
              <div>
                <p>Activity history could not be loaded.</p>
                <Button variant='outline' onClick={() => void historyQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : null}
            {!historyQuery.isPending && !historyQuery.isError && historyJobs.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No matching tasks.</p>
            ) : null}
            {historyJobs.map((job) => (
              <div key={job.jobId} className='grid gap-1 border-b pb-3'>
                {subject(job)}
                <TaskRow job={job} />
                <p className='text-xs text-muted-foreground'>
                  {new Date(job.updatedAt).toLocaleString()}
                </p>
                {job.state === 'failed' && job.error ? (
                  <p className='text-sm text-destructive'>{job.error.message}</p>
                ) : null}
              </div>
            ))}
            {historyQuery.hasNextPage ? (
              <Button
                variant='outline'
                disabled={historyQuery.isFetchingNextPage}
                onClick={() => void historyQuery.fetchNextPage()}
              >
                Load more
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function TaskRow({ job }: { job: JobStatus }): React.JSX.Element {
  const Icon =
    job.state === 'running'
      ? Spinner
      : job.state === 'queued'
        ? Clock
        : job.state === 'failed'
          ? AlertCircle
          : job.state === 'cancelled'
            ? Ban
            : CheckCircle2
  return (
    <div className='flex items-start gap-2 text-xs' data-job-id={job.jobId}>
      <Icon
        className={
          job.state === 'failed'
            ? 'mt-0.5 size-3.5 shrink-0 text-destructive'
            : 'mt-0.5 size-3.5 shrink-0 text-muted-foreground'
        }
      />
      <span className='min-w-0 flex-1'>{jobLabel(job.type)}</span>
      <span className='shrink-0 text-muted-foreground'>{jobProgress(job)}</span>
    </div>
  )
}
