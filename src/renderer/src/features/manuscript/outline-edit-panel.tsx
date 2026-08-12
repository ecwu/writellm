import type {
  ManuscriptWorkspace,
  Section,
  SectionStatus
} from '../../../../shared/contracts/manuscript'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  ExternalLink,
  FileText,
  IndentDecrease,
  IndentIncrease,
  Plus,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  adjacentSectionAfterDelete,
  type OutlineMove,
  outlineMoveAvailability,
  outlineMoveTarget,
  outlineSelectionTarget,
  sectionHasChildren,
  visibleOutlineSections
} from './outline-tree'

type OutlineSaveState = 'saved' | 'saving' | 'failed'

interface MetadataDraft {
  sectionId: string
  title: string
  objective: string
}

interface CanonicalMetadata extends MetadataDraft {
  updatedAt: string
}

const statusLabels: Record<SectionStatus, string> = {
  planned: 'Planned',
  drafting: 'Drafting',
  completed: 'Completed'
}

const statusIcons = {
  planned: Circle,
  drafting: CircleDot,
  completed: CheckCircle2
} satisfies Record<SectionStatus, typeof Circle>

function metadataFromSection(section: Section): CanonicalMetadata {
  return {
    sectionId: section.sectionId,
    title: section.title,
    objective: section.objective ?? '',
    updatedAt: section.updatedAt
  }
}

function matchesMetadata(
  draft: Pick<MetadataDraft, 'title' | 'objective'>,
  canonical: Pick<MetadataDraft, 'title' | 'objective'>
): boolean {
  return draft.title === canonical.title && draft.objective === canonical.objective
}

