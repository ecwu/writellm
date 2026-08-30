import { ArrowLeft, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  AgentModelSelection,
  AgentThinkingLevel
} from '../../../../shared/contracts/providers'
import { ProviderLogo } from '@/components/provider-logo'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { InputGroupButton } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { thinkingLevelLabel } from './agent-thinking-picker'
import {
  type AvailableAgentPreset as AvailablePreset,
  findAgentModelSelection as findSelection
} from './agent-model-selection'

type PickerView = 'summary' | 'models' | 'effort'

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
  const [view, setView] = useState<PickerView>('summary')
  const selected = useMemo(() => findSelection(presets, selection), [presets, selection])
  const effortUnavailable = levels.length === 1 && levels[0] === 'off'

  const changeOpen = (next: boolean): void => {
    if (next) setView('summary')
    setOpen(next)
  }

  const chooseModel = (presetId: string, modelId: string): void => {
    setOpen(false)
    void onModelSelect({ presetId, modelId })
  }

  const chooseEffort = (level: AgentThinkingLevel): void => {
    setOpen(false)
    void onEffortSelect(level)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <InputGroupButton
          size='sm'
          className='min-w-0 max-w-48 flex-1 justify-start'
          aria-label={`Model and effort: ${modelEffortLabel(selected?.model.name ?? null, effort, levels)}`}
          data-testid='agent-model-selector'
          disabled={disabled}
        >
          <span className='min-w-0 flex-1 truncate text-left'>
            {modelEffortLabel(selected?.model.name ?? null, effort, levels)}
          </span>
          <ChevronDown data-icon='inline-end' />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        side='top'
        className='w-80 max-w-[calc(100vw-2rem)] p-0'
        data-testid='agent-model-effort-picker'
      >
        {view === 'summary' ? (
          <Command>
            <CommandList>
              <CommandGroup heading='Model and effort'>
                <CommandItem value='choose model' onSelect={() => setView('models')}>
                  <span className='min-w-0 flex-1'>Model</span>
                  <span className='max-w-44 truncate text-muted-foreground'>
                    {selected?.model.name ?? 'Choose a model'}
                  </span>
                  <ChevronRight />
                </CommandItem>
                <CommandItem
                  value='choose effort'
                  disabled={effortUnavailable}
                  onSelect={() => setView('effort')}
                  data-testid='agent-thinking-selector'
                >
                  <span className='min-w-0 flex-1'>Effort</span>
                  <span className='text-muted-foreground'>
                    {effortUnavailable ? 'Unavailable' : effort}
                  </span>
                  {effortUnavailable ? null : <ChevronRight />}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        ) : view === 'models' ? (
          <Command>
            <PickerHeader label='Model' onBack={() => setView('summary')} />
            <CommandInput placeholder='Search models…' />
            <CommandList>
              <CommandEmpty>No available models.</CommandEmpty>
              {presets.map((preset) => (
                <CommandGroup key={preset.presetId} heading={preset.name}>
                  {preset.models.map((model) => {
                    const isSelected =
                      selection?.presetId === preset.presetId && selection.modelId === model.id
                    return (
                      <CommandItem
                        key={model.id}
                        value={`${model.name} ${model.id} ${preset.name} ${preset.providerId}`}
                        onSelect={() => chooseModel(preset.presetId, model.id)}
                      >
                        <ProviderLogo logoId={preset.logoId} name={preset.name} size='sm' />
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate'>{model.name}</span>
                          <span className='block truncate text-xs text-muted-foreground'>
                            {model.id}
                          </span>
                        </span>
                        {isSelected ? <Check /> : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        ) : (
          <Command>
            <PickerHeader label='Effort' onBack={() => setView('summary')} />
            <CommandList>
              <CommandGroup heading='Effort'>
                {levels.map((level) => (
                  <CommandItem key={level} value={level} onSelect={() => chooseEffort(level)}>
                    <span className='min-w-0 flex-1'>{thinkingLevelLabel(level)}</span>
                    {level === effort ? <Check /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

function PickerHeader(props: { label: string; onBack(): void }): React.JSX.Element {
  return (
    <div className='flex min-w-0 items-center gap-2 border-b p-2'>
      <Button size='icon-sm' variant='ghost' aria-label='Back' onClick={props.onBack}>
        <ArrowLeft />
      </Button>
      <span className='min-w-0 flex-1 truncate text-sm font-medium'>{props.label}</span>
    </div>
  )
}

export function modelEffortLabel(
  modelName: string | null,
  effort: AgentThinkingLevel,
  levels: readonly AgentThinkingLevel[]
): string {
  if (modelName === null) return 'Choose a model'
  const effortUnavailable = levels.length === 1 && levels[0] === 'off'
  return effortUnavailable ? modelName : `${modelName} ${effort}`
}
