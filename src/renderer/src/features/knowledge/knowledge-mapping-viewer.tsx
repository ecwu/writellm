import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Minus, PanelRight, Plus, Search, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KnowledgeMappingPage } from '../../../../shared/contracts/knowledge-mapping'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export function KnowledgeMappingViewer(props: {
  projectSessionId: string
  knowledgeItemId: string
  displayName: string
  initialPageIndex?: number
  initialBlockId?: string | null
  onError(message: string): void
}): React.JSX.Element {
  const [preview, setPreview] = useState<{ previewId: string; url: string } | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState((props.initialPageIndex ?? 0) + 1)
  const [zoom, setZoom] = useState(1)
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 })
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 })
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.desktop.knowledge
      .createPdfPreview({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId
      })
      .then((result) => {
        if (cancelled) {
          void window.desktop.knowledge
            .releasePdfPreview({
              projectSessionId: props.projectSessionId,
              previewId: result.previewId
            })
            .catch(() => undefined)
          return
        }
        setPreview({ previewId: result.previewId, url: result.url })
      })
      .catch(() => props.onError('The original PDF could not be loaded.'))
    return () => {
      cancelled = true
    }
  }, [props.knowledgeItemId, props.onError, props.projectSessionId])

  useEffect(() => {
    if (preview === null) return
    let cancelled = false
    const loadingTask = getDocument({ url: preview.url, rangeChunkSize: 64 * 1024 })
    void loadingTask.promise
      .then((document) => {
        if (cancelled) {
          void document.cleanup()
          return
        }
        setPdf(document)
        setPageNumber((props.initialPageIndex ?? 0) + 1)
      })
      .catch(() => props.onError('The PDF could not be rendered.'))
    return () => {
      cancelled = true
      void loadingTask.destroy()
      setPdf(null)
    }
  }, [preview, props.initialPageIndex, props.onError])

  useEffect(() => {
    return () => {
      if (preview === null) return
      void window.desktop.knowledge
        .releasePdfPreview({
          projectSessionId: props.projectSessionId,
          previewId: preview.previewId
        })
        .catch(() => undefined)
    }
  }, [preview, props.projectSessionId])

  const pageQuery = useQuery({
    queryKey: ['knowledge-mapping', props.projectSessionId, props.knowledgeItemId, pageNumber - 1],
    queryFn: () =>
      window.desktop.knowledge.mappingPage({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId,
        pageIndex: pageNumber - 1
      }),
    enabled: pdf !== null,
    retry: false
  })

  useEffect(() => {
    if (pdf === null || canvasRef.current === null) return
    let cancelled = false
    let renderTask: RenderTask | undefined
    void pdf
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || canvasRef.current === null) return
        const viewport = page.getViewport({ scale: zoom })
        const deviceScale = window.devicePixelRatio || 1
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (context === null) return
        setBaseSize(page.getViewport({ scale: 1 }))
        setViewSize({ width: viewport.width, height: viewport.height })
        canvas.width = Math.floor(viewport.width * deviceScale)
        canvas.height = Math.floor(viewport.height * deviceScale)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        renderTask = page.render({
          canvas: null,
          canvasContext: context,
          viewport,
          transform: deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0]
        })
        return renderTask.promise
      })
      .catch(() => {
        if (!cancelled) props.onError('The PDF page could not be rendered.')
      })
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pageNumber, pdf, props.onError, zoom])

  const mapping = pageQuery.data
  useEffect(() => {
    if (
      mapping === undefined ||
      props.initialBlockId === null ||
      props.initialBlockId === undefined
    )
      return
    const region = mapping.regions.find((candidate) =>
      candidate.normalizedBlockIds.includes(props.initialBlockId as string)
    )
    if (region !== undefined) setSelectedRegionId(region.regionId)
  }, [mapping, props.initialBlockId])
  const selectedChunk = mapping?.chunks.find((chunk) => chunk.chunkId === selectedChunkId)
  const selectedRegion = mapping?.regions.find((region) => region.regionId === selectedRegionId)
  const regionChunks = useMemo(
    () =>
      selectedRegion === undefined
        ? []
        : (mapping?.chunks.filter((chunk) =>
            chunk.coverages.some((coverage) => coverage.regionId === selectedRegion.regionId)
          ) ?? []),
    [mapping?.chunks, selectedRegion]
  )

  const fitWidth = (): void => {
    const available = canvasContainerRef.current?.clientWidth ?? 0
    if (available > 0 && baseSize.width > 0)
      setZoom(Math.max(0.5, Math.min(2.5, (available - 32) / baseSize.width)))
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden border-t'>
      <div className='flex flex-wrap items-center gap-2 border-b px-2 py-2'>
        <Button
          size='icon-sm'
          variant='outline'
          aria-label='Previous PDF page'
          disabled={pageNumber <= 1}
          onClick={() => {
            setSelectedChunkId(null)
            setSelectedRegionId(null)
            setPageNumber((value) => Math.max(1, value - 1))
          }}
        >
          <ChevronLeft />
        </Button>
        <span className='text-xs tabular-nums'>
          Page {pageNumber} / {pdf?.numPages ?? '—'}
        </span>
        <Button
          size='icon-sm'
          variant='outline'
          aria-label='Next PDF page'
          disabled={pdf === null || pageNumber >= pdf.numPages}
          onClick={() => {
            setSelectedChunkId(null)
            setSelectedRegionId(null)
            setPageNumber((value) => Math.min(pdf?.numPages ?? value, value + 1))
          }}
        >
          <ChevronRight />
        </Button>
        <span className='mx-1 h-5 border-l' />
        <Button
          size='icon-sm'
          variant='outline'
          aria-label='Zoom out'
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
        >
          <Minus />
        </Button>
        <span className='min-w-12 text-center text-xs tabular-nums'>{Math.round(zoom * 100)}%</span>
        <Button
          size='icon-sm'
          variant='outline'
          aria-label='Zoom in'
          onClick={() => setZoom((value) => Math.min(2.5, value + 0.1))}
        >
          <Plus />
        </Button>
        <Button size='sm' variant='outline' onClick={fitWidth}>
          Fit width
        </Button>
        <Button size='sm' variant='ghost' onClick={() => setZoom(1)}>
          Actual size
        </Button>
        <Badge variant='outline' className='ml-auto'>
          Character coverage approximation
        </Badge>
        <Button
          size='sm'
          variant='outline'
          className='lg:hidden'
          onClick={() => setInspectorOpen(true)}
        >
          <PanelRight /> Inspector
        </Button>
      </div>
      <div className='grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]'>
        <ScrollArea className='min-h-0 bg-muted/20'>
          <div ref={canvasContainerRef} className='flex min-h-full min-w-full justify-center p-4'>
            {preview === null || pdf === null ? (
              <div className='flex min-h-64 items-center gap-2 text-sm text-muted-foreground'>
                <Spinner /> Loading original PDF…
              </div>
            ) : (
              <div className='relative h-fit w-fit border bg-background shadow-sm'>
                <canvas ref={canvasRef} aria-label={`${props.displayName}, page ${pageNumber}`} />
                {mapping?.geometry !== null &&
                mapping?.geometry !== undefined &&
                viewSize.width > 0 ? (
                  <MappingOverlay
                    mapping={mapping}
                    width={viewSize.width}
                    height={viewSize.height}
                    selectedChunkId={selectedChunkId}
                    selectedRegionId={selectedRegionId}
                    onChunkSelect={setSelectedChunkId}
                    onRegionSelect={setSelectedRegionId}
                  />
                ) : null}
              </div>
            )}
          </div>
        </ScrollArea>
        <aside className='hidden min-h-0 border-l bg-background lg:block'>
          <MappingInspector
            isLoading={pageQuery.isLoading}
            mapping={mapping}
            selectedChunkId={selectedChunkId}
            selectedRegionId={selectedRegionId}
            selectedChunk={selectedChunk}
            selectedRegion={selectedRegion}
            regionChunks={regionChunks}
            onChunkSelect={setSelectedChunkId}
            onRegionSelect={setSelectedRegionId}
          />
        </aside>
        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent side='right' className='w-[min(92vw,360px)] p-0 sm:max-w-md'>
            <SheetHeader className='border-b pr-12'>
              <SheetTitle>Mapping inspector</SheetTitle>
              <SheetDescription>
                Source blocks, chunk coverage, and embedding preview.
              </SheetDescription>
            </SheetHeader>
            <MappingInspector
              isLoading={pageQuery.isLoading}
              mapping={mapping}
              selectedChunkId={selectedChunkId}
              selectedRegionId={selectedRegionId}
              selectedChunk={selectedChunk}
              selectedRegion={selectedRegion}
              regionChunks={regionChunks}
              onChunkSelect={setSelectedChunkId}
              onRegionSelect={setSelectedRegionId}
            />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}

