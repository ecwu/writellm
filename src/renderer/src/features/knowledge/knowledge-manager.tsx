import type { KnowledgeIndexStatus, KnowledgeItem } from '../../../../shared/contracts/knowledge'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import type {
  BibliographyConfirmImportSelection,
  BibliographyImportOutcome,
  BibliographyImportPlan,
  BibliographySnapshot,
  LegacyCitationConversionPlan,
  ReferenceItem
} from '../../../../shared/contracts/references'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  File,
  FileCheck2,
  FileUp,
  FolderOpen,
  Library,
  Link2,
  MoreHorizontal,
  PanelLeft,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from '@/components/ui/sidebar'
import { WorkspaceRail } from '@/components/app-sidebar'
import { KnowledgeSearch } from './knowledge-search'
import { ParsedDocumentViewer } from './parsed-document-viewer'

const activeParseStates = new Set([
  'queued',
  'allocating',
  'awaiting_upload',
  'polling',
  'downloading',
  'extracting',
  'publishing'
])

export function KnowledgeManager(props: {
  projectSessionId: string
  projectName: string
  onOpenManuscript(): void
  onInsertCitation(citationKey: string): void
  onOpenNotebook?(): void
  onOpenPreview(): void
  onOpenAssets(): void
  onOpenChecks(): void
  onOpenReferences(): void
  onOpenWritingRules(): void
  onOpenFind(): void
  onOpenSettings(): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const key = useMemo(
    () => ['knowledge-items', props.projectSessionId] as const,
    [props.projectSessionId]
  )
  const jobsKey = useMemo(
    () => ['knowledge-jobs', props.projectSessionId] as const,
    [props.projectSessionId]
  )
  const itemsQuery = useQuery({
    queryKey: key,
    queryFn: () => window.desktop.knowledge.list({ projectSessionId: props.projectSessionId }),
    refetchInterval: ({ state }) => (hasActiveKnowledgeWork(state.data ?? []) ? 1_000 : false)
  })
  const items = itemsQuery.data ?? []
  const [referenceQuery, setReferenceQuery] = useState('')
  const referencesKey = useMemo(
    () => ['reference-items', props.projectSessionId, referenceQuery] as const,
    [props.projectSessionId, referenceQuery]
  )
  const referencesQuery = useQuery({
    queryKey: referencesKey,
    queryFn: () =>
      window.desktop.knowledge.listReferences({
        projectSessionId: props.projectSessionId,
        query: referenceQuery
      })
  })
  const connectorKey = useMemo(
    () => ['bibliography-snapshot', props.projectSessionId] as const,
    [props.projectSessionId]
  )
  const connectorQuery = useQuery({
    queryKey: connectorKey,
    queryFn: () =>
      window.desktop.knowledge.bibliographySnapshot({ projectSessionId: props.projectSessionId }),
    retry: false
  })
  const references = referencesQuery.data ?? []
  const jobsQuery = useQuery({
    queryKey: jobsKey,
    queryFn: () =>
      window.desktop.jobs.list({ projectSessionId: props.projectSessionId, limit: 100 }),
    refetchInterval: ({ state }) =>
      state.data?.jobs.some((job) => job.state === 'queued' || job.state === 'running')
        ? 1_000
        : false
  })
  const indexStatusQuery = useQuery({
    queryKey: ['knowledge-index-status', props.projectSessionId],
    queryFn: () =>
      window.desktop.knowledge.indexStatus({ projectSessionId: props.projectSessionId }),
    refetchInterval: ({ state }) =>
      state.data?.readiness === 'preparing' ||
      (state.data?.readiness === 'available' && !state.data.indexed)
        ? 1_000
        : false,
    retry: false
  })
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null)
  const [importSnapshot, setImportSnapshot] = useState<BibliographySnapshot | null>(null)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set())
  const [importPdf, setImportPdf] = useState(true)
  const [importPlan, setImportPlan] = useState<BibliographyImportPlan | null>(null)
  const [importSelections, setImportSelections] = useState<
    Map<string, BibliographyConfirmImportSelection>
  >(new Map())
  const [importOutcomes, setImportOutcomes] = useState<BibliographyImportOutcome[] | null>(null)
  const [conversionPlan, setConversionPlan] = useState<LegacyCitationConversionPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (selectedItemId !== null && !items.some((item) => item.knowledgeItemId === selectedItemId)) {
      setSelectedItemId(null)
    }
  }, [items, selectedItemId])

  useEffect(() => {
    if (hasActiveKnowledgeWork(items)) {
      void queryClient.invalidateQueries({ queryKey: jobsKey })
    }
  }, [items, jobsKey, queryClient])

  const selectedItem = items.find((item) => item.knowledgeItemId === selectedItemId)
  const selectedReference = references.find(
    (reference) => reference.referenceId === selectedReferenceId
  )
  const jobs = jobsQuery.data?.jobs ?? []
  const stats = getStats(items, jobs)
  const embeddingInProgress = jobs.some(
    (job) =>
      job.type === 'build_embedding_generation' &&
      (job.state === 'queued' || job.state === 'running')
  )
  const parsingInProgress = items.some(hasActiveKnowledgeWorkForItem)

  const replace = (nextItems: KnowledgeItem[]): void => {
    queryClient.setQueryData(key, nextItems)
  }
  const run = async (operation: () => Promise<KnowledgeItem[]>): Promise<void> => {
    setBusy(true)
    try {
      replace(await operation())
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: jobsKey }),
        queryClient.invalidateQueries({
          queryKey: ['reference-items', props.projectSessionId]
        })
      ])
    } catch {
      props.onError('One or more knowledge files could not be imported or updated.')
      await itemsQuery.refetch()
    } finally {
      setBusy(false)
    }
  }
  const importFiles = (): void => {
    void run(() =>
      window.desktop.knowledge.chooseAndImport({ projectSessionId: props.projectSessionId })
    )
  }
  const chooseBibliography = async (): Promise<void> => {
    setBusy(true)
    try {
      const snapshot = await window.desktop.knowledge.chooseBibliography({
        projectSessionId: props.projectSessionId
      })
      if (snapshot === null) return
      queryClient.setQueryData(connectorKey, snapshot)
      setImportSnapshot(snapshot)
      setImportPlan(null)
      setImportOutcomes(null)
      setImportPdf(true)
      setSelectedCandidateIds(
        new Set(
          snapshot.candidates
            .filter((candidate) => candidate.alreadyImportedReferenceId === null)
            .map((candidate) => candidate.candidateId)
        )
      )
    } catch {
      props.onError('The Zotero bibliography could not be connected or parsed.')
    } finally {
      setBusy(false)
    }
  }
  const refreshBibliography = async (): Promise<void> => {
    setBusy(true)
    try {
      const snapshot = await window.desktop.knowledge.refreshBibliography({
        projectSessionId: props.projectSessionId
      })
      queryClient.setQueryData(connectorKey, snapshot)
      if (snapshot !== null) setImportSnapshot(snapshot)
      await queryClient.invalidateQueries({ queryKey: ['reference-items', props.projectSessionId] })
    } catch {
      props.onError('Zotero sync failed. The last valid project metadata was preserved.')
    } finally {
      setBusy(false)
    }
  }
  const prepareReferenceImport = async (
    candidateIds: Set<string> = selectedCandidateIds
  ): Promise<void> => {
    if (importSnapshot === null || candidateIds.size === 0) return
    if (importPdf && candidateIds.size > 50) {
      props.onError(
        'PDF review supports up to 50 references at once. Select fewer or turn off PDF import.'
      )
      return
    }
    setBusy(true)
    try {
      const plan = await window.desktop.knowledge.prepareReferenceImport({
        projectSessionId: props.projectSessionId,
        connectorId: importSnapshot.connector.connectorId,
        candidateIds: [...candidateIds],
        includePdf: importPdf
      })
      setSelectedCandidateIds(candidateIds)
      setImportPlan(plan)
      setImportOutcomes(null)
      setImportSelections(
        new Map(
          plan.items.map((item) => [
            item.candidateId,
            {
              candidateId: item.candidateId,
              targetReferenceId: null,
              primaryAttachmentId: item.attachments[0]?.attachmentId ?? null,
              supplementAttachmentIds: []
            }
          ])
        )
      )
    } catch {
      props.onError(
        'The references could not be prepared. The bibliography may have changed; review the list again.'
      )
    } finally {
      setBusy(false)
    }
  }
  const confirmReferenceImport = async (): Promise<void> => {
    if (importPlan === null) return
    setBusy(true)
    try {
      const result = await window.desktop.knowledge.confirmReferenceImport({
        projectSessionId: props.projectSessionId,
        previewId: importPlan.previewId,
        selections: importPlan.items.map((item) => {
          const selection = importSelections.get(item.candidateId)
          if (selection === undefined) throw new Error('Import selection is incomplete')
          return selection
        })
      })
      setImportOutcomes(result.outcomes)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reference-items', props.projectSessionId] }),
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: jobsKey })
      ])
    } catch {
      setImportPlan(null)
      setImportOutcomes(null)
      props.onError(
        'The import review expired or the bibliography changed. Your selected references are preserved; review them again.'
      )
    } finally {
      setBusy(false)
    }
  }
  const closeReferenceImport = (): void => {
    setImportSnapshot(null)
    setImportPlan(null)
    setImportOutcomes(null)
    setImportSelections(new Map())
  }
  const reviewFailedReferences = (): void => {
    const retryIds = new Set(
      (importOutcomes ?? [])
        .filter((outcome) => outcome.state === 'failed' || outcome.state === 'partial')
        .map((outcome) => outcome.candidateId)
    )
    setImportPlan(null)
    setImportOutcomes(null)
    void prepareReferenceImport(retryIds)
  }
  const importDropped = (files: File[]): void => {
    if (files.length === 0) return
    void run(() =>
      window.desktop.knowledge.importDropped({ projectSessionId: props.projectSessionId, files })
    )
  }
  const parseSelected = async (): Promise<void> => {
    if (selectedItemId === null) return
    setBusy(true)
    try {
      await window.desktop.knowledge.startParse({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: selectedItemId
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: jobsKey }),
        queryClient.invalidateQueries({
          queryKey: ['parsed-knowledge', props.projectSessionId, selectedItemId]
        })
      ])
    } catch {
      props.onError('MinerU parsing could not be started. Check the MinerU provider settings.')
    } finally {
      setBusy(false)
    }
  }
  const refreshEmbeddings = async (knowledgeItemId?: string): Promise<void> => {
    setBusy(true)
    try {
      await window.desktop.knowledge.refreshEmbeddings({
        projectSessionId: props.projectSessionId,
        ...(knowledgeItemId === undefined ? {} : { knowledgeItemId })
      })
      await queryClient.invalidateQueries({ queryKey: jobsKey })
    } catch {
      props.onError(
        embeddingInProgress
          ? 'Embedding is already running. Wait for the current task to finish.'
          : 'Embedding could not be started. Check the embedding provider and search index status.'
      )
    } finally {
      setBusy(false)
    }
  }
  const reparseAll = async (): Promise<void> => {
    const sources = items.filter((item) => item.state === 'stored')
    if (sources.length === 0) return
    setBusy(true)
    let failedCount = 0
    try {
      for (const item of sources) {
        try {
          await window.desktop.knowledge.startParse({
            projectSessionId: props.projectSessionId,
            knowledgeItemId: item.knowledgeItemId
          })
        } catch {
          failedCount += 1
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: jobsKey })
      ])
      if (failedCount > 0) {
        props.onError(
          `${failedCount} ${failedCount === 1 ? 'source' : 'sources'} could not be submitted to MinerU.`
        )
      }
    } catch {
      props.onError('The MinerU processing queue could not be refreshed. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const deleteSelected = (): void => {
    if (selectedItemId === null) return
    void run(async () => {
      const next = await window.desktop.knowledge.delete({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: selectedItemId
      })
      return next
    })
  }
  const exportBibliography = async (
    format: 'bibtex' | 'csl-json',
    scope: 'cited-only' | 'all-project'
  ): Promise<void> => {
    try {
      await window.desktop.knowledge.exportBibliography({
        projectSessionId: props.projectSessionId,
        format,
        scope
      })
    } catch {
      props.onError('The bibliography could not be exported.')
    }
  }
  const setCitationStyle = async (styleId: 'apa' | 'ieee' | 'vancouver'): Promise<void> => {
    try {
      await window.desktop.knowledge.setReferenceSettings({
        projectSessionId: props.projectSessionId,
        styleId,
        locale: 'en-US'
      })
    } catch {
      props.onError('The citation style could not be changed.')
    }
  }
  const chooseCustomStyle = async (): Promise<void> => {
    try {
      await window.desktop.knowledge.chooseCustomReferenceStyle({
        projectSessionId: props.projectSessionId
      })
    } catch {
      props.onError('The CSL file is invalid or is not an in-text citation style.')
    }
  }
  const planLegacyConversion = async (): Promise<void> => {
    try {
      setConversionPlan(
        await window.desktop.knowledge.planLegacyCitationConversion({
          projectSessionId: props.projectSessionId
        })
      )
    } catch {
      props.onError('Legacy citations could not be analyzed.')
    }
  }
  const applyLegacyConversion = async (): Promise<void> => {
    if (conversionPlan === null) return
    setBusy(true)
    try {
      await window.desktop.knowledge.applyLegacyCitationConversion({
        projectSessionId: props.projectSessionId,
        planId: conversionPlan.planId
      })
      setConversionPlan(null)
    } catch {
      props.onError('The manuscript changed; create and review a new conversion plan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SidebarProvider
      data-testid='knowledge-workspace'
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '340px' } as React.CSSProperties}
    >
      <Sidebar
        collapsible='icon'
        className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      >
        <WorkspaceRail
          activeWorkspace='knowledge'
          onOpenPreview={props.onOpenPreview}
          onOpenKnowledge={() => undefined}
          onOpenNotebook={props.onOpenNotebook}
          onOpenAssets={props.onOpenAssets}
          onOpenChecks={props.onOpenChecks}
          onOpenManuscript={props.onOpenManuscript}
          onOpenReferences={props.onOpenReferences}
          onOpenWritingRules={props.onOpenWritingRules}
          onOpenFind={props.onOpenFind}
          onOpenSettings={props.onOpenSettings}
        />
        <KnowledgeSidebar
          references={references}
          items={items}
          jobs={jobs}
          selectedItemId={selectedItemId}
          dragging={dragging}
          busy={busy}
          onSelect={setSelectedItemId}
          onSelectReference={(reference) => {
            setSelectedReferenceId(reference.referenceId)
            setSelectedItemId(reference.knowledgeItemIds[0] ?? null)
          }}
          referenceQuery={referenceQuery}
          onReferenceQueryChange={setReferenceQuery}
          onImport={importFiles}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDrop={(files) => {
            setDragging(false)
            importDropped(files)
          }}
        />
      </Sidebar>
      <SidebarInset className='min-h-0 overflow-auto'>
        <header className='sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background p-4'>
          <SidebarTrigger className='-ml-1' />
          <Separator orientation='vertical' className='mr-2 data-[orientation=vertical]:h-4' />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{props.projectName}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbItem>
                <BreadcrumbPage>Knowledge</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className='ml-auto flex min-w-0 items-center gap-2'>
            <KnowledgeHeaderStats
              stats={stats}
              indexStatus={indexStatusQuery.data}
              indexStatusUnavailable={indexStatusQuery.isError}
            />
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => void chooseBibliography()}
            >
              <Link2 /> Connect Zotero export…
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='icon-sm' aria-label='Knowledge actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    data-testid='knowledge-reparse-all-action'
                    disabled={busy || parsingInProgress || stats.stored === 0}
                    onClick={() => void reparseAll()}
                  >
                    {parsingInProgress ? <Spinner /> : <RefreshCw />}
                    {parsingInProgress
                      ? 'MinerU processing in progress'
                      : 'Reprocess all with MinerU'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy || connectorQuery.data === null}
                    onClick={() => void refreshBibliography()}
                  >
                    <RefreshCw /> Refresh bibliography
                  </DropdownMenuItem>
                  {connectorQuery.data !== null && connectorQuery.data !== undefined ? (
                    <DropdownMenuItem
                      onClick={() => setImportSnapshot(connectorQuery.data ?? null)}
                    >
                      <Upload /> Import available references
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void exportBibliography('bibtex', 'cited-only')}>
                    Export cited references (.bib)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void exportBibliography('csl-json', 'all-project')}
                  >
                    Export all references (CSL JSON)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void setCitationStyle('apa')}>
                    Use APA style
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void setCitationStyle('ieee')}>
                    Use IEEE style
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void setCitationStyle('vancouver')}>
                    Use Vancouver style
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void chooseCustomStyle()}>
                    Import custom CSL style…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void planLegacyConversion()}>
                    Convert legacy title citations…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid='knowledge-reembed-all-action'
                    disabled={busy || embeddingInProgress || stats.parsed === 0}
                    onClick={() => void refreshEmbeddings()}
                  >
                    {embeddingInProgress ? <Spinner /> : <Zap />}
                    {embeddingInProgress ? 'Embedding in progress' : 'Recalculate all embeddings'}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className='mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 md:px-8'>
          {itemsQuery.isError ? (
            <div className='mt-6 flex items-center gap-2 border-y border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive'>
              <AlertCircle className='size-4' /> Knowledge files could not be loaded.
            </div>
          ) : null}
          {selectedReference !== undefined && selectedItem === undefined ? (
            <ReferenceDetails
              reference={selectedReference}
              onInsertCitation={props.onInsertCitation}
              onClose={() => setSelectedReferenceId(null)}
            />
          ) : selectedItem ? (
            <KnowledgeDetails
              projectSessionId={props.projectSessionId}
              item={selectedItem}
              reference={selectedReference}
              busy={busy}
              embeddingInProgress={embeddingInProgress}
              onParse={() => void parseSelected()}
              onRefreshEmbeddings={() => void refreshEmbeddings(selectedItem.knowledgeItemId)}
              onCancelParse={async () => {
                if (selectedItemId === null) return
                setBusy(true)
                try {
                  await window.desktop.knowledge.cancelParse({
                    projectSessionId: props.projectSessionId,
                    knowledgeItemId: selectedItemId
                  })
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: key }),
                    queryClient.invalidateQueries({ queryKey: jobsKey }),
                    queryClient.invalidateQueries({
                      queryKey: ['parsed-knowledge', props.projectSessionId, selectedItemId]
                    })
                  ])
                } catch {
                  props.onError('MinerU parsing could not be stopped. Please try again.')
                } finally {
                  setBusy(false)
                }
              }}
              onOpen={() =>
                void window.desktop.knowledge.openOriginal({
                  projectSessionId: props.projectSessionId,
                  knowledgeItemId: selectedItem.knowledgeItemId
                })
              }
              onReveal={() =>
                void window.desktop.knowledge.reveal({
                  projectSessionId: props.projectSessionId,
                  knowledgeItemId: selectedItem.knowledgeItemId
                })
              }
              onDelete={deleteSelected}
              onInsertCitation={props.onInsertCitation}
              onClose={() => setSelectedItemId(null)}
              onError={props.onError}
            />
          ) : (
            <KnowledgeOverview
              references={references}
              items={items}
              projectSessionId={props.projectSessionId}
              indexStatus={indexStatusQuery.data}
              indexStatusUnavailable={indexStatusQuery.isError}
              onError={props.onError}
            />
          )}
        </main>
      </SidebarInset>
      <ReferenceImportDialog
        snapshot={importSnapshot}
        plan={importPlan}
        outcomes={importOutcomes}
        selectedIds={selectedCandidateIds}
        selections={importSelections}
        busy={busy}
        importPdf={importPdf}
        onImportPdfChange={setImportPdf}
        onSelectedIdsChange={setSelectedCandidateIds}
        onSelectionsChange={setImportSelections}
        onBack={() => {
          setImportPlan(null)
          setImportOutcomes(null)
        }}
        onClose={closeReferenceImport}
        onReview={() => void prepareReferenceImport()}
        onConfirm={() => void confirmReferenceImport()}
        onReviewAgain={reviewFailedReferences}
      />
      <LegacyConversionDialog
        plan={conversionPlan}
        busy={busy}
        onClose={() => setConversionPlan(null)}
        onApply={() => void applyLegacyConversion()}
      />
    </SidebarProvider>
  )
}

