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
import { useCallback, useEffect, useState } from 'react'
import type {
  CommentThread,
  CommentThreadSummary
} from '../../../../shared/contracts/manuscript-comments'
import type { EditorExactSelectionSnapshot } from './section-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  draftSelection: PendingCommentSelection | null
  selectedThreadId: string | null
  onDraftConsumed(): void
  onThreads(threads: CommentThreadSummary[]): void
  onSelect(thread: CommentThreadSummary | null): void
  onDelegatePrompt(prompt: string): void
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

  const load = useCallback(async (): Promise<void> => {
    void props.revisionKey
    try {
      const result = await window.desktop.manuscript.listComments({
        projectSessionId: props.projectSessionId,
        status,
        query,
        ...(scope === 'section' && props.activeSectionId !== null
          ? { sectionId: props.activeSectionId }
          : {}),
        limit: 100
      })
      setThreads(result.threads)
      props.onThreads(result.threads)
    } catch {
      props.onError('Comments could not be loaded.')
    }
  }, [
    props.activeSectionId,
    props.onError,
    props.onThreads,
    props.projectSessionId,
    props.revisionKey,
    query,
    scope,
    status
  ])

  useEffect(() => void load(), [load])
  useEffect(() => {
    if (props.selectedThreadId === null) {
      setDetail(null)
      return
    }
    void window.desktop.manuscript
      .readComment({ projectSessionId: props.projectSessionId, threadId: props.selectedThreadId })
      .then(setDetail)
      .catch(() => props.onError('The selected comment could not be opened.'))
  }, [props.projectSessionId, props.selectedThreadId, props.onError])

  const mutate = async (
    operation: () => Promise<unknown>,
    refreshSelected = true
  ): Promise<void> => {
    setBusy(true)
    try {
      await operation()
      setReply('')
      await load()
      if (refreshSelected && props.selectedThreadId !== null) {
        setDetail(
          await window.desktop.manuscript.readComment({
            projectSessionId: props.projectSessionId,
            threadId: props.selectedThreadId
          })
        )
      }
    } catch {
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
                  onClick={() =>
                    void mutate(async () => {
                      const result = await window.desktop.manuscript.delegateComments({
                        projectSessionId: props.projectSessionId,
                        threadIds: [detail.threadId]
                      })
                      props.onDelegatePrompt(result.prompt)
                    })
                  }
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
            onClick={() =>
              void mutate(async () => {
                const result = await window.desktop.manuscript.delegateComments({
                  projectSessionId: props.projectSessionId,
                  threadIds: [...selected]
                })
                setSelected(new Set())
                props.onDelegatePrompt(result.prompt)
              })
            }
          >
            Ask Agent to address {selected.size}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