function MappingInspector(props: {
  isLoading: boolean
  mapping: KnowledgeMappingPage | undefined
  selectedChunkId: string | null
  selectedRegionId: string | null
  selectedChunk: KnowledgeMappingPage['chunks'][number] | undefined
  selectedRegion: KnowledgeMappingPage['regions'][number] | undefined
  regionChunks: KnowledgeMappingPage['chunks']
  onChunkSelect(chunkId: string): void
  onRegionSelect(regionId: string): void
}): React.JSX.Element {
  return (
    <ScrollArea className='h-full'>
      <div className='grid gap-4 p-4'>
        {props.isLoading ? <p className='text-xs text-muted-foreground'>Loading mapping…</p> : null}
        {props.mapping?.message ? (
          <p className='text-xs text-muted-foreground'>{props.mapping.message}</p>
        ) : null}
        {props.mapping?.state === 'indexing' ? (
          <p className='text-sm text-muted-foreground'>Indexing this source…</p>
        ) : null}
        {props.mapping?.state === 'too_complex' ? (
          <p className='text-sm text-destructive'>This page is too complex to map safely.</p>
        ) : null}
        {props.mapping?.state === 'ready' && props.mapping.chunks.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No indexed chunks on this page.</p>
        ) : null}
        {props.selectedRegion !== undefined ? (
          <section className='grid gap-2 border-b pb-4'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              <Search className='size-4' /> Source region
            </div>
            <p className='text-xs text-muted-foreground'>
              Provider block {props.selectedRegion.providerBlockId ?? 'unidentified'}
            </p>
            <p className='break-all font-mono text-[11px] text-muted-foreground'>
              Normalized: {props.selectedRegion.normalizedBlockIds.join(', ')}
            </p>
            {props.selectedRegion.bbox === null ? (
              <p className='text-xs text-muted-foreground'>
                Extracted, but no verified PDF location is available for this block.
              </p>
            ) : null}
            {props.regionChunks.map((chunk) => (
              <Button
                key={chunk.chunkId}
                size='sm'
                variant='outline'
                className='justify-start'
                onClick={() => props.onChunkSelect(chunk.chunkId)}
              >
                Chunk {chunk.ordinal + 1}
              </Button>
            ))}
          </section>
        ) : null}
        {props.selectedChunk !== undefined ? <ChunkInspector chunk={props.selectedChunk} /> : null}
        <section className='grid gap-2'>
          <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Source blocks on page
          </p>
          {props.mapping?.regions.map((region) => (
            <Button
              key={region.regionId}
              size='sm'
              variant={props.selectedRegionId === region.regionId ? 'secondary' : 'ghost'}
              className='justify-start text-left'
              onClick={() => props.onRegionSelect(region.regionId)}
            >
              <Search />
              <span className='min-w-0 truncate'>
                {region.blockTypes.includes('caption')
                  ? 'Caption'
                  : (region.providerBlockId ?? 'Unidentified block')}{' '}
                · {region.normalizedBlockIds.length} normalized
                {region.bbox === null ? ' · extracted, location unavailable' : ''}
              </span>
            </Button>
          ))}
        </section>
        <section className='grid gap-2'>
          <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Chunks on page
          </p>
          {props.mapping?.chunks.map((chunk) => (
            <Button
              key={chunk.chunkId}
              size='sm'
              variant={props.selectedChunkId === chunk.chunkId ? 'secondary' : 'ghost'}
              className='justify-start'
              onClick={() => props.onChunkSelect(chunk.chunkId)}
            >
              <Zap /> Chunk {chunk.ordinal + 1}
              {chunk.embedding !== null ? (
                <Badge variant='outline' className='ml-auto'>
                  Embedded
                </Badge>
              ) : null}
            </Button>
          ))}
        </section>
      </div>
    </ScrollArea>
  )
}

