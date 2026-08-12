import type {
  ManuscriptSearchHit,
  ManuscriptSearchResult
} from '../../../../shared/contracts/manuscript-search'
import type {
  ManuscriptReplacementCandidate,
  ManuscriptReplacementPlanResult
} from '../../../../shared/contracts/manuscript-replacement'
import type { SectionStatus } from '../../../../shared/contracts/manuscript'
import { Check, ChevronDown, Filter, Loader2, Replace, SearchX, Undo2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

export type ManuscriptFindScope = 'manuscript' | 'section' | 'subtree'

const targetLabels: Record<ManuscriptSearchHit['target']['kind'], string> = {
  section_title: 'Title',
  section_objective: 'Objective',
  block_inline: 'Body',
  table_cell: 'Table',
  block_caption: 'Caption'
}

const statusLabels: Record<SectionStatus, string> = {
  planned: 'Planned',
  drafting: 'Drafting',
  completed: 'Completed'
}

export function ManuscriptFindPanel(props: {
  query: string
  onQueryChange(query: string): void
  caseSensitive: boolean
  onCaseSensitiveChange(value: boolean): void
  scope: ManuscriptFindScope
  onScopeChange(scope: ManuscriptFindScope): void
  statuses: SectionStatus[]
  onStatusesChange(statuses: SectionStatus[]): void
  result: ManuscriptSearchResult | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  selectedMatchId: string | null
  onActivate(hit: ManuscriptSearchHit): void
  onLoadMore(): void
  replaceOpen: boolean
  onReplaceOpenChange(open: boolean): void
  replacement: string
  onReplacementChange(value: string): void
  replacementPlan: ManuscriptReplacementPlanResult | null
  replacementCandidates: ManuscriptReplacementCandidate[]
  selectedCandidateIds: Set<string>
  onCandidateChecked(candidateId: string, checked: boolean): void
  onReviewReplacements(): void
  onLoadMoreReplacements(): void
  onApplyReplacements(): void
  onUndoReplacement(): void
  canUndoReplacement: boolean
  checkpointAvailable: boolean
  createCheckpoint: boolean
  onCreateCheckpointChange(value: boolean): void
  replacementLoading: boolean
  replacementApplying: boolean
  replacementMessage: string | null
}): React.JSX.Element {
  const hits = props.result?.hits ?? []
  const filterCount =
    Number(props.caseSensitive) + Number(props.scope !== 'manuscript') + props.statuses.length
  return (
    <Command shouldFilter={false} className='min-h-0 rounded-none bg-sidebar' loop>
      <CommandInput
        autoFocus
        value={props.query}
        onValueChange={props.onQueryChange}
        placeholder='Find in manuscript'
        aria-label='Find in manuscript'
        data-testid='manuscript-find-input'
      />
      <div className='flex items-center gap-2 border-b px-3 py-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' size='sm' className='min-w-0 flex-1 justify-start'>
              <Filter /> Filters
              {filterCount > 0 ? <Badge className='ml-auto'>{filterCount}</Badge> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-64'>
            <DropdownMenuLabel>Scope</DropdownMenuLabel>
            <DropdownMenuGroup>
              {(['manuscript', 'section', 'subtree'] as const).map((scope) => (
                <DropdownMenuItem key={scope} onSelect={() => props.onScopeChange(scope)}>
                  {props.scope === scope ? <Check /> : <span className='size-4' />}
                  {scope === 'manuscript'
                    ? 'Whole manuscript'
                    : scope === 'section'
                      ? 'Current section'
                      : 'Current subtree'}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {(['planned', 'drafting', 'completed'] as const).map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={props.statuses.includes(status)}
                onCheckedChange={(checked) =>
                  props.onStatusesChange(
                    checked
                      ? [...props.statuses, status]
                      : props.statuses.filter((item) => item !== status)
                  )
                }
                onSelect={(event) => event.preventDefault()}
              >
                {statusLabels[status]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={props.caseSensitive}
              onCheckedChange={props.onCaseSensitiveChange}
            >
              Match case
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {props.loading ? <Loader2 className='size-4 animate-spin text-muted-foreground' /> : null}
      </div>
      <div className='px-3 py-2'>
        <Button
          variant='ghost'
          size='sm'
          className='w-full justify-start'
          onClick={() => props.onReplaceOpenChange(!props.replaceOpen)}
        >
          <Replace data-icon='inline-start' />
          {props.replaceOpen ? 'Hide replace' : 'Replace'}
        </Button>
        {props.replaceOpen ? (
          <FieldGroup className='mt-3 gap-3'>
            <Field>
              <FieldLabel htmlFor='manuscript-replacement'>Replace with</FieldLabel>
              <Input
                id='manuscript-replacement'
                value={props.replacement}
                maxLength={4096}
                placeholder='Leave empty to delete matches'
                onChange={(event) => props.onReplacementChange(event.target.value)}
              />
              <FieldDescription>
                Exact single-line text. Preview is required before apply.
              </FieldDescription>
            </Field>
            <Button
              variant='outline'
              disabled={props.query.length === 0 || props.replacementLoading}
              onClick={props.onReviewReplacements}
            >
              {props.replacementLoading ? <Loader2 className='animate-spin' /> : <Replace />}
              {props.replacementLoading ? 'Planning…' : 'Review replacements'}
            </Button>
          </FieldGroup>
        ) : null}
      </div>
      {props.replaceOpen ? <Separator /> : null}
      {props.replacementMessage !== null ? (
        <Alert className='mx-3 my-2 w-auto'>
          <AlertTitle>Replacement review</AlertTitle>
          <AlertDescription>{props.replacementMessage}</AlertDescription>
        </Alert>
      ) : null}
      {props.replaceOpen && props.replacementPlan?.status === 'ready' ? (
        <ReplacementReview
          plan={props.replacementPlan}
          candidates={props.replacementCandidates}
          selectedCandidateIds={props.selectedCandidateIds}
          onCandidateChecked={props.onCandidateChecked}
          onLoadMore={props.onLoadMoreReplacements}
        />
      ) : (
        <>
          <div className='px-3 py-2 text-xs text-muted-foreground' role='status' aria-live='polite'>
            {props.error ??
              (props.query.length === 0
                ? 'Type a word or phrase to search.'
                : props.loading
                  ? 'Searching current revisions…'
                  : `${props.result?.resultCount ?? 0} results${props.result?.complete === false ? ' so far' : ''}`)}
          </div>
          <CommandList className='min-h-0 flex-1 max-h-none'>
            {props.error !== null ? (
              <div className='px-4 py-8 text-center text-sm text-destructive'>{props.error}</div>
            ) : null}
            {props.query.length > 0 &&
            !props.loading &&
            props.error === null &&
            hits.length === 0 ? (
              <CommandEmpty className='flex flex-col items-center gap-2 px-6 py-10'>
                <SearchX className='size-7 text-muted-foreground' />
                <span>No exact matches</span>
                <span className='text-xs text-muted-foreground'>
                  Try another phrase or widen filters.
                </span>
              </CommandEmpty>
            ) : null}
            <CommandGroup aria-label='Manuscript search results'>
              {hits.map((hit) => (
                <CommandItem
                  key={hit.matchId}
                  value={hit.matchId}
                  className='h-auto items-start px-3 py-3'
                  aria-selected={props.selectedMatchId === hit.matchId}
                  onSelect={() => props.onActivate(hit)}
                >
                  <span className='min-w-0 flex-1 space-y-1'>
                    <span className='flex min-w-0 items-center gap-2'>
                      <span className='truncate font-medium'>{hit.sectionTitle}</span>
                      {hit.target.kind !== 'block_inline' ? (
                        <Badge variant='outline' className='shrink-0 text-[10px]'>
                          {targetLabels[hit.target.kind]}
                        </Badge>
                      ) : null}
                    </span>
                    <span className='line-clamp-3 block text-xs leading-5 text-muted-foreground'>
                      {hit.excerpt.slice(0, hit.excerptMatch.from)}
                      <mark className='rounded-sm bg-warning/45 px-0.5 text-foreground'>
                        {hit.excerpt.slice(hit.excerptMatch.from, hit.excerptMatch.to)}
                      </mark>
                      {hit.excerpt.slice(hit.excerptMatch.to)}
                    </span>
                    <span className='block truncate text-[11px] text-muted-foreground'>
                      {hit.headingPath.join(' / ')}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {props.result?.complete === false ? (
            <p className='border-t px-3 py-2 text-xs text-warning-foreground' role='status'>
              {props.result.incompleteReason === 'scan_budget'
                ? 'Search reached its time budget. Narrow the scope for a complete result.'
                : 'The result limit was reached. Narrow the scope to inspect more occurrences.'}
            </p>
          ) : null}
          {props.result?.nextCursor ? (
            <div className='border-t p-3'>
              <Button
                variant='outline'
                size='sm'
                className='w-full'
                disabled={props.loadingMore}
                onClick={props.onLoadMore}
              >
                {props.loadingMore ? <Loader2 className='animate-spin' /> : null}
                {props.loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {props.replaceOpen && props.replacementPlan?.status === 'ready' ? (
        <div className='z-10 flex shrink-0 flex-col gap-2 border-t bg-sidebar p-3'>
          {props.checkpointAvailable ? (
            <Field orientation='horizontal' className='items-center py-1'>
              <Checkbox
                id='replacement-checkpoint'
                checked={props.createCheckpoint}
                onCheckedChange={(checked) => props.onCreateCheckpointChange(checked === true)}
              />
              <FieldLabel htmlFor='replacement-checkpoint' className='text-xs font-normal'>
                Create a project-history checkpoint first
              </FieldLabel>
            </Field>
          ) : null}
          <Button
            disabled={props.selectedCandidateIds.size === 0 || props.replacementApplying}
            onClick={props.onApplyReplacements}
          >
            {props.replacementApplying ? <Loader2 className='animate-spin' /> : <Replace />}
            {props.replacementApplying
              ? 'Applying…'
              : `Apply ${props.selectedCandidateIds.size} replacement${props.selectedCandidateIds.size === 1 ? '' : 's'}`}
          </Button>
          {props.canUndoReplacement ? (
            <Button variant='outline' onClick={props.onUndoReplacement}>
              <Undo2 /> Undo latest section replacement
            </Button>
          ) : null}
        </div>
      ) : null}
    </Command>
  )
}

function ReplacementReview(props: {
  plan: Extract<ManuscriptReplacementPlanResult, { status: 'ready' }>
  candidates: ManuscriptReplacementCandidate[]
  selectedCandidateIds: Set<string>
  onCandidateChecked(candidateId: string, checked: boolean): void
  onLoadMore(): void
}): React.JSX.Element {
  const eligible = props.candidates.filter((candidate) => candidate.eligible)
  const skipped = props.candidates.filter((candidate) => !candidate.eligible)
  return (
    <CommandList className='min-h-0 flex-1 max-h-none' aria-label='Replacement candidates'>
      <div className='px-3 py-2 text-xs text-muted-foreground' role='status' aria-live='polite'>
        {props.plan.eligibleCount} eligible · {props.plan.skippedCount} skipped ·{' '}
        {props.plan.sectionCount} sections
      </div>
      <CommandGroup heading='Eligible replacements'>
        {eligible.map((candidate) => (
          <CommandItem
            key={candidate.candidateId}
            value={candidate.candidateId}
            className='h-auto items-start gap-3 px-3 py-3'
            onSelect={() =>
              props.onCandidateChecked(
                candidate.candidateId,
                !props.selectedCandidateIds.has(candidate.candidateId)
              )
            }
          >
            <Checkbox
              aria-label={`Select replacement in ${candidate.sectionTitle}`}
              checked={props.selectedCandidateIds.has(candidate.candidateId)}
              onCheckedChange={(checked) =>
                props.onCandidateChecked(candidate.candidateId, checked === true)
              }
              onClick={(event) => event.stopPropagation()}
            />
            <span className='min-w-0 flex-1'>
              <span className='block truncate font-medium'>{candidate.sectionTitle}</span>
              <span className='mt-1 block text-xs text-muted-foreground'>
                <span className='block line-clamp-2'>Before: {candidate.beforePreview}</span>
                <span className='mt-1 block line-clamp-2 text-foreground'>
                  After: {candidate.afterPreview}
                </span>
              </span>
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
      {skipped.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm' className='mx-2 w-[calc(100%-1rem)] justify-start'>
              <ChevronDown /> Skipped ({props.plan.skippedCount})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CommandGroup>
              {skipped.map((candidate) => (
                <CommandItem key={candidate.candidateId} disabled className='h-auto px-3 py-3'>
                  <span className='min-w-0 flex-1'>
                    <span className='flex items-center gap-2'>
                      <span className='truncate font-medium'>{candidate.sectionTitle}</span>
                      <Badge variant='outline'>{skipReasonLabel(candidate.skipReason)}</Badge>
                    </span>
                    <span className='mt-1 block line-clamp-2 text-xs text-muted-foreground'>
                      {candidate.beforePreview}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {props.plan.nextCursor !== null ? (
        <div className='p-3'>
          <Button variant='outline' size='sm' className='w-full' onClick={props.onLoadMore}>
            Load more candidates
          </Button>
        </div>
      ) : null}
    </CommandList>
  )
}

function skipReasonLabel(reason: ManuscriptReplacementCandidate['skipReason']): string {
  return (
    {
      section_metadata: 'Metadata',
      readable_citation: 'Citation',
      link_text: 'Link',
      code_block: 'Code block',
      inline_code: 'Inline code',
      structured_overlap: 'Structured text',
      unchanged: 'Unchanged'
    }[reason ?? 'structured_overlap'] ?? 'Skipped'
  )
}
