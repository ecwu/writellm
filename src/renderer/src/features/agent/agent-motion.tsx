import { BorderBeam } from 'border-beam'
import { ThinkingOrb } from 'thinking-orbs'
import { useEffect, useState, type ReactNode } from 'react'
import { useTheme } from '@/theme-provider'
import type { AgentThinkingVisualState } from './agent-view-model'

export function AgentThinkingIndicator(props: {
  state: AgentThinkingVisualState
  testId?: string
}): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  return (
    <ThinkingOrb
      state={props.state}
      size={20}
      theme={resolvedTheme}
      role='presentation'
      aria-hidden='true'
      data-testid={props.testId ?? 'agent-thinking-indicator'}
      data-state={props.state}
      className='shrink-0'
    />
  )
}

export function AgentAttentionBeam(props: {
  attentionKey: string
  paused?: boolean
  children: ReactNode
}): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const [active, setActive] = useState(!props.paused)

  useEffect(() => {
    if (props.paused || props.attentionKey.length === 0) {
      setActive(false)
      return
    }
    setActive(true)
    const timer = window.setTimeout(() => setActive(false), 2_400)
    return () => window.clearTimeout(timer)
  }, [props.attentionKey, props.paused])

  return (
    <BorderBeam
      size='pulse-inner'
      colorVariant='mono'
      staticColors
      strength={0.5}
      duration={2.3}
      active={active}
      theme={resolvedTheme}
      borderRadius={8}
      className='min-w-0'
      data-testid='agent-review-attention'
      data-attention-active={active ? 'true' : 'false'}
    >
      <div className='min-w-0 rounded-lg border bg-background p-3'>{props.children}</div>
    </BorderBeam>
  )
}
