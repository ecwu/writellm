import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ManuscriptSearchHit,
  ManuscriptSearchResult
} from '../../../../shared/contracts/manuscript-search'
import type {
  ManuscriptReplacementCandidate,
  ManuscriptReplacementPlanResult
} from '../../../../shared/contracts/manuscript-replacement'
import type { SectionStatus } from '../../../../shared/contracts/manuscript'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  Replace,
  SearchX,
  Undo2
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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

type ManuscriptFindPanelProps = {
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
  onCandidatesChecked(candidateIds: string[], checked: boolean): void
  onReviewReplacements(): void
  onLoadMoreReplacements(): void
  onApplyReplacements(): void
  onUndoReplacement(): void
  canUndoReplacement: boolean
  checkpointAvailable: boolean
  createCheckpoint: boolean
  onCreateCheckpointChange(value: boolean): void
  replacementLoading: boolean
  replacementLoadingMore: boolean
  replacementApplying: boolean
  replacementMessage: string | null
}

type SearchResultGroup = {
  sectionId: string
  sectionTitle: string
  headingPath: string[]
  hits: ManuscriptSearchHit[]
}

type ReplacementCandidateGroup = {
  sectionId: string
  sectionTitle: string
  headingPath: string[]
  candidates: ManuscriptReplacementCandidate[]
}

