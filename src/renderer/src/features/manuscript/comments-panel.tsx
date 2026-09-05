import {
  Check,
  ChevronRight,
  MessageSquareText,
  Pencil,
  RefreshCcw,
  Search,
  Send,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CommentThread,
  CommentThreadSummary
} from '../../../../shared/contracts/manuscript-comments'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { EditorExactSelectionSnapshot } from './section-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface PendingCommentSelection extends EditorExactSelectionSnapshot {
  sectionId: string
}

export function CommentsPanel(props: {
  projectSessionId: string
  activeSectionId: string | null
  revisionKey: string
  visible?: boolean
  draftSelection: PendingCommentSelection | null
  selectedThreadId: string | null
  onDraftConsumed(): void
  onThreads(threads: CommentThreadSummary[]): void
  onHighlightThreads(threads: CommentThreadSummary[]): void
  onSelect(thread: CommentThreadSummary | null): void
  onDelegate(threadIds: readonly string[]): void
  onReanchor(thread: CommentThread): Promise<void>
  onError(message: string): void
}): React.JSX.Element {
  const [status, setStatus] = useState<'open' | 'resolved'>('open')
  const [scope, setScope] = useState<'all' | 'section'>('all')
  const [query, setQuery] = useState('')
  const [threads, setThreads] = useState<CommentThreadSummary[]>([])
  const [selected, setSelected] = useState(new Set<string>())
  const [draft, setDraft] = useState('')
  const [reply, setReply] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [detail, setDetail] = useState<CommentThread | null>(null)
  const [busy, setBusy] = useState(false)
  const [proposalReference, setProposalReference] = useState<{
    proposalId: string
    agentSessionId: string
  } | null>(null)
  const [proposal, setProposal] = useState<MutationProposalRecord | null>(null)
  const [proposalLoading, setProposalLoading] = useState(false)
  const [proposalError, setProposalError] = useState<string | null>(null)
  const proposalRequestRef = useRef(0)
  const loadSequenceRef = useRef(0)
  const highlightSequenceRef = useRef(0)
  const refreshInFlightRef = useRef(false)
  const selectedThreadIdRef = useRef<string | null>(props.selectedThreadId)
  selectedThreadIdRef.current = props.selectedThreadId

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequenceRef.current
    try {
      const pages: CommentThreadSummary[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      for (;;) {
        const result = await window.desktop.manuscript.listComments({
          projectSessionId: props.projectSessionId,
          status,
          query,
          ...(scope === 'section' && props.activeSectionId !== null
            ? { sectionId: props.activeSectionId }
            : {}),
          ...(cursor === undefined ? {} : { cursor }),
          limit: 100
        })
        pages.push(...result.threads)
        if (result.nextCursor === null) break
        if (seenCursors.has(result.nextCursor)) {
          throw new Error('Comment pagination returned a repeated cursor')
        }
        seenCursors.add(result.nextCursor)
        cursor = result.nextCursor
      }
      if (loadSequenceRef.current !== sequence) return
      setThreads(pages)
      props.onThreads(pages)
    } catch {
      if (loadSequenceRef.current === sequence) props.onError('Comments could not be loaded.')
    }
  }, [
    props.activeSectionId,
    props.onError,
    props.onThreads,
    props.projectSessionId,
    query,
    scope,
    status
  ])

  const loadHighlights = useCallback(async (): Promise<void> => {
    const sequence = ++highlightSequenceRef.current
    try {
      const pages: CommentThreadSummary[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      for (;;) {
        const result = await window.desktop.manuscript.listComments({
          projectSessionId: props.projectSessionId,
          status: 'open',
          query: '',
          limit: 100,
          ...(cursor === undefined ? {} : { cursor })
        })
        pages.push(...result.threads)
        if (result.nextCursor === null) break
        if (seenCursors.has(result.nextCursor)) {
          throw new Error('Comment pagination returned a repeated cursor')
        }
        seenCursors.add(result.nextCursor)
        cursor = result.nextCursor
      }
      if (highlightSequenceRef.current !== sequence) return
      props.onHighlightThreads(pages)
    } catch {
      if (highlightSequenceRef.current === sequence) props.onError('Comments could not be loaded.')
    }
  }, [props.onError, props.onHighlightThreads, props.projectSessionId])

  const readDetail = useCallback(
    async (threadId: string | null = selectedThreadIdRef.current): Promise<void> => {
      if (threadId === null) {
        setDetail(null)
        return
      }
      try {
        const next = await window.desktop.manuscript.readComment({
          projectSessionId: props.projectSessionId,
          threadId
        })
        if (selectedThreadIdRef.current === threadId) setDetail(next)
      } catch {
        if (selectedThreadIdRef.current === threadId)
          props.onError('The selected comment could not be opened.')
      }
    },
    [props.onError, props.projectSessionId]
  )

  const openProposal = useCallback(
    async (proposalId: string, agentSessionId: string): Promise<void> => {
      const requestId = ++proposalRequestRef.current
      setProposalReference({ proposalId, agentSessionId })
      setProposal(null)
      setProposalError(null)
      setProposalLoading(true)
      try {
        const proposals = await window.desktop.agent.listProposals({
          projectSessionId: props.projectSessionId,
          agentSessionId
        })
        if (proposalRequestRef.current !== requestId) return
        const match = proposals.find((candidate) => candidate.proposalId === proposalId) ?? null
        setProposal(match)
        if (match === null) setProposalError('The linked proposal is no longer available.')
      } catch {
        if (proposalRequestRef.current === requestId)
          setProposalError('The linked proposal could not be loaded.')
      } finally {
        if (proposalRequestRef.current === requestId) setProposalLoading(false)
      }
    },
    [props.projectSessionId]
  )

  const closeProposal = useCallback((): void => {
    proposalRequestRef.current += 1
    setProposalReference(null)
    setProposal(null)
    setProposalError(null)
    setProposalLoading(false)
  }, [])

  const refresh = useCallback(
    async (includeDetail = true): Promise<void> => {
      if (refreshInFlightRef.current) return
      refreshInFlightRef.current = true
      try {
        const requests = [load(), loadHighlights()]
        if (includeDetail) requests.push(readDetail())
        await Promise.all(requests)
      } finally {
        refreshInFlightRef.current = false
      }
    },
    [load, loadHighlights, readDetail]
  )

  useEffect(() => {
    void props.revisionKey
    if (props.selectedThreadId === null) setDetail(null)
    void refresh()
  }, [props.revisionKey, props.selectedThreadId, refresh])

  useEffect(() => {
    if (props.draftSelection === null) return
    setDetail(null)
    setEditingMessageId(null)
  }, [props.draftSelection])

  useEffect(() => {
    if (props.visible === false) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [props.visible, refresh])

  const mutate = async (
    operation: () => Promise<unknown>,
    refreshSelected = true
  ): Promise<void> => {
    setBusy(true)
    try {
      await operation()
      setReply('')
      await refresh(refreshSelected)
    } catch {
      await readDetail()
      props.onError(
        'The comment changed or the operation could not be completed. Reload and try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  if (detail !== null) {
    return (
      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='flex items-center gap-2 border-b p-3'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Back to comments'
            onClick={() => {
              setDetail(null)
              props.onSelect(null)
            }}
          >
            <ChevronRight className='rotate-180' />
          </Button>
          <span className='min-w-0 flex-1 truncate text-sm font-medium'>{detail.sectionTitle}</span>
          <Badge variant={detail.status === 'open' ? 'secondary' : 'outline'}>
            {detail.status}
          </Badge>
        </div>
        <ScrollArea className='min-h-0 flex-1'>
          <div className='space-y-4 p-4'>
            <blockquote className='border-l-2 pl-3 text-sm text-muted-foreground'>
              {detail.anchor.quote}
            </blockquote>
            {detail.anchor.status === 'orphaned' ? (
              <div className='space-y-2'>
                <p className='text-xs text-destructive'>
                  The original text changed and this comment needs a new anchor.
                </p>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busy}
                  onClick={() => void mutate(() => props.onReanchor(detail))}
                >
                  Link current selection
                </Button>
              </div>
            ) : null}
            {detail.messages.map((message) => (
              <div key={message.messageId} className='space-y-1'>
                <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                  <span>{message.author === 'agent' ? 'Agent' : 'You'}</span>
                  <span>{new Date(message.createdAt).toLocaleString()}</span>
                  {message.author === 'author' ? (
                    <Button
                      className='ml-auto'
                      variant='ghost'
                      size='icon-xs'
                      aria-label='Edit comment'
                      onClick={() => {
                        setEditingMessageId(message.messageId)
                        setEditDraft(message.body)
                      }}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </div>
                {editingMessageId === message.messageId ? (
                  <div className='space-y-2'>
                    <Textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      rows={3}
                    />
                    <div className='flex justify-end gap-2'>
                      <Button size='sm' variant='ghost' onClick={() => setEditingMessageId(null)}>
                        Cancel
                      </Button>
                      <Button
                        size='sm'
                        disabled={busy || editDraft.trim().length === 0}
                        onClick={() =>
                          void mutate(async () => {
                            await window.desktop.manuscript.editComment({
                              projectSessionId: props.projectSessionId,
                              threadId: detail.threadId,
                              messageId: message.messageId,
                              expectedVersion: detail.version,
                              body: editDraft
                            })
                            setEditingMessageId(null)
                          })
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className='whitespace-pre-wrap text-sm'>{message.body}</p>
                )}
              </div>
            ))}
            {detail.resolutionNote ? (
              <div className='rounded-md bg-muted p-3 text-sm'>
                <span className='font-medium'>Resolution:</span> {detail.resolutionNote}
              </div>
            ) : null}
            <CommentActivity detail={detail} onOpenProposal={openProposal} />
          </div>
        </ScrollArea>
        <div className='space-y-2 border-t p-3'>
          <Textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder='Follow up…'
            rows={3}
            disabled={busy}
          />
          <div className='flex flex-wrap gap-2'>
            <Button
              size='sm'
              disabled={busy || reply.trim().length === 0}
              onClick={() =>
                void mutate(() =>
                  window.desktop.manuscript.replyComment({
                    projectSessionId: props.projectSessionId,
                    threadId: detail.threadId,
                    expectedVersion: detail.version,
                    body: reply
                  })
                )
              }
            >
              <Send /> Reply
            </Button>
            {detail.status === 'open' ? (
              <>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      window.desktop.manuscript.resolveComment({
                        projectSessionId: props.projectSessionId,
                        threadId: detail.threadId,
                        expectedVersion: detail.version,
                        ...(reply.trim() ? { resolutionNote: reply } : {})
                      })
                    )
                  }
                >
                  <Check /> Resolve
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busy}
                  onClick={() => props.onDelegate([detail.threadId])}
                >
                  Ask Agent
                </Button>
              </>
            ) : (
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() =>
                  void mutate(() =>
                    window.desktop.manuscript.reopenComment({
                      projectSessionId: props.projectSessionId,
                      threadId: detail.threadId,
                      expectedVersion: detail.version
                    })
                  )
                }
              >
                <RefreshCcw /> Reopen
              </Button>
            )}
            <Button
              size='sm'
              variant='ghost'
              disabled={busy}
              onClick={() => {
                void mutate(async () => {
                  await window.desktop.manuscript.deleteComment({
                    projectSessionId: props.projectSessionId,
                    threadId: detail.threadId,
                    expectedVersion: detail.version
                  })
                  setDetail(null)
                  props.onSelect(null)
                }, false)
              }}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        </div>
        <CommentProposalDialog
          open={proposalReference !== null}
          onOpenChange={(open) => {
            if (!open) closeProposal()
          }}
          reference={proposalReference}
          proposal={proposal}
          loading={proposalLoading}
          error={proposalError}
        />
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='space-y-3 border-b p-3'>
        <Tabs value={status} onValueChange={(value) => setStatus(value as 'open' | 'resolved')}>
          <TabsList className='w-full'>
            <TabsTrigger className='flex-1' value='open'>
              Open
            </TabsTrigger>
            <TabsTrigger className='flex-1' value='resolved'>
              Resolved
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='relative'>
          <Search className='absolute top-2.5 left-2.5 size-4 text-muted-foreground' />
          <Input
            className='pl-8'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search comments'
          />
        </div>
        <Button
          variant='ghost'
          size='sm'
          className='w-full justify-start'
          onClick={() => setScope((value) => (value === 'all' ? 'section' : 'all'))}
          disabled={props.activeSectionId === null}
        >
          {scope === 'section' ? 'Current section' : 'Whole manuscript'}
        </Button>
      </div>
      {props.draftSelection !== null ? (
        <div className='space-y-3 border-b bg-muted/30 p-3'>
          <blockquote className='line-clamp-3 border-l-2 pl-3 text-xs text-muted-foreground'>
            {props.draftSelection.selectedText}
          </blockquote>
          <Textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder='Add a comment…'
            rows={3}
          />
          <div className='flex justify-end gap-2'>
            <Button variant='ghost' size='sm' onClick={props.onDraftConsumed}>
              Cancel
            </Button>
            <Button
              size='sm'
              disabled={busy || draft.trim().length === 0}
              onClick={() =>
                void mutate(async () => {
                  const selection = props.draftSelection
                  if (selection === null) return
                  await window.desktop.manuscript.createComment({
                    projectSessionId: props.projectSessionId,
                    sectionId: selection.sectionId,
                    revisionId: selection.capturedRevisionId,
                    contentHash: selection.capturedContentHash,
                    quote: selection.selectedText,
                    segments: selection.commentSegments,
                    body: draft
                  })
                  setDraft('')
                  props.onDraftConsumed()
                })
              }
            >
              <Send /> Comment
            </Button>
          </div>
        </div>
      ) : null}
      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-1 p-2'>
          {threads.length === 0 ? (
            <div className='px-3 py-10 text-center text-sm text-muted-foreground'>
              <MessageSquareText className='mx-auto mb-2 size-6' />
              No {status} comments
            </div>
          ) : null}
          {threads.map((thread) => (
            <div
              key={thread.threadId}
              className={
                thread.threadId === props.selectedThreadId
                  ? 'rounded-md bg-accent p-2'
                  : 'rounded-md p-2 hover:bg-accent/60'
              }
            >
              <div className='flex items-start gap-2'>
                {status === 'open' ? (
                  <Checkbox
                    aria-label={`Select comment in ${thread.sectionTitle}`}
                    checked={selected.has(thread.threadId)}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (checked) next.add(thread.threadId)
                        else next.delete(thread.threadId)
                        return next
                      })
                    }
                  />
                ) : null}
                <button
                  type='button'
                  className='min-w-0 flex-1 text-left'
                  onClick={() => props.onSelect(thread)}
                >
                  <div className='truncate text-xs font-medium text-muted-foreground'>
                    {thread.sectionTitle}
                  </div>
                  <p className='line-clamp-2 text-sm'>{thread.latestMessagePreview}</p>
                  <p className='mt-1 truncate text-xs text-muted-foreground'>
                    “{thread.anchor.quote}” · {thread.messageCount}
                  </p>
                  <CommentActivitySummary thread={thread} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      {selected.size > 0 ? (
        <div className='border-t p-3'>
          <Button
            className='w-full'
            disabled={busy}
            onClick={() => {
              const threadIds = [...selected]
              setSelected(new Set())
              props.onDelegate(threadIds)
            }}
          >
            Ask Agent to address {selected.size}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function CommentActivity({
  detail,
  onOpenProposal
}: {
  detail: CommentThread
  onOpenProposal(proposalId: string, agentSessionId: string): void
}): React.JSX.Element | null {
  const activity = detail.activity
  const events = detail.events
  const activityProposalId = activity?.proposalId ?? null
  const activityAgentSessionId = activity?.agentSessionId ?? null
  if (activity == null && events.length === 0) return null
  return (
    <section className='space-y-2 border-t pt-3' aria-label='Comment processing activity'>
      {activity ? (
        <div className='flex flex-wrap items-center gap-2 text-xs'>
          <span className='font-medium'>Agent activity</span>
          <Badge variant={activity.status === 'failed' ? 'destructive' : 'secondary'}>
            {formatActivityStatus(activity.status)}
          </Badge>
          {activityProposalId !== null && activityAgentSessionId !== null ? (
            <Button
              className='h-auto p-0 font-mono text-[11px]'
              variant='link'
              size='sm'
              onClick={() => onOpenProposal(activityProposalId, activityAgentSessionId)}
            >
              Proposal {activityProposalId}
            </Button>
          ) : null}
        </div>
      ) : null}
      {events.length > 0 ? (
        <section className='space-y-2' aria-label='Comment event history'>
          <p className='text-xs font-medium text-muted-foreground'>Activity history</p>
          {events.map((event) => {
            const proposalId = event.proposalId
            const agentSessionId = event.agentSessionId
            return (
              <div key={event.eventId} className='space-y-0.5 text-xs text-muted-foreground'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <span className='font-medium text-foreground'>
                    {formatCommentEvent(event.type)}
                  </span>
                  <span>·</span>
                  <span>
                    {event.actor === 'agent'
                      ? 'Agent'
                      : event.actor === 'system'
                        ? 'System'
                        : 'You'}
                  </span>
                  <span>·</span>
                  <time dateTime={event.createdAt}>{formatEventDate(event.createdAt)}</time>
                </div>
                {proposalId !== null && agentSessionId !== null ? (
                  <Button
                    className='h-auto p-0 font-mono text-[11px]'
                    variant='link'
                    size='sm'
                    onClick={() => onOpenProposal(proposalId, agentSessionId)}
                  >
                    Proposal {proposalId}
                  </Button>
                ) : null}
                {event.note ? <p className='whitespace-pre-wrap'>{event.note}</p> : null}
              </div>
            )
          })}
        </section>
      ) : null}
    </section>
  )
}

function CommentProposalDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  reference: { proposalId: string; agentSessionId: string } | null
  proposal: MutationProposalRecord | null
  loading: boolean
  error: string | null
}): React.JSX.Element {
  const preview = props.proposal?.payload.preview
  const baseRevisionId =
    props.proposal?.payload.kind === 'section_patch'
      ? props.proposal.payload.mutation.baseRevisionId
      : null
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[80vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Proposal details</DialogTitle>
          <DialogDescription>
            Read-only evidence for the change linked from this comment.
          </DialogDescription>
        </DialogHeader>
        {props.loading ? <p className='text-sm text-muted-foreground'>Loading proposal…</p> : null}
        {props.error ? <p className='text-sm text-destructive'>{props.error}</p> : null}
        {props.proposal && preview ? (
          <div className='space-y-4 text-sm'>
            <div className='flex flex-wrap items-center gap-2'>
              <Badge>{formatCommentEvent(props.proposal.status)}</Badge>
              <span className='text-muted-foreground'>{props.proposal.kind}</span>
              <span className='font-mono text-xs text-muted-foreground'>
                {props.proposal.proposalId}
              </span>
            </div>
            <p className='font-medium'>{preview.summary}</p>
            <div className='grid gap-3 sm:grid-cols-2'>
              <ProposalText
                title='Before'
                text={preview.beforeText}
                truncated={preview.beforeTextTruncated}
              />
              <ProposalText
                title='After'
                text={preview.afterText}
                truncated={preview.afterTextTruncated}
              />
            </div>
            <dl className='grid gap-2 border-t pt-3 text-xs sm:grid-cols-2'>
              <div>
                <dt className='text-muted-foreground'>Base revision</dt>
                <dd className='mt-0.5 break-all font-mono'>{baseRevisionId ?? 'Not applicable'}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Applied revision</dt>
                <dd className='mt-0.5 break-all font-mono'>
                  {props.proposal.appliedRevisionId ?? 'Not applied'}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Agent session</dt>
                <dd className='mt-0.5 break-all font-mono'>{props.proposal.agentSessionId}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Linked comment session</dt>
                <dd className='mt-0.5 break-all font-mono'>
                  {props.reference?.agentSessionId ?? 'Unavailable'}
                </dd>
              </div>
            </dl>
            {props.proposal.rejectedReason ? (
              <p className='text-xs text-muted-foreground'>
                Decision note: {props.proposal.rejectedReason}
              </p>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ProposalText(props: {
  title: string
  text: string
  truncated: boolean
}): React.JSX.Element {
  return (
    <section className='space-y-1'>
      <h3 className='text-xs font-medium text-muted-foreground'>{props.title}</h3>
      <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs'>
        {props.text || '—'}
      </pre>
      {props.truncated ? (
        <p className='text-[11px] text-muted-foreground'>Text truncated.</p>
      ) : null}
    </section>
  )
}

function CommentActivitySummary({
  thread
}: {
  thread: CommentThreadSummary
}): React.JSX.Element | null {
  const activity = thread.activity
  if (!activity) return null
  return (
    <span className='mt-1 flex items-center gap-1 text-[11px] text-muted-foreground'>
      <Badge
        className='h-4 px-1.5 text-[10px]'
        variant={activity.status === 'failed' ? 'destructive' : 'secondary'}
      >
        {formatActivityStatus(activity.status)}
      </Badge>
      {activity.proposalId ? <span className='truncate'>Proposal linked</span> : null}
    </span>
  )
}

function formatCommentEvent(type: string): string {
  return type.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toLocaleUpperCase())
}

function formatActivityStatus(status: string): string {
  const labels: Record<string, string> = {
    awaiting_review: 'Waiting for approval',
    awaiting_user: 'Needs your input',
    completed: 'Completed',
    delegated: 'Queued',
    failed: 'Failed',
    interrupted: 'Stopped',
    running: 'In progress'
  }
  return labels[status] ?? formatCommentEvent(status)
}

function formatEventDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
