import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface DefaultModelGroup {
  id: string
  label: string
  models: readonly { value: string; label: string; keywords?: string[] }[]
}

interface DefaultModelSelectorProps {
  id: string
  groups: readonly DefaultModelGroup[]
  value: string | null
  onValueChange: (value: string | null) => void
  disabled?: boolean
  unavailable?: { label: string; reason: string }
  label?: string
}

export function DefaultModelSelector({
  id,
  groups,
  value,
  onValueChange,
  disabled,
  unavailable,
  label = 'Default model'
}: DefaultModelSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  let selection: string | undefined
  for (const group of groups) {
    const model = group.models.find((model) => model.value === value)
    if (model) {
      selection = `${group.label} · ${model.label}`
      break
    }
  }
  const issue = value !== null && selection === undefined ? unavailable : undefined

  const select = (next: string | null): void => {
    setOpen(false)
    if (next !== value) onValueChange(next)
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type='button'
            variant='outline'
            className='w-full justify-between'
            aria-describedby={issue ? `${id}-issue` : undefined}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.stopPropagation()
            }}
          >
            <span className='min-w-0 truncate'>
              {selection ??
                issue?.label ??
                (value === null ? 'Choose a model' : 'Unavailable model')}
            </span>
            <ChevronsUpDown className='opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='w-(--radix-popover-trigger-width) p-0'
          aria-label={label}
        >
          <Command label='Search models'>
            <CommandInput placeholder='Search models…' />
            <CommandList>
              <CommandEmpty>No models found.</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.id} heading={group.label}>
                  {group.models.map((model) => (
                    <CommandItem
                      key={model.value}
                      value={`model:${model.value}`}
                      keywords={[model.label, group.label, ...(model.keywords ?? [])]}
                      onSelect={() => select(model.value)}
                    >
                      <span className='min-w-0 flex-1 truncate'>{model.label}</span>
                      {model.value === value ? <Check aria-label='Current default' /> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
          {value !== null ? (
            <div className='border-t p-1'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='w-full justify-start'
                onClick={() => select(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.stopPropagation()
                }}
              >
                <X /> Clear default model
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {issue ? <FieldDescription id={`${id}-issue`}>{issue.reason}</FieldDescription> : null}
    </Field>
  )
}
