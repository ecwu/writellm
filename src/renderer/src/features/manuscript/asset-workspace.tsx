import type {
  ManuscriptAssetSourceFilter,
  ManuscriptAssetUsageFilter,
  ManuscriptAssetWorkspaceItem,
  ManuscriptAssetWorkspacePage
} from '../../../../shared/contracts/manuscript-assets'
import type { ManuscriptWorkspace } from '../../../../shared/contracts/manuscript'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  FileImage,
  GitCompareArrows,
  ImageOff,
  Images,
  Link2,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import { WorkspaceRail } from '@/components/app-sidebar'
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE_SIZE = 40

export function AssetWorkspace(props: {
  projectSessionId: string
  projectName: string
  workspace: ManuscriptWorkspace | undefined
  onOpenManuscript(): void
  onOpenReferences(): void
  onOpenIssues(): void
  onOpenWritingRules(): void
  onOpenKnowledge(): void
  onOpenChecks(): void
  onOpenFind(): void
  onOpenSettings(): void
  onNavigate(sectionId: string, blockId: string): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [usage, setUsage] = useState<ManuscriptAssetUsageFilter>('all')
  const [source, setSource] = useState<ManuscriptAssetSourceFilter>('all')
  const [sectionId, setSectionId] = useState<string>('all')
  const [deleteTarget, setDeleteTarget] = useState<ManuscriptAssetWorkspaceItem | null>(null)
  const queryKey = ['manuscript-assets', props.projectSessionId, usage, source, sectionId] as const
  const assets = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      window.desktop.editor.listAssets({
        projectSessionId: props.projectSessionId,
        usage,
        source,
        ...(sectionId === 'all' ? {} : { sectionId }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
        limit: PAGE_SIZE
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  })
  const deletion = useMutation({
    mutationFn: (assetId: string) =>
      window.desktop.editor.deleteAsset({ projectSessionId: props.projectSessionId, assetId }),
    onSuccess: async (result) => {
      setDeleteTarget(null)
      if (result.outcome === 'protected') {
        props.onError('This image became protected by manuscript history or a proposal.')
      } else if (result.outcome === 'pending') {
        props.onError('Image deletion is queued for retry because the file is temporarily busy.')
      }
      await queryClient.invalidateQueries({
        queryKey: ['manuscript-assets', props.projectSessionId]
      })
    },
    onError: () => props.onError('The image could not be deleted.')
  })
  const pages = assets.data?.pages ?? []
  const items = pages.flatMap((page) => page.items)
  const firstPage: ManuscriptAssetWorkspacePage | undefined = pages[0]

  return (
    <SidebarProvider
      data-testid='asset-workspace'
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '320px' } as React.CSSProperties}
    >
      <Sidebar
        collapsible='icon'
        className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      >
        <WorkspaceRail
          activeWorkspace='assets'
          onOpenAssets={() => undefined}
          onOpenKnowledge={props.onOpenKnowledge}
          onOpenChecks={props.onOpenChecks}
          onOpenManuscript={props.onOpenManuscript}
          onOpenReferences={props.onOpenReferences}
          onOpenIssues={props.onOpenIssues}
          onOpenWritingRules={props.onOpenWritingRules}
          onOpenFind={props.onOpenFind}
          onOpenSettings={props.onOpenSettings}
        />
        <Sidebar collapsible='none' className='min-w-0 flex-1 overflow-hidden'>
          <SidebarHeader className='border-b p-4'>
            <div className='flex items-center gap-2'>
              <Images className='size-4' />
              <span className='font-medium'>Images</span>
            </div>
            <p className='text-xs text-muted-foreground'>Usage, provenance, and safe cleanup</p>
          </SidebarHeader>
          <SidebarContent>
            <FilterGroup
              label='Usage'
              value={usage}
              options={[
                ['all', 'All'],
                ['used', 'Used'],
                ['unused', 'Unused']
              ]}
              onChange={(value) => setUsage(value as ManuscriptAssetUsageFilter)}
            />
            <FilterGroup
              label='Source'
              value={source}
              options={[
                ['all', 'All'],
                ['uploaded', 'Uploaded'],
                ['generated', 'Generated']
              ]}
              onChange={(value) => setSource(value as ManuscriptAssetSourceFilter)}
            />
            <SidebarGroup>
              <SidebarGroupLabel>Current section</SidebarGroupLabel>
              <SidebarGroupContent className='px-2'>
                <Select value={sectionId} onValueChange={setSectionId}>
                  <SelectTrigger className='w-full' aria-label='Filter images by section'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>All sections</SelectItem>
                    {props.workspace?.sections.map(({ section }) => (
                      <SelectItem key={section.sectionId} value={section.sectionId}>
                        {section.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className='border-t p-4 text-xs text-muted-foreground'>
            {firstPage === undefined ? (
              <span>Loading library…</span>
            ) : (
              <span>
                {firstPage.summary.total} images · {firstPage.summary.used} used ·{' '}
                {firstPage.summary.unused} unused
              </span>
            )}
          </SidebarFooter>
        </Sidebar>
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
                <BreadcrumbPage>Images</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {firstPage !== undefined ? (
            <Badge variant='secondary' className='ml-auto'>
              {firstPage.filteredTotal} shown
            </Badge>
          ) : null}
        </header>
        <main className='mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 md:p-6'>
          <div>
            <h1 className='text-xl font-semibold'>Manuscript images</h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              Verified project images and every place the current manuscript uses them.
            </p>
          </div>
          {assets.isPending ? <AssetGridSkeleton /> : null}
          {assets.isError ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <AlertTriangle />
                </EmptyMedia>
                <EmptyTitle>Image library unavailable</EmptyTitle>
                <EmptyDescription>Retry after the active project is ready.</EmptyDescription>
              </EmptyHeader>
              <Button variant='outline' onClick={() => void assets.refetch()}>
                Retry
              </Button>
            </Empty>
          ) : null}
          {!assets.isPending && !assets.isError && items.length === 0 ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <FileImage />
                </EmptyMedia>
                <EmptyTitle>No matching images</EmptyTitle>
                <EmptyDescription>
                  Uploaded and Agent-generated manuscript images will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {items.length > 0 ? (
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3'>
              {items.map((item) => (
                <AssetItem
                  key={item.assetId}
                  projectSessionId={props.projectSessionId}
                  item={item}
                  onDelete={() => setDeleteTarget(item)}
                  onNavigate={props.onNavigate}
                />
              ))}
            </div>
          ) : null}
          {assets.hasNextPage ? (
            <Button
              variant='outline'
              className='self-center'
              disabled={assets.isFetchingNextPage}
              onClick={() => void assets.fetchNextPage()}
            >
              {assets.isFetchingNextPage ? 'Loading…' : 'Load more images'}
            </Button>
          ) : null}
        </main>
      </SidebarInset>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete unused image?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the immutable project copy. Images retained by manuscript
              history or proposals cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletion.isPending || deleteTarget === null}
              onClick={() => deleteTarget && deletion.mutate(deleteTarget.assetId)}
            >
              Delete image
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}

function FilterGroup<T extends string>(props: {
  label: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange(value: T): void
}): React.JSX.Element {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{props.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {props.options.map(([value, label]) => (
            <SidebarMenuItem key={value}>
              <SidebarMenuButton
                isActive={props.value === value}
                onClick={() => props.onChange(value)}
              >
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function AssetItem(props: {
  projectSessionId: string
  item: ManuscriptAssetWorkspaceItem
  onDelete(): void
  onNavigate(sectionId: string, blockId: string): void
}): React.JSX.Element {
  const label = props.item.originalName ?? `${props.item.sourceType} image`
  const related = [
    ...props.item.parents.map((relation) => ({ ...relation, label: 'Parent' })),
    ...props.item.candidates.map((relation) => ({ ...relation, label: 'Candidate' }))
  ]
  return (
    <article className='flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background'>
      <div className='flex aspect-video items-center justify-center overflow-hidden bg-muted'>
        <AssetThumbnail projectSessionId={props.projectSessionId} item={props.item} label={label} />
      </div>
      <div className='grid gap-3 p-4'>
        <div className='flex min-w-0 items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <h2 className='truncate font-medium'>{label}</h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              {props.item.mimeType.replace('image/', '').toUpperCase()} ·{' '}
              {props.item.width === null
                ? 'Unknown size'
                : `${props.item.width} × ${props.item.height}`}{' '}
              · {formatBytes(props.item.byteSize)}
            </p>
          </div>
          <Badge variant={props.item.sourceType === 'generated' ? 'secondary' : 'outline'}>
            {props.item.sourceType === 'generated' ? 'Generated' : 'Uploaded'}
          </Badge>
        </div>
        {props.item.availability !== 'available' ? (
          <p className='flex items-center gap-2 text-xs text-destructive' role='status'>
            <ImageOff className='size-3.5' />
            {props.item.availability === 'missing' ? 'File is missing' : 'File integrity changed'}
          </p>
        ) : null}
        {props.item.generation !== null ? (
          <p className='text-xs text-muted-foreground'>
            {props.item.generation.aspectRatio ?? 'Auto ratio'} ·{' '}
            {props.item.generation.effectiveImageSize ?? 'Default size'} · Agent lineage recorded
          </p>
        ) : null}
        {related.length > 0 ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant='outline' size='sm' className='w-full justify-start'>
                <GitCompareArrows data-icon='inline-start' /> Compare {related.length}{' '}
                {related.length === 1 ? 'related candidate' : 'related candidates'}
              </Button>
            </DialogTrigger>
            <DialogContent className='max-h-[85vh] overflow-auto sm:max-w-4xl'>
              <DialogHeader>
                <DialogTitle>Image candidates</DialogTitle>
                <DialogDescription>
                  Compare immutable outputs from the same Agent-guided image lineage.
                </DialogDescription>
              </DialogHeader>
              <div className='grid gap-4 md:grid-cols-2'>
                <CandidatePreview
                  projectSessionId={props.projectSessionId}
                  assetId={props.item.assetId}
                  label='Selected image'
                  detail='Current workspace selection'
                />
                {related.map((relation) => (
                  <CandidatePreview
                    key={relation.variantId}
                    projectSessionId={props.projectSessionId}
                    assetId={relation.assetId}
                    label={relation.label}
                    detail={`${relation.disposition === 'replace' ? 'Replace in place' : 'Insert as another figure'} · model request ${relation.modelRequestId.slice(0, 8)}`}
                  />
                ))}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
        <div className='grid gap-1.5'>
          <div className='flex items-center gap-2 text-xs font-medium'>
            <Link2 className='size-3.5' /> {props.item.currentReferenceCount} current{' '}
            {props.item.currentReferenceCount === 1 ? 'reference' : 'references'}
          </div>
          {props.item.currentReferences.slice(0, 3).map((reference) => (
            <Button
              key={`${reference.sectionId}:${reference.blockId}`}
              variant='ghost'
              size='sm'
              className='h-auto min-w-0 justify-start px-2 py-1.5'
              onClick={() => props.onNavigate(reference.sectionId, reference.blockId)}
            >
              <span className='truncate'>Open {reference.sectionTitle}</span>
            </Button>
          ))}
          {props.item.currentReferenceCount === 0 ? (
            <p className='text-xs text-muted-foreground'>Not used by the current manuscript.</p>
          ) : null}
        </div>
        <div className='flex items-center gap-2 border-t pt-3'>
          <p className='min-w-0 flex-1 text-xs text-muted-foreground'>
            {protectionLabel(props.item)}
          </p>
          <Button
            variant='outline'
            size='icon-sm'
            aria-label={`Delete ${label}`}
            disabled={!props.item.canDelete}
            onClick={props.onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </article>
  )
}

function CandidatePreview(props: {
  projectSessionId: string
  assetId: string
  label: string
  detail: string
}): React.JSX.Element {
  const preview = useQuery({
    queryKey: ['manuscript-asset-preview', props.projectSessionId, props.assetId],
    queryFn: () =>
      window.desktop.editor.resolveAsset({
        projectSessionId: props.projectSessionId,
        assetId: props.assetId
      }),
    retry: false
  })
  return (
    <figure className='overflow-hidden rounded-lg border'>
      <div className='flex aspect-video items-center justify-center bg-muted'>
        {preview.data?.status === 'resolved' ? (
          <img className='size-full object-contain' src={preview.data.url} alt={props.label} />
        ) : preview.isPending ? (
          <Skeleton className='size-full rounded-none' />
        ) : (
          <ImageOff className='size-8 text-muted-foreground' aria-label='Preview unavailable' />
        )}
      </div>
      <figcaption className='grid gap-1 p-3'>
        <span className='text-sm font-medium'>{props.label}</span>
        <span className='text-xs text-muted-foreground'>{props.detail}</span>
      </figcaption>
    </figure>
  )
}

function AssetThumbnail(props: {
  projectSessionId: string
  item: ManuscriptAssetWorkspaceItem
  label: string
}): React.JSX.Element {
  const preview = useQuery({
    queryKey: ['manuscript-asset-preview', props.projectSessionId, props.item.assetId],
    queryFn: () =>
      window.desktop.editor.resolveAsset({
        projectSessionId: props.projectSessionId,
        assetId: props.item.assetId
      }),
    enabled: props.item.availability === 'available',
    retry: false
  })
  if (props.item.availability !== 'available' || preview.data?.status === 'session-revoked') {
    return (
      <ImageOff
        className='size-8 text-muted-foreground'
        aria-label={`${props.label} unavailable`}
      />
    )
  }
  if (preview.data?.status !== 'resolved') return <Skeleton className='size-full rounded-none' />
  return (
    <img
      className='size-full object-contain'
      src={preview.data.url}
      alt={`Preview of ${props.label}`}
    />
  )
}

function AssetGridSkeleton(): React.JSX.Element {
  return (
    <div
      className='grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3'
      role='status'
      aria-label='Loading images'
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className='overflow-hidden rounded-lg border'>
          <Skeleton className='aspect-video rounded-none' />
          <div className='grid gap-3 p-4'>
            <Skeleton className='h-4 w-2/3' />
            <Skeleton className='h-3 w-1/2' />
          </div>
        </div>
      ))}
    </div>
  )
}

function protectionLabel(item: ManuscriptAssetWorkspaceItem): string {
  if (item.canDelete) return 'Safe to delete'
  const labels = item.protectionReasons.map((reason) => {
    if (reason === 'current_revision') return 'current manuscript'
    if (reason === 'retained_history') return `${item.historicalReferenceCount} history references`
    if (reason === 'retained_proposal') return `${item.proposalReferenceCount} proposal references`
    return 'candidate lineage'
  })
  return `Protected by ${labels.join(', ')}`
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}
