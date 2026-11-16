import { Check, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  AgentModelSelection,
  AgentThinkingLevel
} from '../../../../shared/contracts/providers'
import { ProviderLogo } from '@/components/provider-logo'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { InputGroupButton } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AgentModelPickerPanel, focusModelSearch } from './agent-model-picker-panel'
import {
  type AvailableAgentPreset as AvailablePreset,
  findAgentModelSelection as findSelection
} from './agent-model-selection'
import { thinkingLevelLabel } from './agent-thinking-picker'

export function AgentModelEffortPicker({
  presets,
  selection,
  levels,
  effort,
  disabled,
  onModelSelect,
  onEffortSelect
}: {
  presets: AvailablePreset[]
  selection: AgentModelSelection | null
  levels: AgentThinkingLevel[]
  effort: AgentThinkingLevel
  disabled: boolean
  onModelSelect: (selection: AgentModelSelection) => void | Promise<void>
  onEffortSelect: (level: AgentThinkingLevel) => void | Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => findSelection(presets, selection), [presets, selection])
  const label = modelEffortLabel(selected?.model.name ?? null, effort, levels)

  // Choosing a model keeps the picker open so its reasoning level can be chosen next.
  const chooseModel = (next: AgentModelSelection): void => {
    void onModelSelect(next)
  }

  const chooseEffort = (level: AgentThinkingLevel): void => {
    setOpen(false)
    void onEffortSelect(level)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <InputGroupButton
          size='sm'
          className='min-w-0 max-w-56 flex-1 justify-start'
          aria-label={`Model and effort: ${label}`}
          data-testid='agent-model-selector'
          disabled={disabled}
        >
          {selected === null ? null : (
            <ProviderLogo logoId={selected.preset.logoId} name={selected.preset.name} size='sm' />
          )}
          <span className='min-w-0 flex-1 truncate text-left'>{label}</span>
          <ChevronDown data-icon='inline-end' />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        side='top'
        className='w-xl max-w-[calc(100vw-2rem)] overflow-hidden p-0'
        data-testid='agent-model-effort-picker'
        onOpenAutoFocus={focusModelSearch}
      >
        <AgentModelPickerPanel
          presets={presets}
          selection={selection}
          onModelSelect={chooseModel}
          trailing={
            <EffortColumn
              modelName={selected?.model.name ?? null}
              levels={levels}
              effort={effort}
              onSelect={chooseEffort}
            />
          }
        />
      </PopoverContent>
    </Popover>
  )
}

function EffortColumn(props: {
  modelName: string | null
  levels: readonly AgentThinkingLevel[]
  effort: AgentThinkingLevel
  onSelect(level: AgentThinkingLevel): void
}): React.JSX.Element {
  const unavailable = props.modelName === null || effortUnavailable(props.levels)
  return (
    <div
      className='flex w-44 shrink-0 flex-col border-l bg-muted/30'
      data-testid='agent-effort-options'
    >
      <div className='flex h-9 shrink-0 items-center gap-2 border-b px-3'>
        <span className='text-sm font-medium'>Reasoning</span>
        <span className='min-w-0 flex-1 truncate text-right text-xs text-muted-foreground'>
          {props.modelName}
        </span>
      </div>
      {unavailable ? (
        <p className='p-3 text-sm text-muted-foreground'>
          {props.modelName === null
            ? 'Choose a model first.'
            : 'This model has no reasoning levels.'}
        </p>
      ) : (
        <Command
          key={props.levels.join(',')}
          label='Reasoning'
          defaultValue={props.effort}
          tabIndex={0}
          className='rounded-none bg-transparent'
        >
          <CommandList className='max-h-none'>
            <CommandGroup>
              {props.levels.map((level) => (
                <CommandItem
                  key={level}
                  value={level}
                  data-checked={level === props.effort}
                  onSelect={() => props.onSelect(level)}
                >
                  <span className='min-w-0 flex-1'>{thinkingLevelLabel(level)}</span>
                  {level === props.effort ? <Check /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </div>
  )
}

function effortUnavailable(levels: readonly AgentThinkingLevel[]): boolean {
  return levels.length === 1 && levels[0] === 'off'
}

export function modelEffortLabel(
  modelName: string | null,
  effort: AgentThinkingLevel,
  levels: readonly AgentThinkingLevel[]
): string {
  if (modelName === null) return 'Choose a model'
  return effortUnavailable(levels) ? modelName : `${modelName} ${effort}`
}