function KnowledgeOverview(props: {
  references: ReferenceItem[]
  items: KnowledgeItem[]
  projectSessionId: string
  indexStatus: KnowledgeIndexStatus | undefined
  indexStatusUnavailable: boolean
  onError(message: string): void
}): React.JSX.Element {
  return (
    <section className='flex min-h-[calc(100dvh-6.5rem)] flex-1 justify-center py-12'>
      <div className='w-full max-w-3xl'>
        <div className='mb-6'>
          <h1 className='flex items-center gap-2 text-xl font-semibold tracking-tight'>
            <Library className='size-5' /> Reference library
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            {props.references.length} references. Search evidence across attached, parsed sources.
          </p>
        </div>
        <KnowledgeSearch
          projectSessionId={props.projectSessionId}
          items={props.items}
          disabled={
            props.indexStatus?.readiness !== 'available' || props.indexStatus.indexed === false
          }
          unavailable={
            props.indexStatusUnavailable || props.indexStatus?.readiness === 'unavailable'
          }
          onError={props.onError}
        />
        {props.items.length === 0 ? (
          <p className='mt-8 border-y py-6 text-center text-sm text-muted-foreground'>
            Upload and parse a source to make it searchable.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function KnowledgeSidebar(props: {
  references: ReferenceItem[]
  items: KnowledgeItem[]
  jobs: JobStatus[]
  selectedItemId: string | null
  dragging: boolean
  busy: boolean
  onSelect(id: string): void
  onSelectReference(reference: ReferenceItem): void
  referenceQuery: string
  onReferenceQueryChange(query: string): void
  onImport(): void
  onDragEnter(): void
  onDragLeave(): void
  onDrop(files: File[]): void
}): React.JSX.Element {
  const activeJobs = props.jobs.filter((job) => job.state === 'queued' || job.state === 'running')
  const linkedKnowledgeItemIds = new Set(
    props.references.flatMap((reference) => reference.knowledgeItemIds)
  )
  const unlinkedItems = props.items.filter(
    (item) => !linkedKnowledgeItemIds.has(item.knowledgeItemId)
  )
  return (
    <Sidebar collapsible='none' className='hidden flex-1 md:flex'>
      <div className='border-b p-4'>
        <div className='flex items-center justify-between gap-2'>
          <div className='min-w-0'>
            <p className='text-sm font-semibold'>References</p>
            <p className='text-xs text-muted-foreground'>{props.references.length} references</p>
            <p className='text-xs text-muted-foreground'>
              {props.items.length} files in this project
            </p>
          </div>
          <Button
            data-testid='knowledge-upload-button'
            size='icon-sm'
            variant='outline'
            aria-label='Upload files'
            onClick={props.onImport}
            disabled={props.busy}
          >
            {props.busy ? <Spinner /> : <FileUp />}
          </Button>
        </div>
        <button
          type='button'
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 text-xs text-muted-foreground transition-[min-height,background-color] outline-none focus-visible:ring-2 focus-visible:ring-ring ${props.dragging ? 'min-h-24 border-primary bg-primary/5 text-primary' : 'min-h-9 hover:bg-muted/50'}`}
          onClick={props.onImport}
          onDragEnter={(event) => {
            event.preventDefault()
            props.onDragEnter()
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            props.onDragLeave()
          }}
          onDrop={(event) => {
            event.preventDefault()
            props.onDrop(Array.from(event.dataTransfer.files))
          }}
        >
          <FileUp className='size-3.5' />
          {props.dragging ? 'Drop files to upload' : 'Drop files here'}
        </button>
        <div className='relative mt-3'>
          <Search className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            aria-label='Search references'
            className='h-8 pl-8 text-xs'
            placeholder='Title, author, venue, year, key'
            value={props.referenceQuery}
            onChange={(event) => props.onReferenceQueryChange(event.target.value)}
          />
        </div>
      </div>
      <SidebarContent>
        <SidebarGroup className='py-3'>
          <SidebarGroupLabel className='px-3'>Library</SidebarGroupLabel>
          <div className='grid gap-1 px-2'>
            {props.references.map((reference) => {
              const item = props.items.find((candidate) =>
                reference.knowledgeItemIds.includes(candidate.knowledgeItemId)
              )
              const parsing = isParseInProgress(item?.parseState)
              const failed =
                item?.state === 'failed' ||
                item?.parseState === 'failed' ||
                item?.normalizationState === 'failed'
              return (
                <button
                  type='button'
                  key={reference.referenceId}
                  data-testid={
                    item === undefined
                      ? `knowledge-reference-${reference.referenceId}`
                      : `knowledge-file-${item.knowledgeItemId}`
                  }
                  data-reference-id={reference.referenceId}
                  className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring ${item !== undefined && props.selectedItemId === item.knowledgeItemId ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}`}
                  onClick={() => props.onSelectReference(reference)}
                >
                  {parsing || item?.state === 'importing' ? (
                    <Spinner className='shrink-0 text-primary' />
                  ) : failed ? (
                    <AlertCircle className='size-4 shrink-0 text-destructive' />
                  ) : reference.evidenceAvailable ? (
                    <FileCheck2 className='shrink-0 text-success' />
                  ) : (
                    <File className='size-4 shrink-0 text-muted-foreground' />
                  )}
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{reference.title}</span>
                    <span className='block truncate text-[10px] text-muted-foreground'>
                      {reference.creators.find((creator) => creator.role === 'author')?.family ??
                        reference.containerTitle ??
                        'Citation details incomplete'}{' '}
                      · @{reference.citationKey}
                    </span>
                  </span>
                  <Badge variant='outline' className='h-5 px-1 text-[9px]'>
                    {reference.evidenceAvailable
                      ? 'Evidence ready'
                      : item === undefined
                        ? 'Citation only'
                        : 'PDF processing'}
                  </Badge>
                </button>
              )
            })}
            {unlinkedItems.map((item) => {
              const failed =
                item.state === 'failed' ||
                item.parseState === 'failed' ||
                item.normalizationState === 'failed'
              return (
                <button
                  type='button'
                  key={item.knowledgeItemId}
                  data-testid={`knowledge-file-${item.knowledgeItemId}`}
                  className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring ${props.selectedItemId === item.knowledgeItemId ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}`}
                  onClick={() => props.onSelect(item.knowledgeItemId)}
                >
                  {item.state === 'importing' ? (
                    <Spinner className='shrink-0 text-primary' />
                  ) : failed ? (
                    <AlertCircle className='size-4 shrink-0 text-destructive' />
                  ) : (
                    <File className='size-4 shrink-0 text-muted-foreground' />
                  )}
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{item.displayName}</span>
                    <span className='block truncate text-[10px] text-muted-foreground'>
                      {item.state === 'importing' ? 'Importing file' : 'Preparing citation details'}
                    </span>
                  </span>
                  <Badge variant='outline' className='h-5 px-1 text-[9px]'>
                    {item.state}
                  </Badge>
                </button>
              )
            })}
            {props.references.length === 0 && unlinkedItems.length === 0 ? (
              <p className='px-2 py-6 text-center text-xs text-muted-foreground'>
                No references yet.
              </p>
            ) : null}
            {props.items.length === 0 ? (
              <p className='px-2 py-3 text-center text-xs text-muted-foreground'>No files yet.</p>
            ) : null}
          </div>
        </SidebarGroup>
        <SidebarGroup className='border-t py-3'>
          <SidebarGroupLabel className='flex items-center justify-between px-3'>
            <span>Task progress</span>
            {activeJobs.length > 0 ? <Badge variant='secondary'>{activeJobs.length}</Badge> : null}
          </SidebarGroupLabel>
          <div className='grid gap-2 px-3'>
            {props.jobs.slice(0, 8).map((job) => (
              <TaskRow key={job.jobId} job={job} />
            ))}
            {props.jobs.length === 0 ? (
              <p className='text-xs text-muted-foreground'>No background tasks.</p>
            ) : null}
          </div>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

function ReferenceDetails(props: {
  reference: ReferenceItem
  onInsertCitation(citationKey: string): void
  onClose(): void
}): React.JSX.Element {
  const authors = props.reference.creators
    .filter((creator) => creator.role === 'author')
    .map((creator) => creator.literal ?? [creator.given, creator.family].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(', ')
  const copyCitation = async (): Promise<void> => {
    await navigator.clipboard.writeText(`[@${props.reference.citationKey}]`)
  }
  return (
    <section className='mx-auto w-full max-w-4xl py-8'>
      <div className='flex items-start justify-between gap-4 border-b pb-6'>
        <div className='min-w-0'>
          <div className='mb-2 flex flex-wrap items-center gap-2'>
            <Badge variant={props.reference.evidenceAvailable ? 'default' : 'secondary'}>
              {props.reference.evidenceAvailable
                ? 'Evidence ready'
                : props.reference.knowledgeItemIds.length > 0
                  ? 'PDF processing'
                  : 'Citation only'}
            </Badge>
            <Badge variant='outline'>{props.reference.metadataCompleteness}</Badge>
            <Badge variant='outline'>{props.reference.syncStatus.replace('_', ' ')}</Badge>
          </div>
          <h1 className='text-2xl font-semibold tracking-tight'>{props.reference.title}</h1>
          <p className='mt-2 text-sm text-muted-foreground'>
            {[authors, props.reference.containerTitle, props.reference.issuedYear]
              .filter((value) => value !== null && value !== '')
              .join(' · ') || 'Citation details are incomplete.'}
          </p>
        </div>
        <Button variant='ghost' size='icon-sm' aria-label='Close reference' onClick={props.onClose}>
          <X />
        </Button>
      </div>
      <div className='grid gap-6 py-6 md:grid-cols-[minmax(0,1fr)_auto]'>
        <div className='grid gap-6'>
          <div>
            <h2 className='text-sm font-semibold'>Citation details</h2>
            <dl className='mt-3 grid gap-4 text-sm sm:grid-cols-2'>
              <MetadataField label='Citation key' value={`@${props.reference.citationKey}`} />
              <MetadataField label='Type' value={props.reference.cslType} />
              <MetadataField label='DOI' value={props.reference.doi ?? '—'} />
              <MetadataField label='ISBN' value={props.reference.isbn ?? '—'} />
              <MetadataField label='URL' value={props.reference.url ?? '—'} />
            </dl>
          </div>
          <div>
            <h2 className='text-sm font-semibold'>Files</h2>
            <dl className='mt-3 grid gap-4 text-sm sm:grid-cols-2'>
              <MetadataField
                label='Primary PDF and supplementary files'
                value={
                  props.reference.knowledgeItemIds.length === 0
                    ? 'No PDF attached'
                    : `${props.reference.knowledgeItemIds.length} linked file${props.reference.knowledgeItemIds.length === 1 ? '' : 's'}`
                }
              />
            </dl>
          </div>
        </div>
        <div className='flex flex-wrap content-start gap-2 md:w-48 md:flex-col'>
          <Button onClick={() => void copyCitation()}>
            <Link2 /> Copy citation
          </Button>
          <Button
            variant='outline'
            onClick={() => props.onInsertCitation(props.reference.citationKey)}
          >
            Insert in editor
          </Button>
          <p className='text-xs text-muted-foreground'>
            Citation-only references can be used manually and exported, but are never offered to the
            Agent as evidence.
          </p>
        </div>
      </div>
    </section>
  )
}

function MetadataField(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className='min-w-0'>
      <dt className='text-xs font-medium text-muted-foreground'>{props.label}</dt>
      <dd className='mt-1 break-words'>{props.value}</dd>
    </div>
  )
}

function ReferenceImportDialog(props: {
  snapshot: BibliographySnapshot | null
  plan: BibliographyImportPlan | null
  outcomes: BibliographyImportOutcome[] | null
  selectedIds: Set<string>
  selections: Map<string, BibliographyConfirmImportSelection>
  busy: boolean
  importPdf: boolean
  onImportPdfChange(value: boolean): void
  onSelectedIdsChange(ids: Set<string>): void
  onSelectionsChange(selections: Map<string, BibliographyConfirmImportSelection>): void
  onBack(): void
  onClose(): void
  onReview(): void
  onConfirm(): void
  onReviewAgain(): void
}): React.JSX.Element {
  const available =
    props.snapshot?.candidates.filter(
      (candidate) => candidate.alreadyImportedReferenceId === null
    ) ?? []
  const toggle = (candidateId: string): void => {
    const next = new Set(props.selectedIds)
    if (next.has(candidateId)) next.delete(candidateId)
    else next.add(candidateId)
    props.onSelectedIdsChange(next)
  }
  const updateSelection = (
    candidateId: string,
    update: (selection: BibliographyConfirmImportSelection) => BibliographyConfirmImportSelection
  ): void => {
    const current = props.selections.get(candidateId)
    if (current === undefined) return
    const next = new Map(props.selections)
    next.set(candidateId, update(current))
    props.onSelectionsChange(next)
  }
  const hasRetryableOutcomes =
    props.outcomes?.some((outcome) => outcome.state === 'failed' || outcome.state === 'partial') ??
    false
  return (
    <Dialog open={props.snapshot !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className='max-h-[85dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {props.outcomes !== null
              ? hasRetryableOutcomes
                ? 'Import needs attention'
                : 'References imported'
              : props.plan !== null
                ? 'Review references and PDFs'
                : 'Import references from Zotero'}
          </DialogTitle>
          <DialogDescription>
            {props.outcomes !== null
              ? 'Each result belongs to one project Reference. PDF processing continues in Knowledge.'
              : props.plan !== null
                ? 'Confirm citation details, the primary PDF, and any supplementary files before importing.'
                : `Choose references from ${props.snapshot?.connector.sourceName ?? 'the selected Zotero export'}. PDF lookup starts only when you review this selection.`}
          </DialogDescription>
        </DialogHeader>
        <div className='min-h-0 overscroll-contain overflow-y-auto border-y py-2'>
          {props.outcomes !== null && props.plan !== null
            ? props.outcomes.map((outcome) => {
                const item = props.plan?.items.find(
                  (candidate) => candidate.candidateId === outcome.candidateId
                )
                return (
                  <div key={outcome.candidateId} className='flex items-start gap-3 px-3 py-4'>
                    {outcome.state === 'complete' || outcome.state === 'citation_only' ? (
                      <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-success' />
                    ) : (
                      <AlertCircle className='mt-0.5 size-4 shrink-0 text-destructive' />
                    )}
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className='text-sm font-medium'>{item?.title ?? 'Reference'}</p>
                        <Badge variant='outline'>{importOutcomeLabel(outcome)}</Badge>
                      </div>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {importOutcomeDescription(outcome)}
                      </p>
                    </div>
                  </div>
                )
              })
            : props.plan !== null
              ? props.plan.items.map((item) => {
                  const selection = props.selections.get(item.candidateId)
                  if (selection === undefined) return null
                  const selectedTarget = props.plan?.eligibleTargets.find(
                    (target) => target.referenceId === selection.targetReferenceId
                  )
                  return (
                    <div key={item.candidateId} className='px-3 py-4 not-last:border-b'>
                      <div className='flex flex-wrap items-start justify-between gap-2'>
                        <div className='min-w-0 flex-1'>
                          <p className='text-sm font-medium'>{item.title}</p>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            {[item.authors.join(', '), item.containerTitle, item.issuedYear]
                              .filter((value) => value !== null && value !== '')
                              .join(' · ')}
                          </p>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            @{item.proposedCitationKey}
                          </p>
                        </div>
                        <Badge variant={item.pdfStatus === 'available' ? 'secondary' : 'outline'}>
                          {item.pdfStatus === 'available'
                            ? 'PDF ready'
                            : item.pdfStatus === 'not_requested'
                              ? 'Citation only'
                              : 'PDF unavailable'}
                        </Badge>
                      </div>
                      <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                        <div className='grid gap-1.5 text-xs font-medium'>
                          <span>Reference identity</span>
                          <Select
                            value={selection.targetReferenceId ?? 'new'}
                            onValueChange={(value) => {
                              const target = props.plan?.eligibleTargets.find(
                                (candidate) => candidate.referenceId === value
                              )
                              updateSelection(item.candidateId, (current) => ({
                                ...current,
                                targetReferenceId: value === 'new' ? null : value,
                                primaryAttachmentId:
                                  target !== undefined && target.knowledgeItemIds.length > 0
                                    ? null
                                    : current.primaryAttachmentId,
                                supplementAttachmentIds:
                                  target !== undefined && target.knowledgeItemIds.length > 0
                                    ? []
                                    : current.supplementAttachmentIds
                              }))
                            }}
                          >
                            <SelectTrigger size='sm'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='new'>Create a new Reference</SelectItem>
                              {props.plan?.eligibleTargets.map((target) => (
                                <SelectItem key={target.referenceId} value={target.referenceId}>
                                  {target.kind === 'relink' ? 'Reconnect' : 'Use project PDF'}:{' '}
                                  {target.title} · @{target.citationKey}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className='grid gap-1.5 text-xs font-medium'>
                          <span>Primary PDF</span>
                          <Select
                            value={selection.primaryAttachmentId ?? 'none'}
                            onValueChange={(value) =>
                              updateSelection(item.candidateId, (current) => ({
                                ...current,
                                primaryAttachmentId: value === 'none' ? null : value,
                                supplementAttachmentIds: current.supplementAttachmentIds.filter(
                                  (attachmentId) => attachmentId !== value
                                )
                              }))
                            }
                          >
                            <SelectTrigger size='sm'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='none'>
                                {selectedTarget !== undefined &&
                                selectedTarget.knowledgeItemIds.length > 0
                                  ? 'Keep existing project PDF'
                                  : 'Citation only — no PDF'}
                              </SelectItem>
                              {item.attachments.map((attachment) => (
                                <SelectItem
                                  key={attachment.attachmentId}
                                  value={attachment.attachmentId}
                                >
                                  {attachment.fileName} · {formatBytes(attachment.byteSize)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {item.attachments.some(
                        (attachment) => attachment.attachmentId !== selection.primaryAttachmentId
                      ) ? (
                        <div className='mt-3 grid gap-2'>
                          <p className='text-xs font-medium'>Supplementary files</p>
                          {item.attachments
                            .filter(
                              (attachment) =>
                                attachment.attachmentId !== selection.primaryAttachmentId
                            )
                            .map((attachment) => (
                              <label
                                key={attachment.attachmentId}
                                htmlFor={`supplement-${attachment.attachmentId}`}
                                className='flex items-center gap-2 text-xs text-muted-foreground'
                              >
                                <Checkbox
                                  id={`supplement-${attachment.attachmentId}`}
                                  checked={selection.supplementAttachmentIds.includes(
                                    attachment.attachmentId
                                  )}
                                  disabled={selection.primaryAttachmentId === null}
                                  onCheckedChange={(checked) =>
                                    updateSelection(item.candidateId, (current) => ({
                                      ...current,
                                      supplementAttachmentIds:
                                        checked === true
                                          ? [
                                              ...current.supplementAttachmentIds,
                                              attachment.attachmentId
                                            ]
                                          : current.supplementAttachmentIds.filter(
                                              (id) => id !== attachment.attachmentId
                                            )
                                    }))
                                  }
                                />
                                <span className='min-w-0 flex-1 truncate'>
                                  {attachment.fileName}
                                </span>
                                <span className='tabular-nums'>
                                  {formatBytes(attachment.byteSize)}
                                </span>
                              </label>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              : available.map((candidate) => (
                  <label
                    key={candidate.candidateId}
                    htmlFor={`reference-candidate-${candidate.candidateId}`}
                    className='flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-muted/50'
                  >
                    <Checkbox
                      id={`reference-candidate-${candidate.candidateId}`}
                      className='mt-0.5'
                      checked={props.selectedIds.has(candidate.candidateId)}
                      onCheckedChange={() => toggle(candidate.candidateId)}
                    />
                    <span className='min-w-0 flex-1'>
                      <span className='block text-sm font-medium'>{candidate.title}</span>
                      <span className='mt-0.5 block text-xs text-muted-foreground'>
                        {[
                          candidate.authors.join(', '),
                          candidate.containerTitle,
                          candidate.issuedYear
                        ]
                          .filter((value) => value !== null && value !== '')
                          .join(' · ')}
                      </span>
                      <span className='mt-1 block text-xs text-muted-foreground'>
                        @{candidate.proposedCitationKey}
                      </span>
                    </span>
                  </label>
                ))}
          {props.plan === null && props.outcomes === null && available.length === 0 ? (
            <p className='px-3 py-8 text-center text-sm text-muted-foreground'>
              No new references are available in this export.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {props.outcomes !== null ? (
            <>
              {hasRetryableOutcomes ? (
                <Button variant='outline' disabled={props.busy} onClick={props.onReviewAgain}>
                  <RefreshCw /> Review again
                </Button>
              ) : null}
              <Button onClick={props.onClose}>Done</Button>
            </>
          ) : props.plan !== null ? (
            <>
              <Button variant='outline' disabled={props.busy} onClick={props.onBack}>
                Back
              </Button>
              <Button disabled={props.busy} onClick={props.onConfirm}>
                {props.busy ? <Spinner /> : <Upload />}
                Import {props.plan.items.length} references
              </Button>
            </>
          ) : (
            <>
              <label
                htmlFor='reference-import-pdf'
                className='mr-auto flex items-start gap-2 text-left text-xs'
              >
                <Checkbox
                  id='reference-import-pdf'
                  checked={props.importPdf}
                  onCheckedChange={(checked) => props.onImportPdfChange(checked === true)}
                />
                <span>
                  Include one primary PDF when available
                  <span className='block text-muted-foreground'>
                    Zotero is queried only after you click Review.
                  </span>
                </span>
              </label>
              <Button variant='outline' onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                disabled={props.busy || props.selectedIds.size === 0}
                onClick={props.onReview}
              >
                {props.busy ? <Spinner /> : <Upload />}
                {props.importPdf ? 'Review references and PDFs' : 'Review references'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function importOutcomeLabel(outcome: BibliographyImportOutcome): string {
  if (outcome.state === 'complete') return 'PDF processing'
  if (outcome.state === 'citation_only') return 'Citation only'
  if (outcome.state === 'partial') return 'Partially imported'
  return 'Not imported'
}

function importOutcomeDescription(outcome: BibliographyImportOutcome): string {
  if (outcome.errorCode === 'pdf_already_linked') {
    return 'The selected PDF already belongs to another Reference. Choose that project Reference explicitly or import citation details only.'
  }
  if (outcome.errorCode === 'attachment_unavailable') {
    return 'Citation details were retained, but one or more PDF files were unavailable.'
  }
  if (outcome.errorCode === 'target_unavailable') {
    return 'The selected project Reference is no longer available for completion or reconnection.'
  }
  if (outcome.errorCode === 'candidate_stale') {
    return 'The Zotero export changed. Review the current bibliography before trying again.'
  }
  if (outcome.state === 'complete') {
    return `${outcome.importedKnowledgeItemIds.length} PDF file${outcome.importedKnowledgeItemIds.length === 1 ? '' : 's'} added to Knowledge.`
  }
  if (outcome.state === 'citation_only') {
    return 'Citation details are available for writing and export; Agent evidence requires a parsed PDF.'
  }
  return 'The Reference could not be imported. Review the source and try again.'
}

function LegacyConversionDialog(props: {
  plan: LegacyCitationConversionPlan | null
  busy: boolean
  onClose(): void
  onApply(): void
}): React.JSX.Element {
  const occurrenceCount =
    props.plan?.replacements.reduce((total, item) => total + item.occurrenceCount, 0) ?? 0
  return (
    <Dialog open={props.plan !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Convert legacy citations</DialogTitle>
          <DialogDescription>
            This creates normal manuscript revisions. Only unique exact title matches are converted;
            ambiguous and unmatched citations stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 border-y py-4 text-sm'>
          <p>
            <strong>{occurrenceCount}</strong> citations can be converted to stable citekeys.
          </p>
          <p className='text-muted-foreground'>
            {props.plan?.ambiguousTitles.length ?? 0} ambiguous ·{' '}
            {props.plan?.unmatchedTitles.length ?? 0} unmatched
          </p>
          <div className='max-h-52 overflow-y-auto'>
            {props.plan?.replacements.map((entry) => (
              <div key={entry.title} className='flex gap-3 py-1.5'>
                <span className='min-w-0 flex-1 truncate'>{entry.title}</span>
                <code className='text-xs text-muted-foreground'>@{entry.citationKey}</code>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={props.busy || (props.plan?.replacements.length ?? 0) === 0}
            onClick={props.onApply}
          >
            {props.busy ? <Spinner /> : <RefreshCw />} Convert confirmed matches
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TaskRow(props: { job: JobStatus }): React.JSX.Element {
  const running = props.job.state === 'queued' || props.job.state === 'running'
  const failed = props.job.state === 'failed'
  const progress =
    props.job.progress?.completed !== undefined && props.job.progress.total !== undefined
      ? `${Math.round((props.job.progress.completed / props.job.progress.total) * 100)}%`
      : props.job.state
  return (
    <div className='grid gap-1 text-xs'>
      <div className='flex items-center gap-2'>
        {running ? (
          <Spinner className='text-primary' />
        ) : failed ? (
          <AlertCircle className='size-3 text-destructive' />
        ) : (
          <CheckCircle2 className='text-success' />
        )}
        <span className='min-w-0 flex-1 truncate'>{jobLabel(props.job.type)}</span>
        <span className='text-muted-foreground'>{progress}</span>
      </div>
      {props.job.progress?.stage ? (
        <p className='truncate pl-5 text-[10px] text-muted-foreground'>
          {props.job.progress.stage}
        </p>
      ) : null}
    </div>
  )
}

function KnowledgeHeaderStats(props: {
  stats: KnowledgeStats
  indexStatus: KnowledgeIndexStatus | undefined
  indexStatusUnavailable: boolean
}): React.JSX.Element {
  return (
    <dl
      className='hidden items-center divide-x text-xs xl:flex'
      data-testid='knowledge-header-stats'
    >
      <CompactStatus value={props.stats.total.toLocaleString()} label='Files' />
      <CompactStatus value={props.stats.parsed.toLocaleString()} label='Parsed' />
      <CompactStatus value={props.stats.blocks.toLocaleString()} label='Blocks' />
      <CompactStatus
        value={
          props.indexStatusUnavailable
            ? 'Unavailable'
            : props.indexStatus === undefined
              ? '…'
              : props.indexStatus.readiness === 'preparing'
                ? 'Preparing'
                : props.indexStatus.readiness === 'unavailable'
                  ? 'Unavailable'
                  : props.indexStatus.indexed
                    ? 'Yes'
                    : 'No'
        }
        label='Indexed'
      />
      <CompactStatus value={props.stats.queue.toLocaleString()} label='Queue' />
    </dl>
  )
}

function CompactStatus(props: { value: string; label: string }): React.JSX.Element {
  return (
    <div
      className='flex items-baseline gap-1.5 px-2.5 first:pl-0 last:pr-0'
      data-testid={`knowledge-stat-${props.label.toLowerCase()}`}
    >
      <dd className='font-semibold tabular-nums'>{props.value}</dd>
      <dt className='text-muted-foreground'>{props.label}</dt>
    </div>
  )
}

function KnowledgeDetails(props: {
  projectSessionId: string
  item: KnowledgeItem
  reference: ReferenceItem | undefined
  busy: boolean
  embeddingInProgress: boolean
  onParse(): void
  onRefreshEmbeddings(): void
  onCancelParse(): void
  onOpen(): void
  onReveal(): void
  onDelete(): void
  onInsertCitation(citationKey: string): void
  onClose(): void
  onError(message: string): void
}): React.JSX.Element {
  const parseInProgress = isParseInProgress(props.item.parseState)
  const normalizationInProgress =
    props.item.parseState === 'succeeded' && props.item.normalizationState === 'staging'
  const hasActiveRevision = props.item.activeParseRevisionId !== null
  return (
    <section className='flex h-[calc(100dvh-6.5rem)] max-h-full min-h-0 flex-col overflow-hidden'>
      <div className='grid gap-4 border-b py-5'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div className='flex min-w-0 items-start gap-3'>
            <div className='mt-0.5 rounded-lg bg-muted p-2'>
              <File className='size-5 text-muted-foreground' />
            </div>
            <div className='min-w-0'>
              <h2 className='truncate text-lg font-semibold'>
                {props.reference?.title ?? props.item.displayName}
              </h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                {props.reference === undefined ? '' : `@${props.reference.citationKey} · `}
                {props.item.extension?.toUpperCase() ?? 'FILE'} ·{' '}
                {formatBytes(props.item.byteSize ?? props.item.bytesCopied)}
                {props.item.mimeType ? ` · ${props.item.mimeType}` : ''}
              </p>
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {props.reference !== undefined ? (
              <>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    void navigator.clipboard.writeText(`[@${props.reference?.citationKey}]`)
                  }
                >
                  Copy citation
                </Button>
                <Button
                  size='sm'
                  onClick={() => props.onInsertCitation(props.reference?.citationKey ?? '')}
                >
                  Insert in editor
                </Button>
              </>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='icon-sm' aria-label='More file actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    data-testid='knowledge-reparse-file-action'
                    disabled={
                      props.busy ||
                      parseInProgress ||
                      normalizationInProgress ||
                      props.item.state !== 'stored'
                    }
                    onClick={props.onParse}
                  >
                    {parseInProgress || normalizationInProgress ? <Spinner /> : <RefreshCw />}
                    {parseInProgress || normalizationInProgress
                      ? 'Processing in progress'
                      : 'Reprocess with MinerU'}
                  </DropdownMenuItem>
                  {hasActiveRevision ? (
                    <DropdownMenuItem
                      data-testid='knowledge-reembed-file-action'
                      disabled={props.busy || props.embeddingInProgress}
                      onClick={props.onRefreshEmbeddings}
                    >
                      {props.embeddingInProgress ? <Spinner /> : <Zap />}
                      {props.embeddingInProgress
                        ? 'Embedding in progress'
                        : 'Recalculate embeddings'}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={props.item.state !== 'stored'} onClick={props.onOpen}>
                    <FolderOpen /> Open file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={props.item.state !== 'stored'}
                    onClick={props.onReveal}
                  >
                    <PanelLeft /> Show in Finder
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className='text-destructive focus:text-destructive'
                    onClick={props.onDelete}
                  >
                    <Trash2 /> Delete source
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Separator orientation='vertical' className='mx-1 data-[orientation=vertical]:h-5' />
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Close document'
              onClick={props.onClose}
            >
              <X />
            </Button>
          </div>
        </div>
        <div className='flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground'>
          <span>Added {new Date(props.item.createdAt).toLocaleString()}</span>
          {props.item.sha256 ? (
            <span className='max-w-full truncate'>SHA-256 {props.item.sha256.slice(0, 12)}…</span>
          ) : null}
          {props.item.errorCode ? (
            <span className='text-destructive'>{props.item.errorCode}</span>
          ) : null}
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {hasActiveRevision ? (
          <ParsedDocumentViewer
            inline
            projectSessionId={props.projectSessionId}
            knowledgeItemId={props.item.knowledgeItemId}
            activeRevisionId={props.item.activeParseRevisionId}
            displayName={props.item.displayName}
            extension={props.item.extension}
            onOpenChange={() => undefined}
            onError={props.onError}
          />
        ) : (
          <div className='flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center'>
            {parseInProgress || normalizationInProgress ? (
              <Spinner className='size-8 text-primary' />
            ) : props.item.parseState === 'failed' ? (
              <AlertCircle className='size-8 text-destructive' />
            ) : (
              <Circle className='size-8 text-muted-foreground' />
            )}
            <div>
              <p className='font-medium'>
                {parseInProgress
                  ? 'Parsing in progress'
                  : normalizationInProgress
                    ? 'Preparing parsed result'
                    : props.item.parseState === 'failed'
                      ? 'Parsing failed'
                      : 'Not parsed yet'}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {parseInProgress
                  ? `Current stage: ${props.item.parseState}`
                  : normalizationInProgress
                    ? 'The raw result is ready and is being normalized.'
                    : 'Run parsing to turn this source into searchable project knowledge.'}
              </p>
            </div>
            {parseInProgress ? (
              <Button variant='outline' onClick={props.onCancelParse} disabled={props.busy}>
                <X /> Stop parsing
              </Button>
            ) : normalizationInProgress ? null : (
              <Button
                onClick={props.onParse}
                disabled={props.busy || props.item.state !== 'stored'}
              >
                <Play /> {props.item.parseState === 'failed' ? 'Retry parsing' : 'Start parsing'}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

type KnowledgeStats = {
  total: number
  stored: number
  parsed: number
  blocks: number
  queue: number
}

function getStats(items: KnowledgeItem[], jobs: JobStatus[]): KnowledgeStats {
  const parsed = items.filter((item) => item.activeParseRevisionId !== null).length
  return {
    total: items.length,
    stored: items.filter((item) => item.state === 'stored').length,
    parsed,
    blocks: items.reduce((total, item) => total + item.blockCount, 0),
    queue: jobs.filter((job) => job.state === 'queued' || job.state === 'running').length
  }
}

function hasActiveKnowledgeWork(items: KnowledgeItem[]): boolean {
  return items.some(hasActiveKnowledgeWorkForItem)
}

function hasActiveKnowledgeWorkForItem(item: KnowledgeItem): boolean {
  return (
    item.state === 'importing' ||
    isParseInProgress(item.parseState) ||
    (item.parseState === 'succeeded' && item.normalizationState === 'staging')
  )
}

function isParseInProgress(state: string | null | undefined): boolean {
  return activeParseStates.has(state ?? '')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function jobLabel(type: JobStatus['type']): string {
  const labels: Partial<Record<JobStatus['type'], string>> = {
    mineru_parse: 'Parse with MinerU',
    normalize_parse_revision: 'Normalize parsed content',
    build_index_generation: 'Build search index',
    build_embedding_generation: 'Embedding generation',
    remove_index_item: 'Remove from index',
    rebuild_index: 'Rebuild search index',
    artifact_cleanup: 'Clean up artifacts'
  }
  return labels[type] ?? type
}
