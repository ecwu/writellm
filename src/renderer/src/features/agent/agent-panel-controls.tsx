import type { AgentPendingQuestion, AgentStartScope } from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import {
  agentApprovalModeSchema,
  agentInteractionModeSchema,
  type AgentApprovalMode,
  type AgentInteractionMode
} from '../../../../shared/contracts/agent'
import type { AskUserAnswer } from '../../../../shared/contracts/agent-tools'
import type { LeadingSkillMention } from '../../../../shared/skill-mentions'
import {
  AlertCircle,
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  CircleStop,
  FilePenLine,
  FolderOpen,
  ListCollapse,
  MoreHorizontal,
  RotateCcw,
  TextCursorInput,
  X
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { InputGroupButton } from '@/components/ui/input-group'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle
} from '@/components/ui/questionnaire'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import {
  approvalModeDescription,
  approvalModeLabel,
  type ComposerCommand,
  type SkillMentionCandidate
} from './agent-panel-logic'

export function AgentAttentionDock(props: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      aria-label={props.label}
      className='min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200'
      data-testid='agent-attention-dock'
    >
      {props.children}
    </section>
  )
}

export function AgentQuestionnaireDock(props: {
  pending: AgentPendingQuestion
  busy: boolean
  onSubmit(answers: AskUserAnswer[]): Promise<void>
  onStop(): Promise<void>
}): React.JSX.Element {
  const items = props.pending.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((option) => ({ value: option.label }))
  }))
  const firstQuestion = props.pending.questions[0]
  if (firstQuestion === undefined) throw new Error('Agent clarification has no questions')

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (props.busy) return
    const formData = new FormData(event.currentTarget)
    const answers = props.pending.questions.flatMap((question): AskUserAnswer[] => {
      const raw = formData.get(question.id)
      if (typeof raw !== 'string' || raw.trim().length === 0) return []
      const value = raw.trim()
      return [
        {
          questionId: question.id,
          kind: question.options.some((option) => option.label === value) ? 'option' : 'custom',
          value
        }
      ]
    })
    if (answers.length !== props.pending.questions.length) return
    void props.onSubmit(answers)
  }

  return (
    <section
      className='min-w-0 rounded-lg border bg-background p-3 shadow-xs'
      aria-label='Agent clarification'
      data-testid='agent-questionnaire'
    >
      <Questionnaire
        defaultItem={firstQuestion.id}
        items={items}
        shortcuts='letters'
        onSubmit={submit}
      >
        <div className='flex min-w-0 items-center justify-between gap-3'>
          <Badge variant='secondary'>Your input is needed</Badge>
          <QuestionnaireProgress
            render={(progressProps, state) => (
              <span {...progressProps}>
                Question {state.current} of {state.total}
              </span>
            )}
          />
        </div>
        {props.pending.questions.map((question) => (
          <QuestionnaireItem key={question.id} name={question.id} required>
            <div className='flex min-w-0 flex-col gap-1'>
              <Badge variant='outline' className='w-fit max-w-full truncate'>
                {question.header}
              </Badge>
              <QuestionnaireTitle className='wrap-anywhere'>{question.question}</QuestionnaireTitle>
              <QuestionnaireDescription>
                Choose one option or type your own answer.
              </QuestionnaireDescription>
            </div>
            <QuestionnaireChoices>
              {question.options.map((option) => (
                <QuestionnaireChoice key={option.label} value={option.label} disabled={props.busy}>
                  <span className='wrap-anywhere font-medium'>{option.label}</span>
                  <QuestionnaireChoiceDescription className='wrap-anywhere'>
                    {option.description}
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>
              ))}
              <QuestionnaireInput
                aria-label={`Another answer for ${question.header}`}
                placeholder='Type another answer…'
                maxLength={4_096}
                disabled={props.busy}
              />
            </QuestionnaireChoices>
            <QuestionnaireError>Choose an option or enter an answer.</QuestionnaireError>
          </QuestionnaireItem>
        ))}
        <QuestionnaireActions className='grid-cols-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]'>
          <QuestionnairePrevious disabled={props.busy} />
          <Button
            type='button'
            variant='outline'
            className='col-span-2 col-start-1 row-start-2 min-h-11 justify-self-start sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:min-h-0 sm:justify-self-end'
            disabled={props.busy}
            onClick={() => void props.onStop()}
          >
            {props.busy ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <CircleStop data-icon='inline-start' />
            )}
            Stop
          </Button>
          <QuestionnaireNext className='col-start-2 sm:col-start-3' disabled={props.busy} />
          <QuestionnaireSubmit className='col-start-2 sm:col-start-3' disabled={props.busy}>
            {props.busy ? <Spinner data-icon='inline-start' /> : <Check data-icon='inline-start' />}
            Answer
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </section>
  )
}

