import { Brain, ChevronDown } from 'lucide-react'
import {
  agentThinkingLevelSchema,
  type AgentThinkingLevel
} from '../../../../shared/contracts/providers'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export function AgentThinkingPicker({
  levels,
  value,
  disabled,
  onSelect
}: {
  levels: AgentThinkingLevel[]
  value: AgentThinkingLevel
  disabled: boolean
  onSelect: (level: AgentThinkingLevel) => void | Promise<void>
}): React.JSX.Element {
  const unavailable = levels.length === 1 && levels[0] === 'off'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='h-7'
          aria-label={`Thinking level: ${thinkingLevelLabel(value)}`}
          data-testid='agent-thinking-selector'
          disabled={disabled || unavailable}
          title={unavailable ? 'Thinking controls are unavailable for this model' : undefined}
        >
          <Brain />
          <span className='hidden @sm/agent:inline'>Thinking: {thinkingLevelLabel(value)}</span>
          <ChevronDown data-icon='inline-end' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' data-testid='agent-thinking-menu'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(level) => void onSelect(agentThinkingLevelSchema.parse(level))}
        >
          {levels.map((level) => (
            <DropdownMenuRadioItem key={level} value={level}>
              {thinkingLevelLabel(level)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function thinkingLevelLabel(level: AgentThinkingLevel): string {
  if (level === 'off') return 'Off'
  if (level === 'xhigh') return 'Extra high'
  if (level === 'max') return 'Max'
  return `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`
}
