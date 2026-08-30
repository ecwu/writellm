import type { AgentSessionRecord } from '../../../../shared/contracts/agent-ipc'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  CircleHelp,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { groupAgentConversations, type AgentThinkingVisualState } from './agent-view-model'
import { AgentThinkingIndicator } from './agent-motion'
import { sessionStatusLabel } from './agent-panel-logic'

type AgentSidebarWorkflowState = AgentSessionRecord['workflowState']

function ConversationStatusIcon(props: {
  workflowState: AgentSidebarWorkflowState
  thinkingVisualState: AgentThinkingVisualState
  archived?: boolean
}): React.JSX.Element {
  if (props.archived) return <Archive className='mt-1 size-4 shrink-0 text-muted-foreground' />
  if (
    props.workflowState === 'running' ||
    props.workflowState === 'compacting' ||
    props.workflowState === 'generating'
  ) {
    return <AgentThinkingIndicator state={props.thinkingVisualState} />
  }
  if (props.workflowState === 'awaiting_input') {
    return <CircleHelp className='mt-1 size-4 shrink-0 text-warning' />
  }
  if (props.workflowState === 'awaiting_review') {
    return <AlertCircle className='mt-1 size-4 shrink-0 text-warning' />
  }
  return <Bot className='mt-1 size-4 shrink-0 text-muted-foreground' />
}

export function ConversationSwitcher(props: {
  open: boolean
  onOpenChange(open: boolean): void
  sessions: AgentSessionRecord[]
  activeSession: AgentSessionRecord | null
  titleGeneratingIds: ReadonlySet<string>
  busy: boolean
  status: string
  workflowState: AgentSidebarWorkflowState
  thinkingVisualState: AgentThinkingVisualState
  onNew(): void
  onOpen(agentSessionId: string): void
  onArchive(session: AgentSessionRecord): Promise<void>
  onRestore(session: AgentSessionRecord): Promise<void>
  onRegenerateTitle(session: AgentSessionRecord): Promise<void>
}): React.JSX.Element {
  const groups = groupAgentConversations(props.sessions)
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          className='h-auto min-h-10 min-w-0 justify-start gap-2 px-2 py-1 text-left'
          data-testid='agent-conversation-switcher'
        >
          <ConversationStatusIcon
            workflowState={props.workflowState}
            thinkingVisualState={props.thinkingVisualState}
            archived={props.activeSession?.status === 'archived'}
          />
          <span className='min-w-0 flex-1'>
            <span className='block truncate font-semibold'>
              {props.activeSession?.title ?? 'New conversation'}
            </span>
            <span
              className='block truncate text-xs font-normal text-muted-foreground'
              data-testid='agent-status'
              role='status'
              aria-live='polite'
            >
              {props.status}
            </span>
          </span>
          {props.activeSession &&
          props.titleGeneratingIds.has(props.activeSession.agentSessionId) ? (
            <Spinner className='shrink-0' aria-label='Generating conversation title' />
          ) : (
            <ChevronDown className='shrink-0' />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-[min(24rem,calc(100vw-2rem))] p-0'>
        <Command>
          <CommandInput placeholder='Search conversations…' />
          <CommandList>
            <CommandEmpty>No matching conversation.</CommandEmpty>
            <CommandGroup>
              <CommandItem value='new conversation' onSelect={props.onNew}>
                <MessageSquarePlus /> New conversation
              </CommandItem>
            </CommandGroup>
            <ConversationCommandGroup
              heading='Needs an answer'
              sessions={groups.needsInput}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Needs review'
              sessions={groups.needsReview}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Working'
              sessions={groups.working}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Recent'
              sessions={groups.recent}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Archived'
              sessions={groups.archived}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ConversationCommandGroup(props: {
  heading: string
  sessions: AgentSessionRecord[]
  titleGeneratingIds: ReadonlySet<string>
  busy: boolean
  onOpen(agentSessionId: string): void
  onArchive(session: AgentSessionRecord): Promise<void>
  onRestore(session: AgentSessionRecord): Promise<void>
  onRegenerateTitle(session: AgentSessionRecord): Promise<void>
}): React.JSX.Element | null {
  if (props.sessions.length === 0) return null
  return (
    <CommandGroup heading={props.heading}>
      {props.sessions.map((session) => {
        const actionBlocked =
          session.workflowState !== 'idle' || props.titleGeneratingIds.has(session.agentSessionId)
        return (
          <CommandItem
            key={session.agentSessionId}
            value={`${session.title} ${sessionStatusLabel(session)}`}
            className='gap-2'
            data-testid={`agent-session-${session.agentSessionId}`}
            onSelect={() => props.onOpen(session.agentSessionId)}
          >
            {session.workflowState === 'running' ||
            session.workflowState === 'generating' ||
            session.workflowState === 'compacting' ? (
              <Spinner />
            ) : session.workflowState === 'awaiting_input' ? (
              <CircleHelp className='text-warning' />
            ) : session.workflowState === 'awaiting_review' ? (
              <AlertCircle className='text-warning' />
            ) : session.status === 'archived' ? (
              <Archive />
            ) : (
              <MessageSquarePlus />
            )}
            <span className='min-w-0 flex-1 truncate'>{session.title}</span>
            <span className='text-xs text-muted-foreground'>{sessionStatusLabel(session)}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Conversation actions for ${session.title}`}
                  disabled={props.busy}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {session.status === 'active' ? (
                  <>
                    <DropdownMenuItem
                      disabled={actionBlocked || !session.compatible}
                      onSelect={() => void props.onRegenerateTitle(session)}
                    >
                      <RotateCcw /> Regenerate title
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={actionBlocked}
                      onSelect={() => void props.onArchive(session)}
                    >
                      <Archive /> Archive
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onSelect={() => void props.onRestore(session)}>
                    <ArchiveRestore /> Restore
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}