export function OutlineEditPanel(props: {
  open: boolean
  workspace: ManuscriptWorkspace
  activeSectionId: string | null
  focusTarget?: { sectionId: string; field: 'objective'; from: number; to: number } | null
  onFocusTargetConsumed?(): void
  onRequestClose(): void
  onUpdateSection(
    sectionId: string,
    update: { title?: string; objective?: string | null; status?: SectionStatus }
  ): Promise<boolean>
  onMoveSection(
    sectionId: string,
    parentSectionId: string | null,
    position: number
  ): Promise<boolean>
  onCreateSection(parentSectionId: string | null, title: string): Promise<string | null>
  onDeleteSection(sectionId: string): Promise<boolean>
  onOpenSection(sectionId: string): Promise<boolean>
  onPreviewAll(): Promise<void>
}): React.JSX.Element {
  const sections = useMemo(
    () => props.workspace.sections.map((item) => item.section),
    [props.workspace.sections]
  )
  const summariesById = useMemo(
    () => new Map(props.workspace.sections.map((item) => [item.section.sectionId, item] as const)),
    [props.workspace.sections]
  )
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(() => new Set())
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [draft, setDraft] = useState<MetadataDraft | null>(null)
  const draftRef = useRef<MetadataDraft | null>(null)
  draftRef.current = draft
  const canonicalRef = useRef<CanonicalMetadata | null>(null)
  const [saveState, setSaveState] = useState<OutlineSaveState>('saved')
  const [externalConflict, setExternalConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined)
  const [createTitle, setCreateTitle] = useState('')
  const [deleteSectionId, setDeleteSectionId] = useState<string | null>(null)
  const objectiveRef = useRef<HTMLTextAreaElement>(null)

  const selectedSummary =
    selectedSectionId === null ? props.workspace.sections[0] : summariesById.get(selectedSectionId)
  const selectedSection = selectedSummary?.section
  const visibleSections = useMemo(
    () => visibleOutlineSections(sections, collapsedSectionIds),
    [collapsedSectionIds, sections]
  )
  const moveAvailability = useMemo(
    () =>
      selectedSection === undefined
        ? { up: false, down: false, indent: false, outdent: false }
        : outlineMoveAvailability(sections, selectedSection.sectionId),
    [sections, selectedSection]
  )
  const completedCount = props.workspace.sections.filter(
    (item) => item.section.status === 'completed'
  ).length
  const completion = props.workspace.sections.length
    ? (completedCount / props.workspace.sections.length) * 100
    : 0
  const titleInvalid = draft !== null && draft.title.trim().length === 0

  useEffect(() => {
    if (!props.open) return
    const next = outlineSelectionTarget(
      sections,
      selectedSectionId,
      props.activeSectionId,
      props.focusTarget?.sectionId
    )
    if (next !== selectedSectionId) {
      setSelectedSectionId(next)
      setMobileDetailOpen(false)
    }
  }, [props.activeSectionId, props.focusTarget?.sectionId, props.open, sections, selectedSectionId])

  useEffect(() => {
    const target = props.focusTarget
    if (
      !props.open ||
      target === null ||
      target === undefined ||
      draft?.sectionId !== target.sectionId
    )
      return
    const frame = window.requestAnimationFrame(() => {
      objectiveRef.current?.focus({ preventScroll: true })
      objectiveRef.current?.setSelectionRange(target.from, target.to)
      objectiveRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
      props.onFocusTargetConsumed?.()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [draft?.sectionId, props])

  useEffect(() => {
    if (!props.open || selectedSection === undefined) return
    const next = metadataFromSection(selectedSection)
    const currentDraft = draftRef.current
    const currentCanonical = canonicalRef.current
    if (
      currentDraft === null ||
      currentCanonical === null ||
      currentCanonical.sectionId !== selectedSection.sectionId
    ) {
      canonicalRef.current = next
      setDraft(next)
      setExternalConflict(false)
      setSaveState('saved')
      return
    }
    const locallyDirty = !matchesMetadata(currentDraft, currentCanonical)
    const matchesNext = matchesMetadata(currentDraft, next)
    const canonicalMetadataChanged = !matchesMetadata(currentCanonical, next)
    if (locallyDirty && !matchesNext && canonicalMetadataChanged) {
      setExternalConflict(true)
      return
    }
    canonicalRef.current = next
    if (!locallyDirty || matchesNext) setDraft(next)
    setExternalConflict(false)
    setSaveState('saved')
  }, [props.open, selectedSection])

  const focusTreeItem = (sectionId: string): void => {
    window.requestAnimationFrame(() => {
      document.getElementById(`outline-tree-item-${sectionId}`)?.focus()
    })
  }

  const setOperationBusy = (next: boolean): void => {
    busyRef.current = next
    setBusy(next)
  }

  const saveDraft = async (): Promise<boolean> => {
    const currentDraft = draftRef.current
    const currentCanonical = canonicalRef.current
    if (
      currentDraft === null ||
      currentCanonical === null ||
      currentDraft.sectionId !== currentCanonical.sectionId
    )
      return true
    const title = currentDraft.title.trim()
    if (title.length === 0) {
      setSaveState('failed')
      return false
    }
    const objective = currentDraft.objective.trim()
    if (title === currentCanonical.title && objective === currentCanonical.objective) {
      setSaveState('saved')
      return true
    }
    setOperationBusy(true)
    setSaveState('saving')
    const saved = await props.onUpdateSection(currentDraft.sectionId, {
      title,
      objective: objective.length === 0 ? null : objective
    })
    setOperationBusy(false)
    if (!saved) {
      setSaveState('failed')
      return false
    }
    const normalized = {
      ...currentDraft,
      title,
      objective
    }
    canonicalRef.current = {
      ...normalized,
      updatedAt: selectedSection?.updatedAt ?? currentCanonical.updatedAt
    }
    setDraft(normalized)
    setExternalConflict(false)
    setSaveState('saved')
    return true
  }

  const selectSection = async (sectionId: string): Promise<void> => {
    if (busyRef.current) return
    if (sectionId === selectedSectionId) {
      setMobileDetailOpen(true)
      focusTreeItem(sectionId)
      return
    }
    if (!(await saveDraft())) return
    setSelectedSectionId(sectionId)
    setMobileDetailOpen(true)
    focusTreeItem(sectionId)
  }

  const runImmediateOperation = async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (busyRef.current || !(await saveDraft())) return false
    setOperationBusy(true)
    setSaveState('saving')
    const succeeded = await operation()
    setOperationBusy(false)
    setSaveState(succeeded ? 'saved' : 'failed')
    return succeeded
  }

  const moveSelected = async (move: OutlineMove): Promise<void> => {
    if (selectedSection === undefined) return
    const target = outlineMoveTarget(sections, selectedSection.sectionId, move)
    if (target === null) return
    await runImmediateOperation(() =>
      props.onMoveSection(selectedSection.sectionId, target.parentSectionId, target.position)
    )
  }

  const requestClose = async (): Promise<void> => {
    if (!busyRef.current && (await saveDraft())) props.onRequestClose()
  }

  const scheduleDraftSave = (): void => {
    window.requestAnimationFrame(() => {
      if (!busyRef.current) void saveDraft()
    })
  }

  const reloadSelected = (): void => {
    if (selectedSection === undefined) return
    const next = metadataFromSection(selectedSection)
    canonicalRef.current = next
    setDraft(next)
    setExternalConflict(false)
    setSaveState('saved')
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (selectedSection === undefined) return
    const visibleIndex = visibleSections.findIndex(
      (section) => section.sectionId === selectedSection.sectionId
    )
    let targetId: string | undefined
    if (event.key === 'ArrowUp') targetId = visibleSections[visibleIndex - 1]?.sectionId
    else if (event.key === 'ArrowDown') targetId = visibleSections[visibleIndex + 1]?.sectionId
    else if (event.key === 'Home') targetId = visibleSections[0]?.sectionId
    else if (event.key === 'End') targetId = visibleSections.at(-1)?.sectionId
    else if (event.key === 'ArrowRight') {
      if (sectionHasChildren(sections, selectedSection.sectionId)) {
        if (collapsedSectionIds.has(selectedSection.sectionId)) {
          setCollapsedSectionIds((current) => {
            const next = new Set(current)
            next.delete(selectedSection.sectionId)
            return next
          })
        } else {
          targetId = sections.find(
            (section) => section.parentSectionId === selectedSection.sectionId
          )?.sectionId
        }
      }
    } else if (event.key === 'ArrowLeft') {
      if (
        sectionHasChildren(sections, selectedSection.sectionId) &&
        !collapsedSectionIds.has(selectedSection.sectionId)
      ) {
        setCollapsedSectionIds((current) => new Set(current).add(selectedSection.sectionId))
      } else {
        targetId = selectedSection.parentSectionId ?? undefined
      }
    } else return
    event.preventDefault()
    if (targetId !== undefined) void selectSection(targetId)
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) void requestClose()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className='h-[min(90vh,56rem)] w-[min(96vw,90rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none'
        >
          <div className='flex min-h-0 flex-col'>
            <header className='flex shrink-0 flex-col gap-4 border-b p-4 md:flex-row md:items-center md:px-6'>
              <DialogHeader className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <DialogTitle>Outline editor</DialogTitle>
                  <Badge
                    variant={saveState === 'failed' ? 'destructive' : 'outline'}
                    data-testid='outline-save-state'
                  >
                    {saveState === 'saving'
                      ? 'Saving…'
                      : saveState === 'failed'
                        ? 'Save failed'
                        : 'Saved'}
                  </Badge>
                </div>
                <DialogDescription>
                  Organize the complete manuscript outline and edit section planning metadata.
                </DialogDescription>
              </DialogHeader>
              <div className='flex flex-wrap items-center gap-2'>
                <Button variant='outline' size='sm' onClick={() => setCreateParentId(null)}>
                  <Plus data-icon='inline-start' /> New section
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    void saveDraft().then(async (saved) => {
                      if (saved) await props.onPreviewAll()
                    })
                  }
                >
                  <FileText data-icon='inline-start' /> Preview all
                </Button>
                <Button
                  size='sm'
                  disabled={busy || titleInvalid}
                  onClick={() => void requestClose()}
                >
                  Done
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Close outline editor'
                  disabled={busy}
                  onClick={() => void requestClose()}
                >
                  <X />
                </Button>
              </div>
            </header>

            <div className='grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(20rem,1.15fr)_minmax(22rem,0.85fr)]'>
              <section
                className={`${mobileDetailOpen ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-col border-r`}
                aria-label='Outline tree'
              >
                <div className='flex shrink-0 flex-col gap-2 border-b p-4'>
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <h2 className='font-medium'>Manuscript outline</h2>
                      <p className='text-xs text-muted-foreground'>
                        {completedCount} of {props.workspace.sections.length} sections completed
                      </p>
                    </div>
                    <Badge variant='secondary'>
                      {props.workspace.wordCount.toLocaleString()} words
                    </Badge>
                  </div>
                  <Progress
                    value={completion}
                    aria-label={`${completedCount} of ${props.workspace.sections.length} sections completed`}
                  />
                </div>
                <ScrollArea className='min-h-0 flex-1'>
                  <div
                    className='flex flex-col gap-1 p-2'
                    role='tree'
                    aria-label='Manuscript sections'
                    onKeyDown={handleTreeKeyDown}
                  >
                    {visibleSections.map((section) => {
                      const summary = summariesById.get(section.sectionId)
                      if (summary === undefined) return null
                      const hasChildren = sectionHasChildren(sections, section.sectionId)
                      const collapsed = collapsedSectionIds.has(section.sectionId)
                      const selected = section.sectionId === selectedSection?.sectionId
                      const active = section.sectionId === props.activeSectionId
                      const StatusIcon = statusIcons[section.status]
                      return (
                        <div
                          key={section.sectionId}
                          style={{ paddingInlineStart: `${Math.min(section.level - 1, 6) * 16}px` }}
                        >
                          <Item
                            role='treeitem'
                            aria-level={section.level}
                            aria-selected={selected}
                            aria-current={active ? 'page' : undefined}
                            aria-expanded={hasChildren ? !collapsed : undefined}
                            variant={selected ? 'muted' : 'default'}
                            size='sm'
                            className='flex-nowrap'
                            data-testid={`outline-editor-section-${section.sectionId}`}
                          >
                            {hasChildren ? (
                              <Button
                                variant='ghost'
                                size='icon-xs'
                                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${section.title}`}
                                onClick={() =>
                                  setCollapsedSectionIds((current) => {
                                    const next = new Set(current)
                                    if (next.has(section.sectionId)) next.delete(section.sectionId)
                                    else next.add(section.sectionId)
                                    return next
                                  })
                                }
                              >
                                {collapsed ? <ChevronRight /> : <ChevronDown />}
                              </Button>
                            ) : (
                              <span className='size-6 shrink-0' aria-hidden='true' />
                            )}
                            <ItemMedia>
                              <StatusIcon
                                className={
                                  section.status === 'completed' ? 'text-success' : undefined
                                }
                                aria-hidden='true'
                              />
                              <span className='sr-only'>{statusLabels[section.status]}</span>
                            </ItemMedia>
                            <button
                              id={`outline-tree-item-${section.sectionId}`}
                              type='button'
                              className='flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
                              tabIndex={selected ? 0 : -1}
                              onClick={() => void selectSection(section.sectionId)}
                            >
                              <ItemContent className='min-w-0'>
                                <ItemTitle className='max-w-full truncate'>
                                  {section.title}
                                </ItemTitle>
                                <ItemDescription className='line-clamp-1'>
                                  Level {section.level} ·{' '}
                                  {summary.revision.wordCount.toLocaleString()} words
                                </ItemDescription>
                              </ItemContent>
                              <ItemActions className='shrink-0'>
                                {active ? <Badge variant='outline'>Open</Badge> : null}
                                <Badge
                                  variant={
                                    section.status === 'completed'
                                      ? 'success'
                                      : section.status === 'drafting'
                                        ? 'secondary'
                                        : 'outline'
                                  }
                                  className='max-sm:hidden'
                                >
                                  {statusLabels[section.status]}
                                </Badge>
                              </ItemActions>
                            </button>
                          </Item>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </section>

              <section
                className={`${mobileDetailOpen ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col`}
                aria-label='Section inspector'
              >
                {selectedSection && selectedSummary && draft ? (
                  <>
                    <div className='flex shrink-0 items-center gap-3 border-b p-4 md:px-6'>
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        className='md:hidden'
                        aria-label='Back to outline'
                        onClick={() =>
                          void saveDraft().then((saved) => saved && setMobileDetailOpen(false))
                        }
                      >
                        <ArrowLeft />
                      </Button>
                      <div className='min-w-0 flex-1'>
                        <h2 className='truncate font-medium'>{selectedSection.title}</h2>
                        <p className='text-xs text-muted-foreground'>
                          Level {selectedSection.level} ·{' '}
                          {selectedSummary.revision.wordCount.toLocaleString()} words
                        </p>
                      </div>
                      {selectedSection.sectionId === props.activeSectionId ? (
                        <Badge variant='outline'>Open in editor</Badge>
                      ) : null}
                    </div>
                    <ScrollArea className='min-h-0 flex-1'>
                      <div className='mx-auto flex w-full max-w-2xl flex-col gap-7 p-4 md:p-6 lg:p-8'>
                        {externalConflict ? (
                          <Alert variant='destructive'>
                            <AlertCircle />
                            <AlertTitle>Outline changed elsewhere</AlertTitle>
                            <AlertDescription>
                              Your title and objective draft was preserved. Retry to apply it to the
                              latest outline, or reload the latest metadata.
                            </AlertDescription>
                          </Alert>
                        ) : saveState === 'failed' ? (
                          <Alert variant='destructive'>
                            <AlertCircle />
                            <AlertTitle>Changes not saved</AlertTitle>
                            <AlertDescription>
                              Your local metadata draft is still available. Retry after reviewing
                              the fields.
                            </AlertDescription>
                          </Alert>
                        ) : null}
                        {saveState === 'failed' || externalConflict ? (
                          <div className='flex flex-wrap gap-2'>
                            <Button
                              variant='outline'
                              disabled={busy || titleInvalid}
                              onClick={() => void saveDraft()}
                            >
                              {busy ? (
                                <Spinner data-icon='inline-start' />
                              ) : (
                                <RotateCcw data-icon='inline-start' />
                              )}
                              Retry
                            </Button>
                            <Button variant='ghost' disabled={busy} onClick={reloadSelected}>
                              Reload latest
                            </Button>
                          </div>
                        ) : null}

                        <FieldGroup>
                          <Field data-invalid={titleInvalid ? true : undefined}>
                            <FieldLabel htmlFor='outline-section-title'>Title</FieldLabel>
                            <Input
                              id='outline-section-title'
                              value={draft.title}
                              aria-invalid={titleInvalid ? true : undefined}
                              disabled={busy}
                              onBlur={scheduleDraftSave}
                              onChange={(event) =>
                                setDraft((current) =>
                                  current ? { ...current, title: event.target.value } : current
                                )
                              }
                            />
                            {titleInvalid ? (
                              <FieldError>Section titles cannot be empty.</FieldError>
                            ) : null}
                          </Field>
                          <Field>
                            <FieldLabel htmlFor='outline-section-objective'>
                              Section objective
                            </FieldLabel>
                            <Textarea
                              ref={objectiveRef}
                              id='outline-section-objective'
                              value={draft.objective}
                              disabled={busy}
                              placeholder='What should this section accomplish?'
                              onBlur={scheduleDraftSave}
                              onChange={(event) =>
                                setDraft((current) =>
                                  current ? { ...current, objective: event.target.value } : current
                                )
                              }
                            />
                            <FieldDescription>
                              This planning note is separate from the section body.
                            </FieldDescription>
                          </Field>
                          <Field>
                            <FieldLabel>Writing status</FieldLabel>
                            <ToggleGroup
                              type='single'
                              variant='outline'
                              value={selectedSection.status}
                              disabled={busy}
                              className='w-full'
                              onValueChange={(status) => {
                                if (!status) return
                                void runImmediateOperation(() =>
                                  props.onUpdateSection(selectedSection.sectionId, {
                                    status: status as SectionStatus
                                  })
                                )
                              }}
                            >
                              {(['planned', 'drafting', 'completed'] as const).map((status) => {
                                const StatusIcon = statusIcons[status]
                                return (
                                  <ToggleGroupItem key={status} value={status} className='flex-1'>
                                    <StatusIcon data-icon='inline-start' />
                                    {statusLabels[status]}
                                  </ToggleGroupItem>
                                )
                              })}
                            </ToggleGroup>
                            <FieldDescription>
                              Status changes only when you choose a value.
                            </FieldDescription>
                          </Field>
                        </FieldGroup>

                        <section
                          className='flex flex-col gap-3'
                          aria-labelledby='outline-structure'
                        >
                          <div>
                            <h3 id='outline-structure' className='text-sm font-medium'>
                              Structure
                            </h3>
                            <p className='text-sm text-muted-foreground'>
                              Move this section among its siblings or change its nesting level.
                            </p>
                          </div>
                          <div className='grid grid-cols-2 gap-2'>
                            <Button
                              variant='outline'
                              size='sm'
                              disabled={busy || !moveAvailability.up}
                              onClick={() => void moveSelected('up')}
                            >
                              <ArrowUp data-icon='inline-start' /> Up
                            </Button>
                            <Button
                              variant='outline'
                              size='sm'
                              disabled={busy || !moveAvailability.down}
                              onClick={() => void moveSelected('down')}
                            >
                              <ArrowDown data-icon='inline-start' /> Down
                            </Button>
                            <Button
                              variant='outline'
                              size='sm'
                              disabled={busy || !moveAvailability.indent}
                              onClick={() => void moveSelected('indent')}
                            >
                              <IndentIncrease data-icon='inline-start' /> Indent
                            </Button>
                            <Button
                              variant='outline'
                              size='sm'
                              disabled={busy || !moveAvailability.outdent}
                              onClick={() => void moveSelected('outdent')}
                            >
                              <IndentDecrease data-icon='inline-start' /> Outdent
                            </Button>
                          </div>
                        </section>

                        <section
                          className='flex flex-col gap-3'
                          aria-labelledby='outline-section-actions'
                        >
                          <div>
                            <h3 id='outline-section-actions' className='text-sm font-medium'>
                              Section actions
                            </h3>
                            <p className='text-sm text-muted-foreground'>
                              Create a nested section, open this section for writing, or remove an
                              eligible leaf.
                            </p>
                          </div>
                          <div className='flex flex-wrap gap-2'>
                            <Button
                              variant='outline'
                              disabled={busy}
                              onClick={() => setCreateParentId(selectedSection.sectionId)}
                            >
                              <Plus data-icon='inline-start' /> Add subsection
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void saveDraft().then(async (saved) => {
                                  if (!saved) return
                                  if (await props.onOpenSection(selectedSection.sectionId))
                                    props.onRequestClose()
                                })
                              }
                            >
                              <ExternalLink data-icon='inline-start' /> Open in editor
                            </Button>
                            <Button
                              variant='destructive'
                              disabled={
                                busy ||
                                props.workspace.sections.length <= 1 ||
                                sectionHasChildren(sections, selectedSection.sectionId)
                              }
                              onClick={() => setDeleteSectionId(selectedSection.sectionId)}
                            >
                              <Trash2 data-icon='inline-start' /> Delete
                            </Button>
                          </div>
                          {sectionHasChildren(sections, selectedSection.sectionId) ? (
                            <p className='text-xs text-muted-foreground'>
                              Move or delete child sections before deleting this section.
                            </p>
                          ) : props.workspace.sections.length <= 1 ? (
                            <p className='text-xs text-muted-foreground'>
                              The final manuscript section cannot be deleted.
                            </p>
                          ) : null}
                        </section>
                      </div>
                    </ScrollArea>
                  </>
                ) : (
                  <div className='flex h-full items-center justify-center p-6 text-sm text-muted-foreground'>
                    Select a section to inspect it.
                  </div>
                )}
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createParentId !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setCreateParentId(undefined)
            setCreateTitle('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create section</DialogTitle>
            <DialogDescription>
              {createParentId === null
                ? 'Add a top-level section to the manuscript.'
                : 'Add a subsection beneath the selected section.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={createTitle.length > 0 && createTitle.trim().length === 0}>
              <FieldLabel htmlFor='new-outline-section-title'>Section title</FieldLabel>
              <Input
                id='new-outline-section-title'
                autoFocus
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateParentId(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={busy || createTitle.trim().length === 0}
              onClick={() => {
                if (createParentId === undefined) return
                void (async () => {
                  if (!(await saveDraft())) return
                  setOperationBusy(true)
                  setSaveState('saving')
                  const createdId = await props.onCreateSection(createParentId, createTitle.trim())
                  setOperationBusy(false)
                  setSaveState(createdId === null ? 'failed' : 'saved')
                  if (createdId === null) return
                  setCreateParentId(undefined)
                  setCreateTitle('')
                  setSelectedSectionId(createdId)
                  setMobileDetailOpen(true)
                })()
              }}
            >
              {busy ? <Spinner data-icon='inline-start' /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteSectionId !== null}
        onOpenChange={(open) => !open && setDeleteSectionId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the section from the active outline. Its revisions and Agent lineage
              remain available for audit, and the section cannot be restored from the current UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                if (deleteSectionId === null) return
                const targetId = deleteSectionId
                const fallbackId = adjacentSectionAfterDelete(sections, targetId)
                void (async () => {
                  if (await runImmediateOperation(() => props.onDeleteSection(targetId))) {
                    setDeleteSectionId(null)
                    setSelectedSectionId(fallbackId)
                    setMobileDetailOpen(fallbackId !== null)
                  }
                })()
              }}
            >
              Delete section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
