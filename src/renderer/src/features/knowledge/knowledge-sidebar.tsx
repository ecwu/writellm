import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowDownAZ, ChevronRight, File, FileUp, Plus, Search } from 'lucide-react'
import type { KnowledgeIndexStatus, KnowledgeItem } from '../../../../shared/contracts/knowledge'
import type { ReferenceItem } from '../../../../shared/contracts/references'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { KnowledgeActivity } from './knowledge-activity'
import {
  canRetryItem,
  hasActiveKnowledgeWorkForItem,
  itemNeedsAttention,
  itemStatus,
  libraryEntries,
  referenceStatus
} from './knowledge-sidebar-model'

export function KnowledgeSidebar(props: {
  projectSessionId: string
  references: ReferenceItem[]
  items: KnowledgeItem[]
  jobs: JobStatus[]
  selectedItemId: string | null
  selectedReferenceId: string | null
  busy: boolean
  loading: boolean
  unavailable: boolean
  jobsUnavailable: boolean
  jobsLoading: boolean
  indexStatus: KnowledgeIndexStatus | undefined
  indexUnavailable: boolean
  onSelect(id: string, referenceId?: string): void
  onSelectReference(reference: ReferenceItem): void
  onImport(): void
  onRetry(id: string): void
  onRefresh(): void
  onRefreshJobs(): void
  onDrop(files: File[]): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('title')
  const [unlinkedOpen, setUnlinkedOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const resetDrag = (): void => {
    depth.current = 0
    setDragging(false)
  }
  useEffect(() => {
    const reset = (): void => {
      depth.current = 0
      setDragging(false)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') reset()
    }
    window.addEventListener('blur', reset)
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', reset)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('blur', reset)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', reset)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])
  const library = libraryEntries(
    props.references,
    props.items,
    query,
    filter === 'attention',
    sort === 'recent'
  )
  const ready = !props.loading && !props.unavailable
  const fileRow = (item: KnowledgeItem, referenceId?: string): React.JSX.Element => (
    <div key={item.knowledgeItemId} className='flex min-w-0 items-start gap-1'>
      <Button
        variant={props.selectedItemId === item.knowledgeItemId ? 'secondary' : 'ghost'}
        className='h-auto min-w-0 flex-1 justify-start py-2'
        data-testid={`knowledge-attachment-${item.knowledgeItemId}`}
        aria-pressed={props.selectedItemId === item.knowledgeItemId}
        onClick={() => props.onSelect(item.knowledgeItemId, referenceId)}
      >
        <File />
        <span className='grid min-w-0 gap-1 text-left'>
          <span className='truncate'>{item.displayName}</span>
          <Status
            text={itemStatus(item, props.indexStatus, props.indexUnavailable)}
            failed={itemNeedsAttention(item)}
            running={isRunning(item)}
          />
        </span>
      </Button>
      {canRetryItem(item) ? (
        <Button
          variant='link'
          size='sm'
          disabled={props.busy}
          onClick={() => props.onRetry(item.knowledgeItemId)}
        >
          Retry
        </Button>
      ) : null}
    </div>
  )
  return (
    <Sidebar
      collapsible='none'
      className='min-h-0 min-w-0 flex-1'
      data-testid='knowledge-sidebar'
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        depth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = props.busy ? 'none' : 'copy'
      }}
      onDragLeave={(event) => {
        if (!dragging) return
        depth.current = Math.max(0, depth.current - 1)
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return
        if (depth.current === 0 || event.relatedTarget !== null) resetDrag()
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        resetDrag()
        if (!props.busy) props.onDrop(Array.from(event.dataTransfer.files))
      }}
    >
      <div className='grid shrink-0 gap-3 p-4'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='text-base font-semibold'>References</h2>
          <Button
            data-testid='knowledge-upload-button'
            variant='outline'
            size='sm'
            disabled={props.busy}
            onClick={props.onImport}
          >
            {props.busy ? <Spinner /> : <Plus />} Import
          </Button>
        </div>
        <p className='text-xs text-muted-foreground'>
          {ready
            ? `${props.references.length} references · ${props.items.length} files`
            : props.unavailable
              ? 'Library unavailable'
              : 'Loading library…'}
        </p>
        <InputGroup>
          <InputGroupInput
            aria-label='Search references'
            placeholder='Search title, author, year…'
            value={query}
            maxLength={512}
            onChange={(event) => setQuery(event.target.value)}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <ToggleGroup
          className='w-full flex-wrap justify-start'
          spacing={1}
          type='single'
          size='sm'
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value)
          }}
          aria-label='Filter references'
        >
          <ToggleGroupItem value='all'>
            All{ready ? ` ${props.references.length + library.unlinkedCount}` : ''}
          </ToggleGroupItem>
          <ToggleGroupItem value='attention'>
            Needs attention{ready ? ` ${library.attentionCount}` : ''}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Separator />
      <div className='relative flex min-h-0 flex-1 flex-col'>
        <SidebarContent>
          <SidebarGroup>
            <div className='flex items-center justify-between gap-2 px-2'>
              <SidebarGroupLabel>
                {query.trim() && ready
                  ? `${library.references.length + library.unlinked.length} matches`
                  : 'Library'}
              </SidebarGroupLabel>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' size='icon-sm' aria-label='Sort references'>
                    <ArrowDownAZ />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
                    <DropdownMenuRadioItem value='title'>Title A–Z</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value='recent'>Recently added</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {props.loading ? (
              <div className='grid gap-3 p-3' role='status' aria-label='Loading library'>
                <Skeleton className='h-16 w-full' />
                <Skeleton className='h-16 w-full' />
                <Skeleton className='h-16 w-full' />
              </div>
            ) : props.unavailable ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Library unavailable</EmptyTitle>
                  <EmptyDescription>References and files could not be loaded.</EmptyDescription>
                </EmptyHeader>
                <Button variant='outline' onClick={props.onRefresh}>
                  Retry loading library
                </Button>
              </Empty>
            ) : (
              <>
                {library.references.map(({ reference, attachments }) => (
                  <Collapsible
                    key={reference.referenceId}
                    className={cn(
                      'rounded-md',
                      props.selectedReferenceId === reference.referenceId && 'bg-sidebar-accent'
                    )}
                  >
                    <div className='flex min-w-0 items-start gap-1 p-1'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant='ghost'
                            className='h-auto min-w-0 flex-1 items-start justify-start py-3'
                            aria-pressed={props.selectedReferenceId === reference.referenceId}
                            data-reference-id={reference.referenceId}
                            data-testid={
                              attachments[0]
                                ? `knowledge-file-${attachments[0].knowledgeItemId}`
                                : `knowledge-reference-${reference.referenceId}`
                            }
                            onClick={() => props.onSelectReference(reference)}
                          >
                            <File className='mt-0.5' />
                            <span className='grid min-w-0 gap-1 text-left'>
                              <span className='line-clamp-2 whitespace-normal'>
                                {reference.title}
                              </span>
                              <span className='truncate text-xs font-normal text-muted-foreground'>
                                {[authorLabel(reference), reference.issuedYear]
                                  .filter(Boolean)
                                  .join(' · ') || 'Author unknown'}
                              </span>
                              <Status
                                text={referenceStatus(
                                  reference,
                                  attachments,
                                  props.indexStatus,
                                  props.indexUnavailable
                                )}
                                failed={attachments.some(itemNeedsAttention)}
                                running={attachments.some(isRunning)}
                              />
                            </span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side='right' className='max-w-sm'>
                          {reference.title}
                        </TooltipContent>
                      </Tooltip>
                      {attachments.length > 0 ? (
                        <CollapsibleTrigger asChild>
                          <Button
                            variant='ghost'
                            size='icon-sm'
                            className='mt-2 shrink-0 data-[state=open]:rotate-90'
                            aria-label={`Show attachments for ${reference.title}`}
                          >
                            <ChevronRight />
                          </Button>
                        </CollapsibleTrigger>
                      ) : null}
                    </div>
                    {attachments.length === 1 && canRetryItem(attachments[0]) ? (
                      <Button
                        variant='link'
                        size='sm'
                        className='ml-10'
                        disabled={props.busy}
                        onClick={() => props.onRetry(attachments[0].knowledgeItemId)}
                      >
                        Retry
                      </Button>
                    ) : null}
                    <CollapsibleContent className='pb-2 pr-2 pl-7'>
                      {attachments.map((item) => fileRow(item, reference.referenceId))}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
                {library.unlinkedCount > 0 ? (
                  <Collapsible
                    open={query.trim() ? library.unlinked.length > 0 : unlinkedOpen}
                    onOpenChange={setUnlinkedOpen}
                  >
                    <Separator className='my-2' />
                    <CollapsibleTrigger asChild>
                      <Button variant='ghost' className='w-full justify-start'>
                        <ChevronRight />
                        Unlinked files <span className='ml-auto'>{library.unlinked.length}</span>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {library.unlinked.map((item) => fileRow(item))}
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
                {library.references.length + library.unlinked.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        {props.references.length + props.items.length === 0
                          ? 'No references yet'
                          : 'No matching references'}
                      </EmptyTitle>
                      <EmptyDescription>
                        {props.references.length + props.items.length === 0
                          ? 'Import files or add references from your bibliography.'
                          : 'Try another search or switch to All.'}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : null}
              </>
            )}
          </SidebarGroup>
        </SidebarContent>
        {dragging ? (
          <div
            data-testid='knowledge-drop-zone'
            role='status'
            className='pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-sidebar p-4 text-center'
          >
            <FileUp className='size-6' />
            <p className='font-medium'>
              {props.busy ? 'Import in progress' : 'Drop files to import'}
            </p>
            <p className='text-sm text-muted-foreground'>
              {props.busy ? 'Wait for the current import to finish.' : 'Add to this project'}
            </p>
          </div>
        ) : null}
      </div>
      <KnowledgeActivity
        projectSessionId={props.projectSessionId}
        jobs={props.jobs}
        items={props.items}
        loading={props.jobsLoading}
        unavailable={props.jobsUnavailable}
        onSelect={props.onSelect}
        onRefresh={props.onRefreshJobs}
      />
    </Sidebar>
  )
}
function isRunning(item: KnowledgeItem): boolean {
  return hasActiveKnowledgeWorkForItem(item) && item.parseState !== 'queued'
}
function authorLabel(reference: ReferenceItem): string {
  const authors = reference.creators.filter((creator) => creator.role === 'author')
  const first = authors[0]
  return first
    ? `${first.literal ?? first.family ?? first.given ?? ''}${authors.length > 1 ? ' et al.' : ''}`
    : ''
}
function Status(props: { text: string; failed: boolean; running: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'flex items-start gap-1 whitespace-normal text-xs font-normal text-muted-foreground',
        props.failed && 'text-destructive'
      )}
    >
      {props.running ? (
        <Spinner className='mt-0.5 size-3 shrink-0' />
      ) : props.failed ? (
        <AlertCircle className='mt-0.5 size-3 shrink-0' />
      ) : null}
      <span>{props.text}</span>
    </span>
  )
}