function ChunkInspector(props: {
  chunk: NonNullable<KnowledgeMappingPage['chunks']>[number]
}): React.JSX.Element {
  return (
    <section className='grid gap-2 border-b pb-4'>
      <p className='text-sm font-medium'>Chunk {props.chunk.ordinal + 1}</p>
      <p className='max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5'>
        {props.chunk.text}
      </p>
      {props.chunk.coverages.map((coverage) => (
        <div
          key={coverage.regionId}
          className='flex items-center justify-between text-xs text-muted-foreground'
        >
          <span>{coverage.regionId}</span>
          <span>{Math.round(coverage.coverageRatio * 100)}%</span>
        </div>
      ))}
      {props.chunk.embedding === null ? (
        <p className='text-xs text-muted-foreground'>No active embedding for this chunk.</p>
      ) : (
        <div className='grid gap-1 border-t pt-2 text-xs'>
          <p className='font-medium'>Embedding</p>
          <p className='text-muted-foreground'>
            {props.chunk.embedding.modelId} · {props.chunk.embedding.dimension}d · norm{' '}
            {props.chunk.embedding.norm.toFixed(4)}
          </p>
          <code className='break-all rounded bg-muted p-2 text-[10px] leading-4'>
            [{props.chunk.embedding.preview.map((value) => value.toFixed(6)).join(', ')}
            {props.chunk.embedding.dimension > 16 ? ', …' : ''}]
          </code>
        </div>
      )}
    </section>
  )
}

