import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentModelSelection } from '../../../../shared/contracts/providers'
import { ProviderLogo } from '@/components/provider-logo'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AgentModelPickerPanel, focusModelSearch } from './agent-model-picker-panel'
import {
  type AvailableAgentPreset as AvailablePreset,
  findAgentModelSelection as findSelection
} from './agent-model-selection'

export function AgentModelPicker({
  presets,
  selection,
  disabled,
  compact = false,
  onSelect
}: {
  presets: AvailablePreset[]
  selection: AgentModelSelection | null
  disabled: boolean
  compact?: boolean
  onSelect: (selection: AgentModelSelection) => void | Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => findSelection(presets, selection), [presets, selection])

  const chooseModel = (next: AgentModelSelection): void => {
    setOpen(false)
    void onSelect(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={compact ? 'ghost' : 'outline'}
          size='sm'
          className={
            compact
              ? 'h-6 min-w-0 max-w-40 justify-start px-2'
              : 'h-7 min-w-0 max-w-full justify-start @sm/agent:max-w-72'
          }
          aria-label='Agent model'
          data-testid='agent-model-selector'
          disabled={disabled}
        >
          {selected === null ? null : (
            <ProviderLogo logoId={selected.preset.logoId} name={selected.preset.name} size='sm' />
          )}
          <span className='min-w-0 flex-1 truncate text-left'>
            {selected === null
              ? 'Choose a model'
              : compact
                ? selected.model.name
                : `${selected.preset.name} · ${selected.model.name}`}
          </span>
          <ChevronDown data-icon='inline-end' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={compact ? 'end' : 'start'}
        side={compact ? 'top' : 'bottom'}
        className='w-sm max-w-[calc(100vw-2rem)] overflow-hidden p-0'
        data-testid='agent-model-picker'
        onOpenAutoFocus={focusModelSearch}
      >
        <AgentModelPickerPanel
          presets={presets}
          selection={selection}
          onModelSelect={chooseModel}
        />
      </PopoverContent>
    </Popover>
  )
}
