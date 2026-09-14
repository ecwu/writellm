import { ChevronDown, CircleSlash, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  autocompleteStyleSchema,
  type AutocompleteSession,
  type AutocompleteStyle
} from '../../../../shared/contracts/autocomplete'
import { openAutocompleteSettings } from './autocomplete-errors'

const labels: Record<AutocompleteStyle, string> = {
  word: 'Words',
  sentence: 'Sentence',
  paragraph: 'Paragraph'
}
export function AutocompleteMenu(props: {
  session: AutocompleteSession
  busy: boolean
  open: boolean
  onOpenChange(open: boolean): void
  onToggle(enabled: boolean): void
  onResetOverrides(): void
  onStyle(style: AutocompleteStyle): void
}) {
  const { enabled, style, available } = props.session
  const label = `Autocomplete: ${enabled ? 'On' : 'Off'} · ${labels[style]}`
  const Icon = enabled ? Sparkles : CircleSlash
  return (
    <DropdownMenu open={props.open} onOpenChange={props.onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size='sm' variant='outline' aria-label={label}>
              <Icon data-icon='inline-start' />
              {labels[style]}
              <ChevronDown data-icon='inline-end' />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {label}
          {!available ? ' · Set up a model to enable' : ''}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Autocomplete</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={enabled}
            disabled={props.busy}
            onCheckedChange={props.onToggle}
          >
            Enable autocomplete
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Completion style</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={style}
            onValueChange={(value) => props.onStyle(autocompleteStyleSchema.parse(value))}
          >
            <DropdownMenuRadioItem value='word' disabled={props.busy}>
              Words · A few words
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='sentence' disabled={props.busy}>
              Sentence · Finish this sentence
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value='paragraph' disabled={props.busy}>
              Paragraph · Continue this paragraph
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {props.session.overrides.enabled || props.session.overrides.style
              ? 'Temporary settings · Until app exit'
              : 'Using saved defaults'}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={
              props.busy || !(props.session.overrides.enabled || props.session.overrides.style)
            }
            onSelect={props.onResetOverrides}
          >
            Restore defaults
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openAutocompleteSettings}>
            {available ? 'Model settings…' : 'Set up autocomplete…'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
