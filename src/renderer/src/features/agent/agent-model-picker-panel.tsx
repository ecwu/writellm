import { Check, LayoutGrid } from 'lucide-react'
import { type ReactNode, useState } from 'react'
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
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { AvailableAgentPreset } from './agent-model-selection'

const ALL_PROVIDERS = 'all'

/**
 * Shared model chooser body: a provider rail that filters a searchable model list, plus an
 * optional trailing column (for example reasoning effort) supplied by the owning picker.
 */
export function AgentModelPickerPanel({
  presets,
  selection,
  onModelSelect,
  trailing
}: {
  presets: AvailableAgentPreset[]
  selection: AgentModelSelection | null
  onModelSelect: (selection: AgentModelSelection) => void
  trailing?: ReactNode
}): React.JSX.Element {
  const [providerFilter, setProviderFilter] = useState<string>(ALL_PROVIDERS)
  const visiblePresets =
    providerFilter === ALL_PROVIDERS
      ? presets
      : presets.filter((preset) => preset.presetId === providerFilter)
  const showRail = presets.length > 1

  return (
    <div className='flex h-80 min-h-0 min-w-0'>
      {showRail ? (
        <TooltipProvider>
          <div
            role='toolbar'
            aria-label='Providers'
            aria-orientation='vertical'
            className='flex w-12 shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto border-r bg-muted/30 p-1'
          >
            <ProviderRailButton
              label='All providers'
              pressed={providerFilter === ALL_PROVIDERS}
              onPress={() => setProviderFilter(ALL_PROVIDERS)}
            >
              <LayoutGrid />
            </ProviderRailButton>
            <Separator className='my-0.5' />
            {presets.map((preset) => (
              <ProviderRailButton
                key={preset.presetId}
                label={preset.name}
                pressed={providerFilter === preset.presetId}
                onPress={() => setProviderFilter(preset.presetId)}
              >
                <ProviderLogo logoId={preset.logoId} name={preset.name} size='sm' />
              </ProviderRailButton>
            ))}
          </div>
        </TooltipProvider>
      ) : null}
      <Command className='min-w-0 flex-1 rounded-none'>
        <CommandInput placeholder='Search models…' aria-label='Search models' />
        <CommandList className='max-h-none flex-1'>
          <CommandEmpty>No available models.</CommandEmpty>
          {visiblePresets.map((preset) => (
            <CommandGroup
              key={preset.presetId}
              heading={showRail && providerFilter === ALL_PROVIDERS ? preset.name : undefined}
            >
              {preset.models.map((model) => {
                const isSelected =
                  selection?.presetId === preset.presetId && selection.modelId === model.id
                return (
                  <CommandItem
                    key={model.id}
                    value={`${preset.presetId}/${model.id}`}
                    keywords={[model.name, model.id, preset.name, preset.providerId]}
                    title={model.id}
                    data-checked={isSelected}
                    onSelect={() => onModelSelect({ presetId: preset.presetId, modelId: model.id })}
                  >
                    <ProviderLogo logoId={preset.logoId} name={preset.name} size='sm' />
                    <span className='min-w-0 flex-1 truncate'>{model.name}</span>
                    {isSelected ? <Check /> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
      {trailing}
    </div>
  )
}

function ProviderRailButton(props: {
  label: string
  pressed: boolean
  onPress(): void
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          aria-label={props.label}
          aria-pressed={props.pressed}
          onClick={props.onPress}
          className="relative shrink-0 aria-pressed:bg-accent after:absolute after:top-1/2 after:-right-0.75 after:h-5 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-primary after:opacity-0 after:content-[''] aria-pressed:after:opacity-100"
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side='left'>{props.label}</TooltipContent>
    </Tooltip>
  )
}

/** Popover `onOpenAutoFocus` handler that lands focus on the model search field. */
export function focusModelSearch(event: Event): void {
  const input =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget.querySelector<HTMLInputElement>('[cmdk-input]')
      : null
  if (input === null) return
  event.preventDefault()
  input.focus()
}