export function ComposerContextChips(props: {
  scopePreference: 'auto' | AgentStartScope
  skillMentions: readonly LeadingSkillMention[]
  disabled: boolean
  onScopeClick(): void
  onSkillClick(mention: LeadingSkillMention): void
}): React.JSX.Element | null {
  const scopeLabel =
    props.scopePreference === 'selection'
      ? 'Selected text'
      : props.scopePreference === 'section'
        ? 'This section'
        : props.scopePreference === 'project'
          ? 'Whole manuscript'
          : null
  if (scopeLabel === null && props.skillMentions.length === 0) {
    return null
  }
  return (
    <fieldset
      className='m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0'
      data-testid='agent-composer-context-chips'
      aria-label='Prompt context'
    >
      {scopeLabel === null ? null : (
        <Button
          type='button'
          variant='secondary'
          size='xs'
          className='h-6 max-w-full rounded-full px-2 text-xs'
          disabled={props.disabled}
          onClick={props.onScopeClick}
        >
          <TextCursorInput />
          <span className='truncate'>{scopeLabel}</span>
        </Button>
      )}
      {props.skillMentions.map((mention) => (
        <Button
          key={`${mention.start}-${mention.name}`}
          type='button'
          variant='secondary'
          size='xs'
          className='h-6 max-w-full rounded-full px-2 font-mono text-xs'
          onClick={() => props.onSkillClick(mention)}
        >
          <span className='truncate'>${mention.name}</span>
        </Button>
      ))}
    </fieldset>
  )
}

