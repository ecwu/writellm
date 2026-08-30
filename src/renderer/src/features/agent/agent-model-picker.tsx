import { ArrowLeft, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentModelSelection } from '../../../../shared/contracts/providers'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  const [providerView, setProviderView] = useState<string | null>(null)
  const selected = useMemo(() => findSelection(presets, selection), [presets, selection])
  const viewedPreset =
    providerView === null
      ? null
      : (presets.find((preset) => preset.presetId === providerView) ?? null)

  const changeOpen = (next: boolean): void => {
    if (next) setProviderView(selected?.preset.presetId ?? null)
    setOpen(next)
  }

  const chooseModel = (presetId: string, modelId: string): void => {
    setOpen(false)
    void onSelect({ presetId, modelId })
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
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
        className='w-80 max-w-[calc(100vw-2rem)] p-0'
        data-testid='agent-model-picker'
      >
        {viewedPreset === null ? (
          <Command key='providers'>
            <CommandInput placeholder='Search Providers…' />
            <CommandList>
              <CommandEmpty>No available Providers.</CommandEmpty>
              <CommandGroup heading='Providers'>
                {presets.map((preset) => (
                  <CommandItem
                    key={preset.presetId}
                    value={`${preset.name} ${preset.providerId}`}
                    onSelect={() => setProviderView(preset.presetId)}
                  >
                    <ProviderLogo logoId={preset.logoId} name={preset.name} />
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate'>{preset.name}</span>
                      <span className='block truncate text-xs text-muted-foreground'>
                        {preset.models.length} {preset.models.length === 1 ? 'model' : 'models'}
                      </span>
                    </span>
                    <ChevronRight />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <Command key={viewedPreset.presetId}>
            <div className='flex min-w-0 items-center gap-2 border-b p-2'>
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Back to Providers'
                onClick={() => setProviderView(null)}
              >
                <ArrowLeft />
              </Button>
              <ProviderLogo logoId={viewedPreset.logoId} name={viewedPreset.name} size='sm' />
              <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                {viewedPreset.name}
              </span>
            </div>
            <CommandInput placeholder={`Search ${viewedPreset.name} models…`} />
            <CommandList>
              <CommandEmpty>No available models.</CommandEmpty>
              <CommandGroup heading='Models'>
                {viewedPreset.models.map((model) => {
                  const isSelected =
                    selection?.presetId === viewedPreset.presetId && selection.modelId === model.id
                  return (
                    <CommandItem
                      key={model.id}
                      value={`${model.name} ${model.id}`}
                      onSelect={() => chooseModel(viewedPreset.presetId, model.id)}
                    >
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
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
