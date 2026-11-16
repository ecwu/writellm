import { useState } from 'react'
import type { SourceModelCandidate } from '../../../../shared/contracts/providers'
import { ChevronsUpDown, RefreshCw } from 'lucide-react'
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
import { Spinner } from '@/components/ui/spinner'

interface CatalogStatus {
  status: 'never' | 'current' | 'stale' | 'unsupported'
  checkedAt: string | null
  lastErrorCode: string | null
}

type CandidatePurpose =
  | { capability: 'image' }
  | { capability: 'transcription'; mode: 'realtime' | 'file' }

/** Unknown IDs remain available; only explicit incompatible capabilities are filtered. */
export function modelCandidateGroups(
  candidates: SourceModelCandidate[],
  purpose: CandidatePurpose
): Array<{ heading: string; candidates: SourceModelCandidate[] }> {
  const compatible = candidates.filter((candidate) => {
    if (
      candidate.capability &&
      candidate.capability !== 'unknown' &&
      candidate.capability !== purpose.capability
    )
      return false
    return (
      purpose.capability !== 'transcription' ||
      candidate.capability !== 'transcription' ||
      !candidate.speechModes?.length ||
      candidate.speechModes.includes(purpose.mode)
    )
  })
  const known = compatible.filter(
    (candidate) =>
      candidate.availability !== 'catalog' && candidate.capability === purpose.capability
  )
  const unknown = compatible.filter(
    (candidate) =>
      candidate.availability !== 'catalog' &&
      (!candidate.capability || candidate.capability === 'unknown')
  )
  const catalog = compatible.filter((candidate) => candidate.availability === 'catalog')
  return [
    {
      heading: purpose.capability === 'image' ? 'Image models' : 'Transcription',
      candidates: known
    },
    { heading: 'Other models', candidates: unknown },
    { heading: 'Public catalog', candidates: catalog }
  ].filter((group) => group.candidates.length > 0)
}

export function ModelCandidatePicker({
  candidates,
  purpose,
  disabled,
  onSelect
}: {
  candidates: SourceModelCandidate[]
  purpose: CandidatePurpose
  disabled: boolean
  onSelect: (candidate: SourceModelCandidate) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const groups = modelCandidateGroups(candidates, purpose)
  if (groups.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          role='combobox'
          aria-label='Choose discovered model'
          aria-expanded={open}
          disabled={disabled}
          className='justify-between'
        >
          Choose discovered model
          <ChevronsUpDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search model IDs…' />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.candidates.map((candidate) => (
                  <CommandItem
                    key={candidate.id}
                    value={`${candidate.name} ${candidate.id}`}
                    onSelect={() => {
                      onSelect(candidate)
                      setOpen(false)
                    }}
                  >
                    <div className='flex min-w-0 flex-col'>
                      <span className='truncate'>{candidate.name}</span>
                      {candidate.id !== candidate.name ? (
                        <span className='truncate text-xs text-muted-foreground'>
                          {candidate.id}
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ModelCatalogRefresh({
  candidates,
  catalog,
  busy,
  disabled,
  onRefresh
}: {
  candidates: SourceModelCandidate[]
  catalog: CatalogStatus
  busy: boolean
  disabled: boolean
  onRefresh: () => void
}): React.JSX.Element {
  return (
    <div className='flex flex-wrap items-center gap-3'>
      <Button variant='outline' disabled={disabled} onClick={onRefresh}>
        {busy ? <Spinner data-icon='inline-start' /> : <RefreshCw data-icon='inline-start' />}Fetch
        models
      </Button>
      <span
        role='status'
        className='text-sm text-muted-foreground'
        title={catalog.checkedAt ?? undefined}
      >
        {catalog.status === 'never'
          ? 'Not fetched'
          : catalog.status === 'unsupported'
            ? 'Discovery unavailable'
            : `${candidates.length} candidates · ${catalog.status}`}
      </span>
    </div>
  )
}
