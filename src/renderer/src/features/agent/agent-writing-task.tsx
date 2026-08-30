import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDotDashed,
  CircleMinus,
  Pencil,
  Play,
  Plus,
  TriangleAlert,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme-provider'
import { buildWritingTaskChangeSet } from './agent-view-model'
import { ProposalPresentation } from './proposal-presentation'
import {
  MAX_WRITING_TASK_STEPS,
  type WritingTaskProgressState,
  type WritingTaskStepStatus,
  type WritingTaskView
} from '../../../../shared/contracts/writing-task'
import type { ChangeSetBatchResult } from '../../../../shared/contracts/agent-change-set'
import { writingTaskDockSummary, writingTaskNeedsAttention } from './agent-panel-logic'

interface WritingTaskDraftStep {
  key: string
  stepId?: string
  title: string
  status: WritingTaskStepStatus
  statusReason: string | null
}

export function WritingTaskDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  task: WritingTaskView | null
  busy: boolean
  onSave(input: {
    taskId: string
    expectedPlanVersion: number
    objective: string
    steps: WritingTaskDraftStep[]
  }): Promise<void>
}): React.JSX.Element {
  const [objective, setObjective] = useState('')
  const [steps, setSteps] = useState<WritingTaskDraftStep[]>([])

  useEffect(() => {
    if (!props.open || props.task === null) return
    setObjective(props.task.objective)
    setSteps(
      props.task.plan.steps.map((step) => ({
        key: step.stepId,
        stepId: step.stepId,
        title: step.title,
        status: step.status,
        statusReason: step.statusReason
      }))
    )
  }, [props.open, props.task])

  const validation = writingTaskDraftValidation(objective, steps)
  const updateStep = (key: string, update: Partial<WritingTaskDraftStep>): void => {
    setSteps((current) =>
      current.map((step) => {
        if (step.key !== key) return step
        const next = { ...step, ...update }
        if (next.status !== 'blocked' && next.status !== 'skipped') next.statusReason = null
        return next
      })
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[min(85vh,48rem)] sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Revise writing task</DialogTitle>
          <DialogDescription>
            Update collaboration steps while the conversation is idle. Manuscript and proposal
            outcomes remain authoritative.
          </DialogDescription>
        </DialogHeader>
        <div className='flex min-h-0 flex-col gap-5 overflow-y-auto px-1 py-1'>
          <Field>
            <FieldLabel htmlFor='writing-task-objective'>Objective</FieldLabel>
            <Textarea
              id='writing-task-objective'
              value={objective}
              maxLength={4_096}
              rows={3}
              disabled={props.busy}
              onChange={(event) => setObjective(event.target.value)}
            />
            <FieldDescription>
              Describe the single outcome this conversation is pursuing.
            </FieldDescription>
          </Field>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between gap-3'>
              <h3 className='text-sm font-medium'>Plan steps</h3>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={props.busy || steps.length >= MAX_WRITING_TASK_STEPS}
                onClick={() =>
                  setSteps((current) => [
                    ...current,
                    {
                      key: `new-${current.filter((step) => step.stepId === undefined).length + 1}`,
                      title: '',
                      status: current.some((step) => step.status === 'active')
                        ? 'pending'
                        : 'active',
                      statusReason: null
                    }
                  ])
                }
              >
                <Plus data-icon='inline-start' /> Add step
              </Button>
            </div>
            <ol className='flex flex-col gap-4'>
              {steps.map((step, index) => {
                const immutable =
                  step.stepId !== undefined &&
                  (props.task?.plan.steps.find((candidate) => candidate.stepId === step.stepId)
                    ?.status === 'completed' ||
                    props.task?.plan.steps.find((candidate) => candidate.stepId === step.stepId)
                      ?.status === 'skipped')
                const statuses = allowedUserStepStatuses(step, props.task)
                return (
                  <li key={step.key} className='grid min-w-0 gap-3 sm:grid-cols-[1fr_10rem]'>
                    <Field>
                      <FieldLabel htmlFor={`writing-task-step-${step.key}`}>
                        Step {index + 1}
                      </FieldLabel>
                      <Input
                        id={`writing-task-step-${step.key}`}
                        value={step.title}
                        maxLength={500}
                        disabled={props.busy || immutable}
                        onChange={(event) => updateStep(step.key, { title: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Status</FieldLabel>
                      <Select
                        value={step.status}
                        disabled={props.busy || statuses.length === 1}
                        onValueChange={(value) =>
                          updateStep(step.key, { status: value as WritingTaskStepStatus })
                        }
                      >
                        <SelectTrigger aria-label={`Status for step ${index + 1}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statuses.map((status) => (
                            <SelectItem key={status} value={status}>
                              {writingTaskProgressLabel(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {step.status === 'blocked' || step.status === 'skipped' ? (
                      <Field className='sm:col-span-2'>
                        <FieldLabel htmlFor={`writing-task-reason-${step.key}`}>
                          {step.status === 'blocked' ? 'Blocker' : 'Reason for skipping'}
                        </FieldLabel>
                        <Textarea
                          id={`writing-task-reason-${step.key}`}
                          value={step.statusReason ?? ''}
                          maxLength={2_000}
                          rows={2}
                          disabled={props.busy}
                          onChange={(event) =>
                            updateStep(step.key, { statusReason: event.target.value })
                          }
                        />
                      </Field>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </div>
          {validation !== null ? (
            <Alert variant='destructive'>
              <TriangleAlert />
              <AlertTitle>Plan needs attention</AlertTitle>
              <AlertDescription>{validation}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button
            disabled={props.busy || props.task === null || validation !== null}
            onClick={() => {
              if (props.task === null || validation !== null) return
              void props.onSave({
                taskId: props.task.taskId,
                expectedPlanVersion: props.task.planVersion,
                objective: objective.trim(),
                steps: steps.map((step) => ({
                  ...step,
                  title: step.title.trim(),
                  statusReason: step.statusReason?.trim() || null
                }))
              })
            }}
          >
            {props.busy ? <Spinner data-icon='inline-start' /> : <Check data-icon='inline-start' />}
            Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function writingTaskDraftValidation(
  objective: string,
  steps: WritingTaskDraftStep[]
): string | null {
  if (objective.trim().length === 0) return 'Add a task objective.'
  if (steps.length === 0) return 'Add at least one plan step.'
  if (steps.some((step) => step.title.trim().length === 0)) return 'Every step needs a title.'
  if (
    steps.some(
      (step) =>
        (step.status === 'blocked' || step.status === 'skipped') &&
        (step.statusReason === null || step.statusReason.trim().length === 0)
    )
  ) {
    return 'Blocked and skipped steps need a reason.'
  }
  const activeCount = steps.filter((step) => step.status === 'active').length
  if (activeCount > 1) return 'Only one step can be active.'
  if (steps.some((step) => step.status === 'pending') && activeCount !== 1) {
    return 'Choose one active step while pending work remains.'
  }
  return null
}

function allowedUserStepStatuses(
  step: WritingTaskDraftStep,
  task: WritingTaskView | null
): WritingTaskStepStatus[] {
  if (step.stepId === undefined) return ['pending', 'active']
  const original = task?.plan.steps.find((candidate) => candidate.stepId === step.stepId)?.status
  const allowed: Record<WritingTaskStepStatus, WritingTaskStepStatus[]> = {
    pending: ['pending', 'active', 'skipped', 'blocked'],
    active: ['active', 'completed', 'skipped', 'blocked'],
    completed: ['completed'],
    skipped: ['skipped'],
    blocked: ['blocked', 'active', 'skipped']
  }
  return allowed[original ?? step.status]
}

function writingTaskProgressLabel(state: WritingTaskProgressState | WritingTaskStepStatus): string {
  const labels: Record<WritingTaskProgressState | WritingTaskStepStatus, string> = {
    pending: 'Pending',
    active: 'Active',
    completed: 'Completed',
    skipped: 'Skipped',
    blocked: 'Blocked',
    ready: 'Ready',
    in_progress: 'In progress',
    awaiting_review: 'Review',
    verified_complete: 'Verified',
    reported_complete: 'Reported',
    stopped: 'Stopped',
    failed: 'Failed',
    disagreement: 'Needs reconciliation'
  }
  return labels[state]
}

const CHANGE_SET_STATUSES: MutationProposalRecord['status'][] = [
  'pending',
  'generating',
  'approved',
  'applied',
  'satisfied',
  'superseded',
  'conflicted',
  'rejected',
  'failed',
  'undone'
]

export function WritingTaskProgressDock(props: {
  task: WritingTaskView
  projectSessionId: string
  proposals: MutationProposalRecord[]
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  canControl: boolean
  busy: boolean
  onEdit(): void
  onResume(): Promise<void>
  onBatch(input: {
    taskId: string
    proposalIds: string[]
    action: 'apply' | 'reject'
    rejectReason: string | null
    createCheckpoint: boolean
  }): Promise<ChangeSetBatchResult>
}): React.JSX.Element {
  const needsAttention = writingTaskNeedsAttention(props.task)
  const [open, setOpen] = useState(needsAttention)
  const proposalNavigationRef = useRef<string | null>(null)
  const summary = writingTaskDockSummary(props.task)
  const titleId = `agent-writing-task-title-${props.task.taskId}`
  const currentProgress =
    props.task.progress.steps.find(
      (progress) => progress.stepId === props.task.progress.currentStepId
    ) ?? null
  const currentStep =
    props.task.plan.steps.find((step) => step.stepId === props.task.progress.currentStepId) ?? null

  useEffect(() => {
    if (needsAttention) setOpen(true)
  }, [needsAttention])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='group/task shrink-0 border-t bg-muted/20'
      data-testid='agent-writing-task'
      data-attention={needsAttention ? 'true' : 'false'}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant='ghost'
          className='h-auto min-h-11 w-full min-w-0 justify-start rounded-none px-4 py-2 text-left'
          aria-label={summary.ariaLabel}
          data-testid='agent-writing-task-trigger'
        >
          {props.task.progress.hasDisagreement ? (
            <TriangleAlert className='shrink-0 text-destructive' />
          ) : summary.complete ? (
            <CircleCheck className='shrink-0 text-success' />
          ) : currentProgress === null ? (
            <TriangleAlert className='shrink-0 text-warning' />
          ) : (
            <WritingTaskStateIcon state={currentProgress.state} inButton />
          )}
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium'>
              {currentStep?.title ?? props.task.objective}
            </span>
            <span className='block truncate text-xs font-normal text-muted-foreground'>
              {summary.label} · {props.task.objective}
            </span>
          </span>
          <ChevronDown className='shrink-0 transition-transform group-data-[state=open]/task:rotate-180 motion-reduce:transition-none' />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        className='border-t bg-background'
        data-testid='agent-writing-task-details'
      >
        <div className='max-h-[min(38vh,24rem)] overflow-y-auto overscroll-contain'>
          <div className='flex min-w-0 items-start gap-2 px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <h3 id={titleId} className='line-clamp-3 text-sm font-medium leading-snug'>
                {props.task.objective}
              </h3>
              <Badge variant='outline' className='mt-2'>
                Plan v{props.task.planVersion}
              </Badge>
            </div>
            <div className='flex shrink-0 items-center gap-1'>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Revise writing task plan'
                disabled={!props.canControl}
                onClick={() => {
                  props.onEdit()
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Resume writing task'
                disabled={!props.canControl || props.task.progress.currentStepId === null}
                onClick={() => {
                  void props.onResume()
                }}
              >
                <Play />
              </Button>
            </div>
          </div>
          <div>
            <section className='px-4 pb-3' aria-label='Plan steps'>
              <ol className='flex flex-col gap-2'>
                {props.task.plan.steps.map((step, index) => {
                  const progress = props.task.progress.steps.find(
                    (candidate) => candidate.stepId === step.stepId
                  )
                  const state = progress?.state ?? step.status
                  const current = props.task.progress.currentStepId === step.stepId
                  return (
                    <li
                      key={step.stepId}
                      className='flex min-w-0 items-start gap-2 text-sm'
                      aria-current={current ? 'step' : undefined}
                    >
                      <WritingTaskStateIcon state={state} />
                      <span className='min-w-0 flex-1'>
                        <span className='sr-only'>{writingTaskProgressLabel(state)}. </span>
                        <span className='line-clamp-2'>
                          {index + 1}. {step.title}
                        </span>
                        {step.statusReason !== null ? (
                          <span className='line-clamp-2 text-xs text-muted-foreground'>
                            {step.statusReason}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ol>
              {props.task.progress.hasDisagreement ? (
                <p className='mt-3 flex items-start gap-1.5 text-xs text-destructive'>
                  <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
                  Plan status disagrees with a run or manuscript outcome. Revise or resume to
                  reconcile it.
                </p>
              ) : null}
            </section>
            <WritingTaskChangeSetPanel
              task={props.task}
              projectSessionId={props.projectSessionId}
              proposals={props.proposals}
              currentRevisionIds={props.currentRevisionIds}
              sectionTitles={props.sectionTitles}
              busy={props.busy}
              onBatch={props.onBatch}
              onNavigate={(proposalId) => {
                proposalNavigationRef.current = proposalId
                setOpen(false)
                requestAnimationFrame(() => {
                  const target = document.querySelector<HTMLElement>(
                    `[data-testid="agent-proposal-${proposalId}"]`
                  )
                  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  target?.focus({ preventScroll: true })
                  proposalNavigationRef.current = null
                })
              }}
              onOverlayOpenChange={() => {}}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function WritingTaskStateIcon(props: {
  state: WritingTaskProgressState | WritingTaskStepStatus
  inButton?: boolean
}): React.JSX.Element {
  const size = props.inButton ? undefined : 'size-4'
  if (props.state === 'in_progress') {
    return <Spinner className={cn('shrink-0', size)} aria-hidden='true' />
  }
  if (props.state === 'completed' || props.state === 'verified_complete') {
    return <CircleCheck className={cn('shrink-0 text-success', size)} aria-hidden='true' />
  }
  if (props.state === 'reported_complete' || props.state === 'ready' || props.state === 'active') {
    return (
      <CircleDotDashed className={cn('shrink-0 text-muted-foreground', size)} aria-hidden='true' />
    )
  }
  if (props.state === 'awaiting_review' || props.state === 'blocked' || props.state === 'stopped') {
    return <AlertCircle className={cn('shrink-0 text-warning', size)} aria-hidden='true' />
  }
  if (props.state === 'failed' || props.state === 'disagreement') {
    return <TriangleAlert className={cn('shrink-0 text-destructive', size)} aria-hidden='true' />
  }
  if (props.state === 'skipped') {
    return <CircleMinus className={cn('shrink-0 text-muted-foreground', size)} aria-hidden='true' />
  }
  return <Circle className={cn('shrink-0 text-muted-foreground', size)} aria-hidden='true' />
}

function WritingTaskChangeSetPanel(props: {
  task: WritingTaskView
  projectSessionId: string
  proposals: MutationProposalRecord[]
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  busy: boolean
  onBatch(input: {
    taskId: string
    proposalIds: string[]
    action: 'apply' | 'reject'
    rejectReason: string | null
    createCheckpoint: boolean
  }): Promise<ChangeSetBatchResult>
  onNavigate(proposalId: string): void
  onOverlayOpenChange(open: boolean): void
}): React.JSX.Element | null {
  const { resolvedTheme } = useTheme()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [createCheckpoint, setCreateCheckpoint] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [result, setResult] = useState<ChangeSetBatchResult | null>(null)
  const stepTitles = useMemo(
    () => Object.fromEntries(props.task.plan.steps.map((step) => [step.stepId, step.title])),
    [props.task.plan.steps]
  )
  const changeSet = useMemo(
    () =>
      buildWritingTaskChangeSet({
        taskId: props.task.taskId,
        proposals: props.proposals,
        currentRevisionIds: props.currentRevisionIds,
        sectionTitles: props.sectionTitles,
        stepTitles
      }),
    [props.currentRevisionIds, props.proposals, props.sectionTitles, props.task.taskId, stepTitles]
  )
  if (changeSet.proposalCount === 0) return null
  const selectableIds = changeSet.groups.flatMap((group) =>
    group.entries.flatMap((entry) =>
      entry.proposal.status === 'pending' ? [entry.proposal.proposalId] : []
    )
  )
  const selectedIds = selectableIds.filter((proposalId) => selected.has(proposalId))

  const runBatch = async (action: 'apply' | 'reject'): Promise<void> => {
    if (selectedIds.length === 0) return
    const next = await props.onBatch({
      taskId: props.task.taskId,
      proposalIds: selectedIds,
      action,
      rejectReason: action === 'reject' ? rejectReason.trim() : null,
      createCheckpoint: action === 'apply' && createCheckpoint
    })
    setResult(next)
    setSelected(new Set())
    if (action === 'reject') {
      setRejectOpen(false)
      props.onOverlayOpenChange(false)
      setRejectReason('')
    }
  }

  const navigateToProposal = (proposalId: string): void => {
    props.onNavigate(proposalId)
  }

  return (
    <Collapsible className='group/change-set border-t' data-testid='agent-writing-change-set'>
      <div className='flex min-h-11 items-center gap-2 px-3 py-2'>
        <CollapsibleTrigger className='flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]/change-set:rotate-90' />
          <span className='min-w-0 flex-1 truncate text-sm font-medium'>Task change set</span>
          <Badge variant='outline'>{changeSet.proposalCount}</Badge>
        </CollapsibleTrigger>
        {changeSet.staleCount > 0 ? (
          <Badge variant='warning'>{changeSet.staleCount} need refresh</Badge>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className='flex flex-col gap-3 px-3 pb-3'>
          {selectableIds.length > 0 ? (
            <div className='flex flex-wrap items-center gap-2 border-b pb-3'>
              <Button
                size='sm'
                disabled={props.busy || selectedIds.length === 0}
                onClick={() => void runBatch('apply')}
              >
                <Check data-icon='inline-start' /> Apply selected
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={props.busy || selectedIds.length === 0}
                onClick={() => {
                  setRejectOpen(true)
                  props.onOverlayOpenChange(true)
                }}
              >
                <X data-icon='inline-start' /> Reject selected
              </Button>
              <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                <Checkbox
                  aria-label='Create history checkpoint if available'
                  checked={createCheckpoint}
                  onCheckedChange={(checked) => setCreateCheckpoint(checked === true)}
                />
                Create history checkpoint if available
              </span>
              <span className='ml-auto text-xs text-muted-foreground'>
                {selectedIds.length} selected
              </span>
            </div>
          ) : null}
          {result === null ? null : (
            <Alert variant={result.status === 'completed' ? 'default' : 'destructive'}>
              {result.status === 'completed' ? <Check /> : <TriangleAlert />}
              <AlertTitle>
                {result.status === 'completed' ? 'Batch complete' : 'Batch partially complete'}
              </AlertTitle>
              <AlertDescription>
                {result.completedCount} processed · {result.remainingCount} not attempted ·{' '}
                {result.review.appliedCount} applied · {result.review.satisfiedCount} already
                satisfied · {result.review.rejectedCount} rejected
                {result.checkpointStatus === 'created' ? ' · checkpoint created' : ''}
                {result.checkpointStatus === 'unavailable'
                  ? ' · version history was unavailable'
                  : ''}
                {result.checkpointStatus === 'failed'
                  ? ' · checkpoint failed, so no proposal was attempted'
                  : ''}
              </AlertDescription>
            </Alert>
          )}
          <fieldset className='flex flex-wrap gap-1' aria-label='Proposal outcome summary'>
            {CHANGE_SET_STATUSES.flatMap((status) => {
              const count = changeSet.statusCounts[status] ?? 0
              return count === 0
                ? []
                : [
                    <Badge
                      key={status}
                      variant={status === 'conflicted' ? 'destructive' : 'outline'}
                    >
                      {status.replace('_', ' ')} {count}
                    </Badge>
                  ]
            })}
          </fieldset>
          {changeSet.groups.map((group) => (
            <section
              key={group.key}
              className='flex min-w-0 flex-col gap-2'
              aria-label={group.label}
            >
              <h4 className='text-xs font-medium text-muted-foreground'>{group.label}</h4>
              {group.entries.map((entry) => {
                const preview = entry.proposal.payload.preview
                return (
                  <Collapsible
                    key={entry.proposal.proposalId}
                    className='group/change rounded-md border px-3 py-2'
                    data-testid={`agent-change-set-proposal-${entry.proposal.proposalId}`}
                  >
                    <div className='flex min-w-0 items-start gap-2'>
                      {entry.proposal.status === 'pending' ? (
                        <Checkbox
                          className='mt-0.5'
                          aria-label={`Select ${preview.summary}`}
                          checked={selected.has(entry.proposal.proposalId)}
                          disabled={props.busy}
                          onCheckedChange={(checked) => {
                            setSelected((current) => {
                              const next = new Set(current)
                              if (checked === true) next.add(entry.proposal.proposalId)
                              else next.delete(entry.proposal.proposalId)
                              return next
                            })
                          }}
                        />
                      ) : null}
                      <CollapsibleTrigger className='flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                        <ChevronRight className='mt-0.5 size-3.5 shrink-0 transition-transform group-data-[state=open]/change:rotate-90' />
                        <span className='min-w-0 flex-1'>
                          <span className='line-clamp-2 text-xs font-medium'>
                            {preview.summary}
                          </span>
                          {entry.stepTitle === null ? null : (
                            <span className='line-clamp-1 text-xs text-muted-foreground'>
                              {entry.stepTitle}
                            </span>
                          )}
                        </span>
                      </CollapsibleTrigger>
                      <Badge variant={entry.stale ? 'warning' : 'outline'}>
                        {entry.stale ? 'refresh required' : entry.proposal.status.replace('_', ' ')}
                      </Badge>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => navigateToProposal(entry.reviewProposalId)}
                      >
                        Review
                      </Button>
                    </div>
                    <CollapsibleContent className='pt-3'>
                      <ProposalPresentation
                        proposal={entry.proposal}
                        projectSessionId={props.projectSessionId}
                        sectionTitles={props.sectionTitles}
                        dark={resolvedTheme === 'dark'}
                        compact
                      />
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </section>
          ))}
        </div>
      </CollapsibleContent>
      <Dialog
        open={rejectOpen}
        onOpenChange={(nextOpen) => {
          setRejectOpen(nextOpen)
          props.onOverlayOpenChange(nextOpen)
          if (!nextOpen) setRejectReason('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject selected proposals</DialogTitle>
            <DialogDescription>
              The same bounded reason is recorded on each selected proposal. Completed decisions are
              not rolled back if a later item fails.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='change-set-reject-reason'>Reason</FieldLabel>
            <Textarea
              id='change-set-reject-reason'
              value={rejectReason}
              maxLength={4_096}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setRejectOpen(false)
                props.onOverlayOpenChange(false)
                setRejectReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              disabled={props.busy || rejectReason.trim().length === 0}
              onClick={() => void runBatch('reject')}
            >
              Reject {selectedIds.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  )
}
