/* biome-ignore-all lint/a11y/noNoninteractiveTabindex: the read-only status must be focusable so keyboard users can open its tooltip. */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentContextSnapshot } from './agent-view-model'

const RING_RADIUS = 7
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export interface AgentContextUsageDisplay {
  usedPercent: number
  leftPercent: number
  percentageLabel: string
  tokensLabel: string
  ariaValueText: string
}

export function AgentContextUsageIndicator(props: {
  snapshot: AgentContextSnapshot | null
}): React.JSX.Element | null {
  if (props.snapshot === null) return null
  const display = agentContextUsageDisplay(props.snapshot)
  const offset = RING_CIRCUMFERENCE * (1 - props.snapshot.percent / 100)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className='inline-flex size-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
          role='progressbar'
          aria-label='Context window'
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={display.usedPercent}
          aria-valuetext={display.ariaValueText}
          tabIndex={0}
          data-testid='agent-context-usage'
        >
          <svg
            className='size-4 -rotate-90'
            viewBox='0 0 16 16'
            aria-hidden='true'
            focusable='false'
          >
            <circle
              className='fill-none stroke-muted'
              cx='8'
              cy='8'
              r={RING_RADIUS}
              strokeWidth='2.5'
            />
            <circle
              className='fill-none stroke-muted-foreground'
              cx='8'
              cy='8'
              r={RING_RADIUS}
              strokeWidth='2.5'
              strokeLinecap='round'
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top' className='grid gap-0.5 px-3 py-2 text-center'>
        <span className='text-background/70'>Context window</span>
        <span className='font-medium tabular-nums'>{display.percentageLabel}</span>
        <span className='tabular-nums'>{display.tokensLabel}</span>
      </TooltipContent>
    </Tooltip>
  )
}

export function agentContextUsageDisplay(snapshot: AgentContextSnapshot): AgentContextUsageDisplay {
  const usedPercent = Math.round(Math.min(100, Math.max(0, snapshot.percent)))
  const leftPercent = Math.max(0, 100 - usedPercent)
  const estimateMarker = snapshot.estimated ? '~' : ''
  const estimateWord = snapshot.estimated ? 'Estimated ' : ''
  return {
    usedPercent,
    leftPercent,
    percentageLabel: `${estimateMarker}${usedPercent}% used (${estimateMarker}${leftPercent}% left)`,
    tokensLabel: `${estimateMarker}${formatCompactTokens(snapshot.used)} / ${formatCompactTokens(snapshot.contextWindowTokens)} tokens used`,
    ariaValueText: `${estimateWord}${usedPercent}% used, ${leftPercent}% left. ${snapshot.used.toLocaleString('en')} of ${snapshot.contextWindowTokens.toLocaleString('en')} tokens used.`
  }
}

function formatCompactTokens(tokens: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 0
  })
    .format(tokens)
    .toLowerCase()
}