export function ManuscriptFindPanel(props: ManuscriptFindPanelProps): React.JSX.Element {
  const replacementInputRef = useRef<HTMLInputElement>(null)
  const replacementStatusRef = useRef<HTMLDivElement>(null)
  const replacementMessageRef = useRef<HTMLDivElement>(null)
  const replaceWasOpenRef = useRef(false)
  const hits = props.result?.hits ?? []
  const searchGroups = useMemo(() => groupSearchHits(hits), [hits])
  const filterCount = Number(props.scope !== 'manuscript') + props.statuses.length
  const searchResetKey = `${props.query}\0${String(props.caseSensitive)}\0${props.scope}\0${props.statuses.join(',')}\0${props.result?.snapshotFingerprint ?? ''}`
  const replacementPlanId =
    props.replacementPlan?.status === 'ready' ? props.replacementPlan.planId : null

  useEffect(() => {
    if (props.replaceOpen && !replaceWasOpenRef.current) replacementInputRef.current?.focus()
    replaceWasOpenRef.current = props.replaceOpen
  }, [props.replaceOpen])

  useEffect(() => {
    if (props.replaceOpen && replacementPlanId !== null) replacementStatusRef.current?.focus()
  }, [props.replaceOpen, replacementPlanId])

  useEffect(() => {
    if (props.replacementMessage !== null && replacementPlanId === null) {
      replacementMessageRef.current?.focus()
    }
  }, [props.replacementMessage, replacementPlanId])

  const selectedSectionCount = new Set(
    props.replacementCandidates
      .filter(
        (candidate) => candidate.eligible && props.selectedCandidateIds.has(candidate.candidateId)
      )
      .map((candidate) => candidate.sectionId)
  ).size

  return (
    <Command shouldFilter={false} className='min-h-0 rounded-none bg-sidebar' loop>
      <div className='flex shrink-0 flex-col gap-1 border-b p-2'>
        <div className='flex min-w-0 items-center gap-1'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={props.replaceOpen ? 'Hide replace' : 'Replace'}
                aria-expanded={props.replaceOpen}
                onClick={() => props.onReplaceOpenChange(!props.replaceOpen)}
              >
                {props.replaceOpen ? <ChevronDown /> : <ChevronRight />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side='right'>
              {props.replaceOpen ? 'Hide replace' : 'Show replace'}
            </TooltipContent>
          </Tooltip>
          <InputGroup className='h-8'>
            <InputGroupInput
              autoFocus
              value={props.query}
              maxLength={512}
              placeholder='Search manuscript'
              aria-label='Find in manuscript'
              data-testid='manuscript-find-input'
              onChange={(event) => props.onQueryChange(event.target.value)}
            />
            <InputGroupAddon align='inline-end' className='gap-0 pr-1'>
              {props.loading ? <Loader2 className='animate-spin' aria-label='Searching' /> : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Toggle
                    size='sm'
                    pressed={props.caseSensitive}
                    aria-label='Match case'
                    onPressedChange={props.onCaseSensitiveChange}
                  >
                    Aa
                  </Toggle>
                </TooltipTrigger>
                <TooltipContent>Match case</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton
                        size='icon-xs'
                        aria-label={`Filters${filterCount > 0 ? `, ${filterCount} active` : ''}`}
                      >
                        <Filter />
                        {filterCount > 0 ? (
                          <Badge
                            variant='secondary'
                            className='absolute -top-1 -right-1 min-w-4 px-1 text-[10px] tabular-nums'
                          >
                            {filterCount}
                          </Badge>
                        ) : null}
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Search filters</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align='end' className='w-64'>
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
                  <DropdownMenuGroup>
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
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </InputGroupAddon>
          </InputGroup>
        </div>
        {props.replaceOpen ? (
          <div className='flex min-w-0 items-center gap-1'>
            <span className='size-8 shrink-0' aria-hidden='true' />
            <InputGroup className='h-8'>
              <InputGroupInput
                ref={replacementInputRef}
                id='manuscript-replacement'
                value={props.replacement}
                maxLength={4096}
                placeholder='Replace (empty deletes)'
                aria-label='Replace with'
                onChange={(event) => props.onReplacementChange(event.target.value)}
              />
              <InputGroupAddon align='inline-end' className='pr-1'>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      disabled={props.query.length === 0 || props.replacementLoading}
                      aria-label='Review replacements'
                      onClick={props.onReviewReplacements}
                    >
                      {props.replacementLoading ? (
                        <Loader2 data-icon='inline-start' className='animate-spin' />
                      ) : (
                        <Replace data-icon='inline-start' />
                      )}
                      {props.replacementLoading ? 'Planning…' : 'Review'}
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    Preview every eligible replacement before anything changes
                  </TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
          </div>
        ) : null}
      </div>

      {props.replacementMessage !== null ? (
        <Alert ref={replacementMessageRef} tabIndex={-1} className='mx-2 my-2 w-auto'>
          <AlertTitle>Replacement review</AlertTitle>
          <AlertDescription>{props.replacementMessage}</AlertDescription>
        </Alert>
      ) : null}

      {props.replaceOpen && props.replacementPlan?.status === 'ready' ? (
        <ReplacementReview
          key={props.replacementPlan.planId}
          statusRef={replacementStatusRef}
          plan={props.replacementPlan}
          candidates={props.replacementCandidates}
          selectedCandidateIds={props.selectedCandidateIds}
          loadingMore={props.replacementLoadingMore}
          onCandidatesChecked={props.onCandidatesChecked}
          onLoadMore={props.onLoadMoreReplacements}
        />
      ) : (
        <SearchResults
          key={searchResetKey}
          query={props.query}
          result={props.result}
          groups={searchGroups}
          loading={props.loading}
          loadingMore={props.loadingMore}
          error={props.error}
          selectedMatchId={props.selectedMatchId}
          onActivate={props.onActivate}
          onLoadMore={props.onLoadMore}
        />
      )}

      {props.replaceOpen && props.replacementPlan?.status === 'ready' ? (
        <div className='flex shrink-0 flex-col gap-2 border-t bg-sidebar p-3'>
          <div className='text-xs text-muted-foreground' role='status' aria-live='polite'>
            {selectionSummary(props.selectedCandidateIds.size, selectedSectionCount)}
          </div>
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
            disabled={
              props.selectedCandidateIds.size === 0 ||
              props.replacementApplying ||
              props.replacementLoadingMore
            }
            onClick={props.onApplyReplacements}
          >
            {props.replacementApplying ? (
              <Loader2 data-icon='inline-start' className='animate-spin' />
            ) : (
              <Replace data-icon='inline-start' />
            )}
            {props.replacementApplying
              ? 'Applying…'
              : applyLabel(props.selectedCandidateIds.size, selectedSectionCount)}
          </Button>
          {props.canUndoReplacement ? (
            <Button variant='outline' onClick={props.onUndoReplacement}>
              <Undo2 data-icon='inline-start' /> Undo latest section replacement
            </Button>
          ) : null}
        </div>
      ) : props.canUndoReplacement ? (
        <div className='shrink-0 border-t bg-sidebar p-3'>
          <Button variant='outline' className='w-full' onClick={props.onUndoReplacement}>
            <Undo2 data-icon='inline-start' /> Undo latest section replacement
          </Button>
        </div>
      ) : null}
    </Command>
  )
}

function SearchResults(props: {
  query: string
  result: ManuscriptSearchResult | null
  groups: SearchResultGroup[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  selectedMatchId: string | null
  onActivate(hit: ManuscriptSearchHit): void
  onLoadMore(): void
}): React.JSX.Element {
  const hits = props.result?.hits ?? []
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set())
  return (
    <>
      <div
        className='shrink-0 px-3 py-2 text-xs text-muted-foreground'
        role='status'
        aria-live='polite'
      >
        {searchStatus(props.query, props.result, props.loading, props.error)}
      </div>
      <CommandList className='min-h-0 flex-1 max-h-none' aria-label='Manuscript search results'>
        {props.error !== null ? (
          <div className='px-4 py-8 text-center text-sm text-destructive'>{props.error}</div>
        ) : null}
        {props.query.length > 0 && !props.loading && props.error === null && hits.length === 0 ? (
          <CommandEmpty>
            <Empty className='gap-3 rounded-none px-6 py-10'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>No exact matches</EmptyTitle>
                <EmptyDescription>Try another phrase or widen filters.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CommandEmpty>
        ) : null}
        {props.groups.map((group) => {
          const open = !collapsedSectionIds.has(group.sectionId)
          const path = group.headingPath.join(' / ')
          return (
            <CommandGroup key={group.sectionId} className='p-0'>
              <Collapsible
                open={open}
                onOpenChange={(nextOpen) => {
                  const next = new Set(collapsedSectionIds)
                  if (nextOpen) next.delete(group.sectionId)
                  else next.add(group.sectionId)
                  setCollapsedSectionIds(next)
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='w-full min-w-0 justify-start rounded-none px-3'
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${group.sectionTitle}`}
                      >
                        {open ? (
                          <ChevronDown data-icon='inline-start' />
                        ) : (
                          <ChevronRight data-icon='inline-start' />
                        )}
                        <span className='truncate'>{group.sectionTitle}</span>
                        <Badge
                          variant='secondary'
                          className='ml-auto tabular-nums'
                          aria-label={`${group.hits.length} loaded matches`}
                        >
                          {group.hits.length}
                        </Badge>
                      </Button>
                    </CollapsibleTrigger>
                  </TooltipTrigger>
                  <TooltipContent side='right'>{path}</TooltipContent>
                </Tooltip>
                <CollapsibleContent>
                  {group.hits.map((hit) => {
                    const hitPath = hit.headingPath.join(' / ')
                    return (
                      <CommandItem
                        key={hit.matchId}
                        value={hit.matchId}
                        className='h-8 min-w-0 rounded-none px-3 py-1'
                        aria-label={`${targetLabels[hit.target.kind]} match in ${hitPath}: ${hit.excerpt}`}
                        aria-selected={props.selectedMatchId === hit.matchId}
                        onSelect={() => props.onActivate(hit)}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
                              {hit.excerpt.slice(0, hit.excerptMatch.from)}
                              <mark className='rounded-sm bg-warning/45 px-0.5 text-foreground'>
                                {hit.excerpt.slice(hit.excerptMatch.from, hit.excerptMatch.to)}
                              </mark>
                              {hit.excerpt.slice(hit.excerptMatch.to)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side='right'>{hitPath}</TooltipContent>
                        </Tooltip>
                        {hit.target.kind !== 'block_inline' ? (
                          <Badge variant='outline' className='shrink-0 text-[10px]'>
                            {targetLabels[hit.target.kind]}
                          </Badge>
                        ) : null}
                      </CommandItem>
                    )
                  })}
                </CollapsibleContent>
              </Collapsible>
            </CommandGroup>
          )
        })}
        {props.result?.nextCursor ? (
          <div className='p-3'>
            <Button
              variant='outline'
              size='sm'
              className='w-full'
              disabled={props.loadingMore}
              onClick={props.onLoadMore}
            >
              {props.loadingMore ? (
                <Loader2 data-icon='inline-start' className='animate-spin' />
              ) : null}
              {props.loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </CommandList>
      {props.result?.complete === false ? (
        <p className='shrink-0 border-t px-3 py-2 text-xs text-warning-foreground' role='status'>
          {props.result.incompleteReason === 'scan_budget'
            ? 'Search reached its time budget. Narrow the scope for a complete result.'
            : 'The result limit was reached. Narrow the scope to inspect more occurrences.'}
        </p>
      ) : null}
    </>
  )
}

function ReplacementReview(props: {
  statusRef: React.RefObject<HTMLDivElement | null>
  plan: Extract<ManuscriptReplacementPlanResult, { status: 'ready' }>
  candidates: ManuscriptReplacementCandidate[]
  selectedCandidateIds: Set<string>
  loadingMore: boolean
  onCandidatesChecked(candidateIds: string[], checked: boolean): void
  onLoadMore(): void
}): React.JSX.Element {
  const groups = useMemo(() => groupReplacementCandidates(props.candidates), [props.candidates])
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const eligibleCandidateIds = props.candidates
    .filter((candidate) => candidate.eligible)
    .map((candidate) => candidate.candidateId)
  const allEligibleLoaded = props.plan.nextCursor === null
  const allSelectionState = checkboxState(eligibleCandidateIds, props.selectedCandidateIds)

  return (
    <CommandList className='min-h-0 flex-1 max-h-none' aria-label='Replacement candidates'>
      <div
        ref={props.statusRef}
        tabIndex={-1}
        className='flex min-w-0 items-center gap-3 px-3 py-2 text-xs text-muted-foreground outline-none'
        role='status'
        aria-live='polite'
      >
        <span className='min-w-0 flex-1'>
          {props.plan.eligibleCount} eligible · {props.plan.skippedCount} skipped ·{' '}
          {props.plan.sectionCount} sections
        </span>
        <Field orientation='horizontal' className='w-auto shrink-0 items-center gap-2'>
          <Checkbox
            id='select-all-replacements'
            checked={allSelectionState}
            disabled={!allEligibleLoaded || eligibleCandidateIds.length === 0}
            onCheckedChange={(checked) =>
              props.onCandidatesChecked(eligibleCandidateIds, checked === true)
            }
          />
          <FieldLabel htmlFor='select-all-replacements' className='text-xs font-normal'>
            {allEligibleLoaded ? 'Select all' : 'Load all to select'}
          </FieldLabel>
        </Field>
      </div>
      {groups.map((group) => {
        const open = !collapsedSections.has(group.sectionId)
        const eligible = group.candidates.filter((candidate) => candidate.eligible)
        const skipped = group.candidates.filter((candidate) => !candidate.eligible)
        const eligibleIds = eligible.map((candidate) => candidate.candidateId)
        const path = group.headingPath.join(' / ')
        return (
          <CommandGroup key={group.sectionId} className='p-0'>
            <Collapsible
              open={open}
              onOpenChange={(nextOpen) => {
                setCollapsedSections((current) => {
                  const next = new Set(current)
                  if (nextOpen) next.delete(group.sectionId)
                  else next.add(group.sectionId)
                  return next
                })
              }}
            >
              <div className='flex min-w-0 items-center gap-1 px-3'>
                <Checkbox
                  aria-label={`Select loaded replacements in ${group.sectionTitle}`}
                  checked={checkboxState(eligibleIds, props.selectedCandidateIds)}
                  disabled={eligibleIds.length === 0}
                  onCheckedChange={(checked) =>
                    props.onCandidatesChecked(eligibleIds, checked === true)
                  }
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='min-w-0 flex-1 justify-start px-2'
                        aria-label={`${open ? 'Collapse' : 'Expand'} replacement group ${group.sectionTitle}`}
                      >
                        {open ? (
                          <ChevronDown data-icon='inline-start' />
                        ) : (
                          <ChevronRight data-icon='inline-start' />
                        )}
                        <span className='truncate'>{group.sectionTitle}</span>
                        <Badge variant='secondary' className='ml-auto tabular-nums'>
                          {eligible.length}
                        </Badge>
                      </Button>
                    </CollapsibleTrigger>
                  </TooltipTrigger>
                  <TooltipContent side='right'>{path}</TooltipContent>
                </Tooltip>
              </div>
              <CollapsibleContent>
                {eligible.map((candidate) => (
                  <CommandItem
                    key={candidate.candidateId}
                    value={candidate.candidateId}
                    className='h-auto items-start gap-3 rounded-none px-3 py-2'
                    onSelect={() =>
                      props.onCandidatesChecked(
                        [candidate.candidateId],
                        !props.selectedCandidateIds.has(candidate.candidateId)
                      )
                    }
                  >
                    <Checkbox
                      aria-label={`Select replacement in ${candidate.sectionTitle}`}
                      checked={props.selectedCandidateIds.has(candidate.candidateId)}
                      onCheckedChange={(checked) =>
                        props.onCandidatesChecked([candidate.candidateId], checked === true)
                      }
                      onClick={(event) => event.stopPropagation()}
                    />
                    <span className='min-w-0 flex-1 text-xs'>
                      <span className='flex min-w-0 items-center gap-2'>
                        <span className='truncate text-muted-foreground'>
                          Before: {candidate.beforePreview}
                        </span>
                        {candidate.targetKind !== 'block_inline' ? (
                          <Badge variant='outline' className='shrink-0 text-[10px]'>
                            {targetLabels[candidate.targetKind]}
                          </Badge>
                        ) : null}
                      </span>
                      <span className='mt-1 block truncate'>After: {candidate.afterPreview}</span>
                    </span>
                  </CommandItem>
                ))}
                {skipped.length > 0 ? (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant='ghost' size='sm' className='mx-2 justify-start'>
                        <ChevronRight data-icon='inline-start' /> Skipped ({skipped.length})
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {skipped.map((candidate) => (
                        <CommandItem
                          key={candidate.candidateId}
                          disabled
                          className='h-auto rounded-none px-3 py-2'
                        >
                          <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
                            {candidate.beforePreview}
                          </span>
                          <Badge variant='outline'>{skipReasonLabel(candidate.skipReason)}</Badge>
                        </CommandItem>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          </CommandGroup>
        )
      })}
      {props.plan.nextCursor !== null ? (
        <div className='p-3'>
          <Button
            variant='outline'
            size='sm'
            className='w-full'
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
          >
            {props.loadingMore ? (
              <Loader2 data-icon='inline-start' className='animate-spin' />
            ) : null}
            {props.loadingMore ? 'Loading…' : 'Load more candidates'}
          </Button>
        </div>
      ) : null}
    </CommandList>
  )
}

function groupSearchHits(hits: ManuscriptSearchHit[]): SearchResultGroup[] {
  const groups = new Map<string, SearchResultGroup>()
  for (const hit of hits) {
    const sectionId = hit.target.sectionId
    const existing = groups.get(sectionId)
    if (existing !== undefined) {
      existing.hits.push(hit)
      continue
    }
    groups.set(sectionId, {
      sectionId,
      sectionTitle: hit.sectionTitle,
      headingPath: hit.headingPath,
      hits: [hit]
    })
  }
  return [...groups.values()]
}

function groupReplacementCandidates(
  candidates: ManuscriptReplacementCandidate[]
): ReplacementCandidateGroup[] {
  const groups = new Map<string, ReplacementCandidateGroup>()
  for (const candidate of candidates) {
    const existing = groups.get(candidate.sectionId)
    if (existing !== undefined) {
      existing.candidates.push(candidate)
      continue
    }
    groups.set(candidate.sectionId, {
      sectionId: candidate.sectionId,
      sectionTitle: candidate.sectionTitle,
      headingPath: candidate.headingPath,
      candidates: [candidate]
    })
  }
  return [...groups.values()]
}

function checkboxState(
  candidateIds: string[],
  selectedCandidateIds: Set<string>
): boolean | 'indeterminate' {
  if (candidateIds.length === 0) return false
  const selectedCount = candidateIds.filter((candidateId) =>
    selectedCandidateIds.has(candidateId)
  ).length
  if (selectedCount === 0) return false
  return selectedCount === candidateIds.length ? true : 'indeterminate'
}

function searchStatus(
  query: string,
  result: ManuscriptSearchResult | null,
  loading: boolean,
  error: string | null
): string {
  if (error !== null) return error
  if (query.length === 0) return 'Type a word or phrase to search.'
  if (loading) return 'Searching current revisions…'
  if (result === null) return '0 results'
  if (result.complete === false) return `${result.resultCount} results so far`
  if (result.nextCursor !== null) {
    return `${result.hits.length} of ${result.resultCount} results loaded`
  }
  return `${result.resultCount} results`
}

function selectionSummary(replacementCount: number, sectionCount: number): string {
  if (replacementCount === 0) return 'No replacements selected'
  return `${replacementCount} ${pluralize('replacement', replacementCount)} selected in ${sectionCount} ${pluralize('section', sectionCount)}`
}

function applyLabel(replacementCount: number, sectionCount: number): string {
  return `Apply ${replacementCount} ${pluralize('replacement', replacementCount)} in ${sectionCount} ${pluralize('section', sectionCount)}`
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`
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
