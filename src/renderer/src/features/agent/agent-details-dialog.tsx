import type { AgentRunRecord, AgentSessionRecord } from '../../../../shared/contracts/agent-ipc'
import type { AgentApprovalMode } from '../../../../shared/contracts/agent'
import type {
  AgentModelSelection,
  AgentProviderCatalog,
  AgentThinkingLevel
} from '../../../../shared/contracts/providers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import {
  AgentDiagnosticDetails,
  BoundedJsonDetails,
  elapsedRunMs,
  ToolActivityRow
} from './agent-event-timeline'
import { AgentModelPicker } from './agent-model-picker'
import { AgentThinkingPicker, thinkingLevelLabel } from './agent-thinking-picker'
import {
  formatAgentDuration,
  type latestAgentContextSnapshot,
  type AgentPresentation
} from './agent-view-model'
import { approvalModeLabel, humanizeSkillId } from './agent-panel-logic'

export function AgentDetailsDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  session: AgentSessionRecord | null
  activeRun: AgentRunRecord | null
  latestRun: AgentRunRecord | null
  presentation: AgentPresentation
  usage: {
    inputTokens: number
    outputTokens: number
    retryCount: number
    skillRouteRequests: number
  }
  usageDetails: string
  contextSnapshot: ReturnType<typeof latestAgentContextSnapshot>
  availableModelPresets: AgentProviderCatalog['presets']
  modelSelection: AgentModelSelection | null
  thinkingLevel: AgentThinkingLevel
  supportedThinkingLevels: AgentThinkingLevel[]
  modelReady: boolean
  busy: boolean
  onModelSelect(selection: AgentModelSelection): Promise<void>
  onThinkingSelect(level: AgentThinkingLevel): Promise<void>
  onApprovalModeSelect(mode: AgentApprovalMode): Promise<void>
}): React.JSX.Element {
  const { tools, providerMetadata, historicalDiagnostics } = props.presentation
  const readonly =
    props.busy || props.session?.status === 'archived' || props.session?.compatible === false
  const run = props.activeRun ?? props.latestRun
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Agent details</DialogTitle>
          <DialogDescription>
            Conversation settings, usage, and technical diagnostics.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-5'>
          <section className='grid gap-3'>
            <h3 className='text-sm font-semibold'>Conversation</h3>
            <div className='flex flex-wrap items-center gap-2'>
              <AgentModelPicker
                presets={props.availableModelPresets}
                selection={props.modelSelection}
                disabled={readonly}
                onSelect={props.onModelSelect}
              />
              <AgentThinkingPicker
                levels={props.supportedThinkingLevels}
                value={props.thinkingLevel}
                disabled={readonly || !props.modelReady}
                onSelect={props.onThinkingSelect}
              />
            </div>
            <div className='flex flex-wrap gap-2'>
              {(['manual', 'section_auto', 'yolo'] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={
                    (props.session?.approvalMode ?? 'manual') === mode ? 'secondary' : 'outline'
                  }
                  size='sm'
                  disabled={readonly}
                  onClick={() => void props.onApprovalModeSelect(mode)}
                >
                  {approvalModeLabel(mode)}
                </Button>
              ))}
            </div>
          </section>
          <SkillsUsedDetails run={run} />
          <section className='grid gap-3'>
            <h3 className='text-sm font-semibold'>Usage</h3>
            <dl className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm'>
              <dt className='text-muted-foreground'>Tokens</dt>
              <dd className='tabular-nums'>
                {props.usage.inputTokens.toLocaleString()} in ·{' '}
                {props.usage.outputTokens.toLocaleString()} out
              </dd>
              <dt className='text-muted-foreground'>Retries</dt>
              <dd>{props.usage.retryCount}</dd>
              <dt className='text-muted-foreground'>Run time</dt>
              <dd>{run ? formatAgentDuration(elapsedRunMs(run, Date.now())) : '—'}</dd>
              <dt className='text-muted-foreground'>Model</dt>
              <dd className='max-w-64 truncate'>
                {run ? `${run.providerLabel} · ${run.modelLabel}` : '—'}
              </dd>
              <dt className='text-muted-foreground'>Thinking</dt>
              <dd>{run ? thinkingLevelLabel(run.thinkingLevel) : '—'}</dd>
              <dt className='text-muted-foreground'>Error code</dt>
              <dd>{run?.errorCode ?? '—'}</dd>
            </dl>
            {run?.errorDetails === null || run?.errorDetails === undefined ? null : (
              <AgentDiagnosticDetails diagnostic={run.errorDetails} />
            )}
            {props.contextSnapshot ? (
              <div className='grid gap-2 text-xs text-muted-foreground'>
                <div className='flex justify-between gap-3'>
                  <span>Context</span>
                  <span className='tabular-nums'>
                    {props.contextSnapshot.estimated ? '~' : ''}
                    {props.contextSnapshot.used.toLocaleString()} /{' '}
                    {props.contextSnapshot.contextWindowTokens.toLocaleString()}
                  </span>
                </div>
                <Progress value={props.contextSnapshot.percent} />
              </div>
            ) : null}
            {props.usageDetails ? (
              <p className='text-xs text-muted-foreground'>{props.usageDetails}</p>
            ) : null}
          </section>
          <section className='grid gap-3'>
            <h3 className='text-sm font-semibold'>Technical activity</h3>
            {tools.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                No tool activity in this conversation.
              </p>
            ) : (
              <div className='grid gap-4'>
                {tools.map((tool) => (
                  <ToolActivityRow key={tool.eventId} tool={tool} />
                ))}
              </div>
            )}
            {providerMetadata === null ? null : (
              <BoundedJsonDetails label='Provider metadata' value={providerMetadata} />
            )}
            {historicalDiagnostics.map((event) => (
              <BoundedJsonDetails
                key={event.agentEventId}
                label={`Historical ${event.type} · ${event.sequence}`}
                value={event.payload}
              />
            ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SkillsUsedDetails(props: { run: AgentRunRecord | null }): React.JSX.Element {
  const snapshot = props.run?.skillSnapshot ?? null
  if (snapshot === null) {
    return (
      <section className='grid gap-3' aria-labelledby='agent-skills-used-heading'>
        <h3 id='agent-skills-used-heading' className='text-sm font-semibold'>
          Skills used
        </h3>
        <p className='text-sm text-muted-foreground'>No run has been recorded yet.</p>
      </section>
    )
  }
  const provenance = [...snapshot.skills, ...snapshot.dependencies]
  const names = new Map(provenance.map((skill) => [skill.skillId, skill.displayName] as const))
  return (
    <section className='grid gap-3' aria-labelledby='agent-skills-used-heading'>
      <div className='flex items-center justify-between gap-3'>
        <h3 id='agent-skills-used-heading' className='text-sm font-semibold'>
          Skills used
        </h3>
        <Badge variant='outline'>
          {snapshot.requestedSkills.length > 0
            ? `${snapshot.requestedSkills.length} requested · ${snapshot.skills.length} loaded`
            : `${snapshot.skills.length} loaded`}
        </Badge>
      </div>
      {snapshot.skills.length > 0 ? (
        <ol className='grid gap-1.5 text-sm'>
          {snapshot.skills.map((skill, index) => (
            <li key={skill.skillId} className='flex min-w-0 items-center gap-2'>
              <Badge variant='secondary' className='w-6 justify-center tabular-nums'>
                {index + 1}
              </Badge>
              <span className='min-w-0 flex-1 truncate'>{skill.displayName}</span>
              <Badge variant='outline' className='shrink-0'>
                {skill.invocationSource === 'user' ? 'Requested' : 'Discovered'}
              </Badge>
              <code className='shrink-0 text-xs text-muted-foreground'>
                {skill.commit.slice(0, 8)}
              </code>
            </li>
          ))}
        </ol>
      ) : (
        <p className='text-sm text-muted-foreground'>No Writing Skill was loaded.</p>
      )}
      {snapshot.dependencies.length > 0 ? (
        <div className='grid gap-1.5'>
          <p className='text-xs font-medium text-muted-foreground'>Dependencies</p>
          <ul className='grid gap-1 text-sm'>
            {snapshot.dependencies.map((skill) => (
              <li key={skill.skillId} className='flex min-w-0 items-center justify-between gap-3'>
                <span className='min-w-0 truncate'>{skill.displayName}</span>
                <code className='shrink-0 text-xs text-muted-foreground'>
                  {skill.commit.slice(0, 8)}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {snapshot.resources.length > 0 ? (
        <div className='grid gap-1.5'>
          <p className='text-xs font-medium text-muted-foreground'>Retained references</p>
          <ul className='grid gap-1 text-sm'>
            {snapshot.resources.map((resource) => (
              <li
                key={`${resource.skillId}-${resource.commit}-${resource.relativePath}`}
                className='min-w-0 truncate'
                title={resource.relativePath}
              >
                <span>{names.get(resource.skillId) ?? humanizeSkillId(resource.skillId)}</span>
                <span className='text-muted-foreground'> · {resource.relativePath}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