export function ComposerCommandMenu(props: {
  commands: ComposerCommand[]
  selectedId?: string
  onSelectedIdChange?(id: string): void
  onSelect(command: ComposerCommand): void
}): React.JSX.Element {
  const groups = ['Context', 'Conversation'] as const
  return (
    <Command value={props.selectedId} onValueChange={props.onSelectedIdChange}>
      <CommandList>
        <CommandEmpty>No matching action.</CommandEmpty>
        {groups.map((group) => {
          const commands = props.commands.filter((command) => command.group === group)
          if (commands.length === 0) return null
          return (
            <CommandGroup key={group} heading={group}>
              {commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={command.id}
                  disabled={command.disabled}
                  onSelect={() => props.onSelect(command)}
                >
                  <ComposerCommandIcon command={command} />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{command.label}</span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {command.description}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </Command>
  )
}

function ComposerCommandIcon(props: { command: ComposerCommand }): React.JSX.Element {
  if (props.command.selected) return <Check />
  const action = props.command.action
  if (action.kind === 'compact') return <ListCollapse />
  if (action.value === 'selection') return <TextCursorInput />
  if (action.value === 'section') return <FilePenLine />
  if (action.value === 'project') return <FolderOpen />
  return <Bot />
}

export function SkillMentionMenu(props: {
  candidates: SkillMentionCandidate[]
  selectedId?: string
  onSelectedIdChange(id: string): void
  onSelect(candidate: SkillMentionCandidate): void
}): React.JSX.Element {
  return (
    <Command value={props.selectedId} onValueChange={props.onSelectedIdChange}>
      <CommandList>
        <CommandEmpty>No matching enabled Writing Skill.</CommandEmpty>
        <CommandGroup heading='Writing Skills'>
          {props.candidates.map((candidate) => (
            <CommandItem
              key={candidate.skillId}
              value={candidate.skillId}
              disabled={candidate.disabled}
              onSelect={() => props.onSelect(candidate)}
            >
              <BookOpen />
              <span className='min-w-0 flex-1'>
                <span className='flex min-w-0 items-baseline gap-2'>
                  <code className='shrink-0 text-xs'>${candidate.name}</code>
                  {candidate.displayName !== candidate.name ? (
                    <span className='truncate text-xs text-muted-foreground'>
                      {candidate.displayName}
                    </span>
                  ) : null}
                </span>
                <span className='block truncate text-xs text-muted-foreground'>
                  {candidate.description}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export function ApprovalModePicker(props: {
  value: AgentApprovalMode
  disabled: boolean
  onSelect(mode: AgentApprovalMode): void | Promise<void>
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          variant='ghost'
          size='xs'
          className='shrink-0'
          disabled={props.disabled}
          aria-label={`Approval policy: ${approvalModeLabel(props.value)}`}
          data-testid='agent-approval-selector'
        >
          <span>{approvalModeLabel(props.value)}</span>
          <ChevronDown />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' side='top'>
        <DropdownMenuRadioGroup
          value={props.value}
          onValueChange={(value) => void props.onSelect(agentApprovalModeSchema.parse(value))}
        >
          {(['manual', 'section_auto', 'yolo'] as const).map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode} className='items-start'>
              <span className='min-w-0 pr-4'>
                <span className='block'>{approvalModeLabel(mode)}</span>
                <span className='block text-xs text-muted-foreground'>
                  {approvalModeDescription(mode)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const INTERACTION_MODE_COPY: Record<AgentInteractionMode, { label: string; description: string }> =
  {
    ask: { label: 'Ask', description: 'Read and answer' },
    plan: { label: 'Plan', description: 'Build a writing plan' },
    write: { label: 'Write', description: 'Propose manuscript changes' }
  }

export function InteractionModePicker(props: {
  value: AgentInteractionMode
  disabled: boolean
  onSelect(mode: AgentInteractionMode): void | Promise<void>
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          variant='ghost'
          size='xs'
          className='shrink-0'
          disabled={props.disabled}
          aria-label={`Agent mode: ${INTERACTION_MODE_COPY[props.value].label}`}
          data-testid='agent-interaction-mode-selector'
        >
          <span>{INTERACTION_MODE_COPY[props.value].label}</span>
          <ChevronDown />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' side='top'>
        <DropdownMenuRadioGroup
          value={props.value}
          onValueChange={(value) => void props.onSelect(agentInteractionModeSchema.parse(value))}
        >
          {(['ask', 'plan', 'write'] as const).map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode} className='items-start'>
              <span className='min-w-0 pr-4'>
                <span className='block'>{INTERACTION_MODE_COPY[mode].label}</span>
                <span className='block text-xs text-muted-foreground'>
                  {INTERACTION_MODE_COPY[mode].description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ReviewBar(props: {
  proposal: MutationProposalRecord
  feedback: string
  busy: boolean
  outdated: boolean
  onFeedbackChange(value: string): void
  onAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject'
  ): Promise<void>
}): React.JSX.Element {
  if (props.outdated) {
    return (
      <div className='flex items-center justify-between gap-3' data-testid='agent-review-bar'>
        <p className='text-sm text-muted-foreground'>The manuscript changed after this proposal.</p>
        <Button
          disabled={props.busy}
          onClick={() => void props.onAction(props.proposal, 'approve')}
        >
          <RotateCcw data-icon='inline-start' /> Refresh proposal
        </Button>
      </div>
    )
  }
  return (
    <div className='flex min-w-0 flex-col gap-3' data-testid='agent-review-bar'>
      <Textarea
        value={props.feedback}
        rows={2}
        maxLength={4_096}
        placeholder='Describe what should change…'
        aria-label='Review feedback'
        disabled={props.busy}
        onChange={(event) => props.onFeedbackChange(event.target.value)}
      />
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='More review actions'
              disabled={props.busy}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={() => void props.onAction(props.proposal, 'approve')}>
              <Check /> Apply only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void props.onAction(props.proposal, 'reject')}>
              <X /> Reject proposal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant='outline'
          disabled={props.busy || props.feedback.trim().length === 0}
          onClick={() => void props.onAction(props.proposal, 'request_changes')}
        >
          Request changes
        </Button>
        <Button
          disabled={props.busy}
          onClick={() => void props.onAction(props.proposal, 'approve_continue')}
        >
          <Check data-icon='inline-start' /> Apply & continue
        </Button>
      </div>
    </div>
  )
}

export function AgentErrorAlert(props: { message: string; className?: string }): React.JSX.Element {
  return (
    <Alert variant='destructive' className={props.className}>
      <AlertCircle />
      <AlertTitle>Agent action failed</AlertTitle>
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  )
}

export function ComposerAction({
  label,
  ...props
}: Omit<React.ComponentProps<typeof InputGroupButton>, 'aria-label'> & {
  label: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <InputGroupButton aria-label={label} {...props} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
