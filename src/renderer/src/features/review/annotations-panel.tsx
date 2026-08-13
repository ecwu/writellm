import type {
  AnnotationKind,
  AnnotationRecord,
  AnnotationStatus
} from '../../../../shared/contracts/annotations'
import type { ManuscriptWorkspace } from '../../../../shared/contracts/manuscript'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Circle,
  MessageSquareText,
  Navigation,
  Send,
  SquareCheckBig
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

export function AnnotationsPanel(props: {
  projectSessionId: string
  workspace: ManuscriptWorkspace | undefined
  onNavigate(annotation: AnnotationRecord): void
  onIncludeAgent(annotations: AnnotationRecord[]): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AnnotationStatus | 'all'>('open')
  const [kind, setKind] = useState<AnnotationKind | 'all'>('all')
  const [sectionId, setSectionId] = useState<string | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agentSelection, setAgentSelection] = useState<Set<string>>(new Set())
  const key = ['annotations', props.projectSessionId, status, kind, sectionId] as const
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      window.desktop.annotations.list({
        projectSessionId: props.projectSessionId,
        statuses: status === 'all' ? [] : [status],
        kinds: kind === 'all' ? [] : [kind],
        ...(sectionId === 'all' ? {} : { sectionId }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
        limit: 100
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined
  })
  const annotations = useMemo(
    () => query.data?.pages.flatMap((page) => page.annotations) ?? [],
    [query.data?.pages]
  )
  const selected = annotations.find((annotation) => annotation.annotationId === selectedId) ?? null
  useEffect(() => {
    setAgentSelection(
      (current) =>
        new Set(
          [...current].filter((id) =>
            annotations.some((annotation) => annotation.annotationId === id)
          )
        )
    )
    if (
      selectedId !== null &&
      !annotations.some((annotation) => annotation.annotationId === selectedId)
    ) {
      setSelectedId(null)
    }
  }, [annotations, selectedId])
  const update = useMutation({
    mutationFn: (operation: Parameters<typeof window.desktop.annotations.update>[0]['operation']) =>
      window.desktop.annotations.update({ projectSessionId: props.projectSessionId, operation }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['annotations', props.projectSessionId] }),
    onError: () => props.onError('The annotation changed elsewhere. Refresh and retry.')
  })

  return (
    <div
      className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
      data-testid='annotations-panel'
    >
      <div className='grid grid-cols-3 gap-2 border-b p-3'>
        <Filter
          value={status}
          label='Status'
          values={['open', 'resolved']}
          onChange={(value) => setStatus(value as AnnotationStatus | 'all')}
        />
        <Filter
          value={kind}
          label='Kind'
          values={['note', 'todo']}
          onChange={(value) => setKind(value as AnnotationKind | 'all')}
        />
        <Select value={sectionId} onValueChange={setSectionId}>
          <SelectTrigger size='sm' aria-label='Section'>
            <SelectValue placeholder='Section' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All sections</SelectItem>
            {props.workspace?.sections.map((entry) => (
              <SelectItem key={entry.section.sectionId} value={entry.section.sectionId}>
                {entry.section.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {agentSelection.size > 0 ? (
        <div className='flex items-center gap-2 border-b p-2'>
          <span className='min-w-0 flex-1 text-xs text-muted-foreground'>
            {agentSelection.size} selected
          </span>
          <Button
            size='sm'
            onClick={() =>
              props.onIncludeAgent(
                annotations.filter((item) => agentSelection.has(item.annotationId))
              )
            }
          >
            <Send /> Include in Agent
          </Button>
        </div>
      ) : null}
      <ScrollArea className='min-h-0 flex-1'>
        {query.isPending ? (
          <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground' role='status'>
            <Spinner /> Loading annotations…
          </div>
        ) : null}
        {query.isError ? (
          <Alert variant='destructive' className='m-3 w-auto'>
            <AlertTriangle />
            <AlertTitle>Annotations could not be loaded</AlertTitle>
            <AlertDescription>
              <Button size='sm' variant='outline' onClick={() => void query.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!query.isPending && !query.isError && annotations.length === 0 ? (
          <Empty className='border-0 p-5'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Check />
              </EmptyMedia>
              <EmptyTitle className='text-sm'>No matching annotations</EmptyTitle>
              <EmptyDescription>
                Notes and TODOs attached to manuscript blocks will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <ItemGroup className='gap-1 p-2'>
          {annotations.map((annotation) => (
            <Item
              key={annotation.annotationId}
              size='sm'
              variant={selectedId === annotation.annotationId ? 'muted' : 'default'}
            >
              <Checkbox
                aria-label={`Select annotation: ${annotation.body.slice(0, 80)}`}
                checked={agentSelection.has(annotation.annotationId)}
                disabled={!agentSelection.has(annotation.annotationId) && agentSelection.size >= 10}
                onCheckedChange={(checked) =>
                  setAgentSelection((current) => {
                    const next = new Set(current)
                    if (checked === true) next.add(annotation.annotationId)
                    else next.delete(annotation.annotationId)
                    return next
                  })
                }
              />
              <button
                type='button'
                className='flex min-w-0 flex-1 items-center gap-2 text-left'
                onClick={() => setSelectedId(annotation.annotationId)}
              >
                {annotation.kind === 'todo' ? (
                  <SquareCheckBig className='size-4 shrink-0' />
                ) : (
                  <MessageSquareText className='size-4 shrink-0' />
                )}
                <ItemContent className='min-w-0'>
                  <ItemTitle className='line-clamp-2'>{annotation.body}</ItemTitle>
                  <ItemDescription>
                    {annotation.status} · {annotation.kind}
                  </ItemDescription>
                </ItemContent>
                {annotation.anchorStatus === 'orphaned' ? (
                  <AlertTriangle
                    className='size-4 shrink-0 text-warning'
                    aria-label='Orphaned location'
                  />
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
              {query.isFetchingNextPage ? <Spinner data-icon='inline-start' /> : null}Load more
            </Button>
          </div>
        ) : null}
        {selected !== null ? (
          <AnnotationDetails
            annotation={selected}
            updating={update.isPending}
            onNavigate={() => props.onNavigate(selected)}
            onUpdate={(operation) => update.mutate(operation)}
          />
        ) : null}
      </ScrollArea>
    </div>
  )
}

function AnnotationDetails(props: {
  annotation: AnnotationRecord
  updating: boolean
  onNavigate(): void
  onUpdate(operation: Parameters<typeof window.desktop.annotations.update>[0]['operation']): void
}): React.JSX.Element {
  const [body, setBody] = useState(props.annotation.body)
  const [kind, setKind] = useState<AnnotationKind>(props.annotation.kind)
  useEffect(() => {
    setBody(props.annotation.body)
    setKind(props.annotation.kind)
  }, [props.annotation])
  return (
    <>
      <Separator />
      <section className='flex flex-col gap-3 p-4' aria-label='Annotation details'>
        <div className='flex items-center gap-2'>
          <Badge variant={props.annotation.kind === 'todo' ? 'default' : 'secondary'}>
            {props.annotation.kind}
          </Badge>
          <Badge variant='outline'>{props.annotation.anchorStatus}</Badge>
        </div>
        <Select value={kind} onValueChange={(value) => setKind(value as AnnotationKind)}>
          <SelectTrigger aria-label='Annotation kind'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='note'>Note</SelectItem>
            <SelectItem value='todo'>TODO</SelectItem>
          </SelectContent>
        </Select>
        <Textarea
          aria-label='Annotation text'
          maxLength={8192}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={props.annotation.anchorStatus !== 'current'}
            onClick={props.onNavigate}
          >
            <Navigation /> Go to block
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={
              props.updating ||
              body.trim().length === 0 ||
              (body.trim() === props.annotation.body && kind === props.annotation.kind)
            }
            onClick={() =>
              props.onUpdate({
                action: 'edit',
                annotationId: props.annotation.annotationId,
                expectedVersion: props.annotation.version,
                kind,
                body
              })
            }
          >
            Save
          </Button>
          <Button
            size='sm'
            disabled={props.updating}
            onClick={() =>
              props.onUpdate({
                action: props.annotation.status === 'open' ? 'resolve' : 'reopen',
                annotationId: props.annotation.annotationId,
                expectedVersion: props.annotation.version
              })
            }
          >
            {props.annotation.status === 'open' ? <Check /> : <Circle />}
            {props.annotation.status === 'open' ? 'Resolve' : 'Reopen'}
          </Button>
        </div>
      </section>
    </>
  )
}

function Filter(props: {
  value: string
  label: string
  values: string[]
  onChange(value: string): void
}): React.JSX.Element {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger size='sm' aria-label={props.label}>
        <SelectValue placeholder={props.label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='all'>All {props.label.toLowerCase()}s</SelectItem>
        {props.values.map((value) => (
          <SelectItem key={value} value={value}>
            {value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
