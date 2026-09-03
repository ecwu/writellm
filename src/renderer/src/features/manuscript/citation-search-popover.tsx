import type { ReferenceSearchCandidate } from '../../../../shared/contracts/references'
import { useEffect, useMemo, useRef } from 'react'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type CitationSearchState =
  | { status: 'loading' }
  | { status: 'ready'; items: ReferenceSearchCandidate[]; hasReferences: boolean }
  | { status: 'error' }

export function CitationSearchPopover(props: {
  anchorRect: DOMRect
  query: string
  state: CitationSearchState
  onQueryChange(query: string): void
  onInsert(candidate: ReferenceSearchCandidate): void
  onCancel(options: { restoreEditorFocus: boolean }): void
  onRetry(): void
}): React.JSX.Element {
  const restoreEditorFocusRef = useRef(false)
  const anchor = useMemo(
    () => ({ getBoundingClientRect: () => props.anchorRect }),
    [props.anchorRect]
  )
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

  return (
    <Popover
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel({ restoreEditorFocus: restoreEditorFocusRef.current })
        }
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        align='start'
        side='bottom'
        collisionPadding={12}
        className='w-[min(44rem,calc(100vw-1.5rem))] p-0'
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          restoreEditorFocusRef.current = true
          props.onCancel({ restoreEditorFocus: true })
        }}
        onPointerDownOutside={() => {
          restoreEditorFocusRef.current = false
        }}
      >
        <Command shouldFilter={false} loop>
          <CitationSearchInput query={props.query} onQueryChange={props.onQueryChange} />
          <CommandList className='max-h-none'>
            {props.state.status === 'loading' && (
              <CitationSearchMessage>Searching references…</CitationSearchMessage>
            )}
            {props.state.status === 'error' && (
              <CommandGroup>
                <CommandItem onSelect={props.onRetry}>Reference search failed. Retry</CommandItem>
              </CommandGroup>
            )}
            {props.state.status === 'ready' && props.state.items.length === 0 && (
              <CitationSearchMessage>
                {props.state.hasReferences ? 'No matching references.' : 'No references yet.'}
              </CitationSearchMessage>
            )}
            {props.state.status === 'ready' && props.state.items.length > 0 && (
              <CommandGroup>
                {props.state.items.map((candidate) => (
                  <CitationSearchItem
                    key={candidate.referenceId}
                    candidate={candidate}
                    onInsert={props.onInsert}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CitationSearchInput(props: {
  query: string
  onQueryChange(query: string): void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  return (
    <CommandInput
      ref={inputRef}
      value={props.query}
      onValueChange={props.onQueryChange}
      placeholder='Search citekey, title, or author…'
      aria-label='Search references'
    />
  )
}

function CitationSearchItem(props: {
  candidate: ReferenceSearchCandidate
  onInsert(candidate: ReferenceSearchCandidate): void
}): React.JSX.Element {
  const { candidate } = props
  const details = [candidate.title, candidate.authors.join(', '), candidate.issuedYear]
    .filter((value) => value !== null && value !== '')
    .join(' · ')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CommandItem
          value={candidate.referenceId}
          className='min-w-0'
          aria-label={`${candidate.citationKey}: ${details}`}
          onSelect={() => props.onInsert(candidate)}
        >
          <span className='w-1/3 min-w-0 shrink-0 truncate font-mono text-xs'>
            {candidate.citationKey}
          </span>
          <span className='min-w-0 flex-1 truncate'>{candidate.title}</span>
        </CommandItem>
      </TooltipTrigger>
      <TooltipContent side='right' className='max-w-sm'>
        {candidate.citationKey} · {details}
      </TooltipContent>
    </Tooltip>
  )
}

function CitationSearchMessage(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div role='status' className='px-3 py-6 text-center text-sm text-muted-foreground'>
      {props.children}
    </div>
  )
}