function MappingOverlay(props: {
  mapping: KnowledgeMappingPage
  width: number
  height: number
  selectedChunkId: string | null
  selectedRegionId: string | null
  onChunkSelect(chunkId: string): void
  onRegionSelect(regionId: string): void
}): React.JSX.Element | null {
  const geometry = props.mapping.geometry
  if (geometry === null) return null
  const chunksByRegion = new Map<
    string,
    Array<{ chunkId: string; startRatio: number; endRatio: number }>
  >()
  for (const chunk of props.mapping.chunks) {
    for (const coverage of chunk.coverages) {
      const values = chunksByRegion.get(coverage.regionId) ?? []
      for (const segment of coverage.segments) values.push({ chunkId: chunk.chunkId, ...segment })
      chunksByRegion.set(coverage.regionId, values)
    }
  }
  return (
    <svg
      className='pointer-events-none absolute inset-0'
      width={props.width}
      height={props.height}
      viewBox={`0 0 ${props.width} ${props.height}`}
      aria-label='MinerU block and embedding chunk overlay'
    >
      <defs>
        <pattern
          id='mapping-overlap-hatch'
          width='8'
          height='8'
          patternUnits='userSpaceOnUse'
          patternTransform='rotate(45)'
        >
          <line x1='0' y1='0' x2='0' y2='8' stroke='currentColor' strokeWidth='3' opacity='0.35' />
        </pattern>
      </defs>
      {props.mapping.regions.map((region) => {
        if (region.bbox === null) return null
        const bounds = toViewportBounds(region.bbox, geometry, props.width, props.height)
        if (bounds === null) return null
        const active = props.selectedRegionId === region.regionId
        const segments = chunksByRegion.get(region.regionId) ?? []
        const overlapSegments = segments.flatMap((segment, index) =>
          segments
            .slice(index + 1)
            .filter((other) => other.chunkId !== segment.chunkId)
            .flatMap((other) => {
              const startRatio = Math.max(segment.startRatio, other.startRatio)
              const endRatio = Math.min(segment.endRatio, other.endRatio)
              return endRatio > startRatio
                ? [{ startRatio, endRatio, chunkId: segment.chunkId }]
                : []
            })
        )
        return (
          <g key={region.regionId} className='pointer-events-auto'>
            {segments.map((segment) => (
              <a
                key={`${region.regionId}:${segment.chunkId}:${segment.startRatio}:${segment.endRatio}`}
                href={`#mapping-chunk-${segment.chunkId}`}
                aria-label={`Chunk ${segment.chunkId} coverage`}
                onClick={(event) => {
                  event.preventDefault()
                  props.onChunkSelect(segment.chunkId)
                }}
              >
                <rect
                  x={bounds.x}
                  y={bounds.y + bounds.height * segment.startRatio}
                  width={bounds.width}
                  height={Math.max(1, bounds.height * (segment.endRatio - segment.startRatio))}
                  fill={colorFor(segment.chunkId)}
                  fillOpacity={
                    props.selectedChunkId === null || props.selectedChunkId === segment.chunkId
                      ? active
                        ? 0.4
                        : 0.25
                      : 0.08
                  }
                />
              </a>
            ))}
            {overlapSegments.map((segment) => (
              <rect
                key={`${region.regionId}:overlap:${segment.chunkId}:${segment.startRatio}:${segment.endRatio}`}
                x={bounds.x}
                y={bounds.y + bounds.height * segment.startRatio}
                width={bounds.width}
                height={Math.max(1, bounds.height * (segment.endRatio - segment.startRatio))}
                fill='url(#mapping-overlap-hatch)'
                color={colorFor(segment.chunkId)}
                pointerEvents='none'
                aria-label='Chunk overlap'
              />
            ))}
            <a
              href={`#mapping-region-${region.regionId}`}
              aria-label={`Source block ${region.providerBlockId ?? region.regionId}`}
              onClick={(event) => {
                event.preventDefault()
                props.onRegionSelect(region.regionId)
              }}
            >
              <rect
                x={bounds.x}
                y={bounds.y}
                width={bounds.width}
                height={bounds.height}
                fill='none'
                stroke={active ? 'hsl(var(--foreground))' : 'hsl(var(--primary))'}
                strokeWidth={active ? 2.5 : 1.5}
                strokeDasharray={active ? undefined : '5 3'}
              />
            </a>
          </g>
        )
      })}
    </svg>
  )
}

function toViewportBounds(
  bbox: [number, number, number, number],
  geometry: { width: number; height: number },
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | null {
  const [x0, y0, x1, y1] = bbox
  const left = Math.max(0, Math.min(x0, x1))
  const top = Math.max(0, Math.min(y0, y1))
  const right = Math.min(geometry.width, Math.max(x0, x1))
  const bottom = Math.min(geometry.height, Math.max(y0, y1))
  if (right <= left || bottom <= top) return null
  return {
    x: (left / geometry.width) * width,
    y: (top / geometry.height) * height,
    width: ((right - left) / geometry.width) * width,
    height: ((bottom - top) / geometry.height) * height
  }
}

function colorFor(value: string): string {
  let hash = 0
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 75% 45%)`
}
