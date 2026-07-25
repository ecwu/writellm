import type { NormalizedKnowledgeBlock } from '../../../../shared/contracts/knowledge'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, ImageIcon, Map as MapIcon, Play, Rows3, Square } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { markdownSanitizeSchema, rehypeRenderHtmlMath } from './markdown-math'
import { KnowledgeMappingViewer } from './knowledge-mapping-viewer'

export function ParsedDocumentViewer(props: {
  projectSessionId: string
  knowledgeItemId: string | null
  displayName: string
  extension?: string | null
  inline?: boolean
  onOpenChange(open: boolean): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [view, setView] = useState<'content' | 'markdown' | 'mapping'>('content')
  const [mappingTarget, setMappingTarget] = useState<{
    pageIndex: number
    blockId: string
  } | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const query = useQuery({
    queryKey: ['parsed-knowledge', props.projectSessionId, props.knowledgeItemId],
    queryFn: () =>
      window.desktop.knowledge.parsedDocument({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId as string
      }),
    enabled: props.knowledgeItemId !== null,
    refetchInterval: ({ state }) =>
      state.data?.active === null &&
      (isParseInProgress(state.data?.parseState) || state.data?.normalizationState === 'staging')
        ? 500
        : false
  })

  const startParse = async (): Promise<void> => {
    if (props.knowledgeItemId === null) return
    setActionPending(true)
    try {
      await window.desktop.knowledge.startParse({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId
      })
      await queryClient.invalidateQueries({
        queryKey: ['parsed-knowledge', props.projectSessionId, props.knowledgeItemId]
      })
    } catch {
      props.onError('MinerU parsing could not be started. Check the MinerU provider settings.')
    } finally {
      setActionPending(false)
    }
  }

  const cancelParse = async (): Promise<void> => {
    if (props.knowledgeItemId === null) return
    setActionPending(true)
    try {
      await window.desktop.knowledge.cancelParse({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId
      })
      await queryClient.invalidateQueries({
        queryKey: ['parsed-knowledge', props.projectSessionId, props.knowledgeItemId]
      })
    } catch {
      props.onError('MinerU parsing could not be stopped. Please try again.')
    } finally {
      setActionPending(false)
    }
  }

  const active = query.data?.active
  const parseInProgress = isParseInProgress(query.data?.parseState)
  const normalizationInProgress =
    query.data?.parseState === 'succeeded' && query.data.normalizationState === 'staging'
  const content = query.isLoading ? (
    <div
      className='flex min-h-64 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground'
      role='status'
    >
      <Spinner /> Loading parsed result…
    </div>
  ) : active === null || active === undefined ? (
    <Empty className='min-h-64 border-0'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <FileText />
        </EmptyMedia>
        <EmptyTitle>
          {parseInProgress
            ? 'Parsing in progress'
            : normalizationInProgress
              ? 'Preparing parsed result'
              : 'No active parsed revision'}
        </EmptyTitle>
        <EmptyDescription>
          {normalizationInProgress
            ? 'The raw result is ready and is being normalized.'
            : `Parse status: ${query.data?.parseState ?? 'not started'}`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {parseInProgress ? (
          <Button disabled={actionPending} variant='outline' onClick={() => void cancelParse()}>
            {actionPending ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <Square data-icon='inline-start' />
            )}
            {actionPending ? 'Stopping…' : 'Stop parsing'}
          </Button>
        ) : normalizationInProgress ? null : (
          <Button disabled={actionPending} onClick={() => void startParse()}>
            {actionPending ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <Play data-icon='inline-start' />
            )}
            {query.data?.parseState === 'failed' ? 'Retry parsing' : 'Start parsing'}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  ) : (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as typeof view)}
      className='min-h-0 flex-1 gap-0'
    >
      <div className='flex min-w-0 flex-wrap items-center gap-2 border-b'>
        <TabsList variant='line'>
          <TabsTrigger value='content'>
            <Rows3 /> Content
          </TabsTrigger>
          <TabsTrigger value='markdown'>
            <FileText /> Markdown
          </TabsTrigger>
          {props.extension === 'pdf' ? (
            <TabsTrigger value='mapping'>
              <MapIcon /> Mapping
            </TabsTrigger>
          ) : null}
        </TabsList>
        <div className='flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1'>
          <Badge variant='outline'>{active.modelVersion}</Badge>
          <Badge variant='outline'>Normalizer v{active.normalizerVersion}</Badge>
          <span className='text-xs text-muted-foreground'>{active.blocks.length} blocks</span>
        </div>
      </div>
      <TabsContent value='mapping' className='min-h-0'>
        {props.extension === 'pdf' ? (
          <KnowledgeMappingViewer
            projectSessionId={props.projectSessionId}
            knowledgeItemId={props.knowledgeItemId as string}
            displayName={props.displayName}
            initialPageIndex={mappingTarget?.pageIndex ?? 0}
            initialBlockId={mappingTarget?.blockId ?? null}
            onError={props.onError}
          />
        ) : null}
      </TabsContent>
      <TabsContent value='content' className='min-h-0'>
        <ScrollArea className='h-full min-h-0 overflow-hidden pr-4'>
          <div className='divide-y'>
            {active.blocks.map((block) => (
              <ParsedBlock
                key={block.id}
                block={block}
                isPdf={props.extension === 'pdf'}
                projectSessionId={props.projectSessionId}
                knowledgeItemId={props.knowledgeItemId as string}
                parseRevisionId={active.parseRevisionId}
                onOpenMapping={() => {
                  setMappingTarget({ pageIndex: block.page ?? 0, blockId: block.id })
                  setView('mapping')
                }}
              />
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value='markdown' className='min-h-0'>
        <ScrollArea className='h-full min-h-0 overflow-hidden pr-4'>
          <ParsedMarkdown
            markdown={active.documentMarkdown}
            projectSessionId={props.projectSessionId}
            knowledgeItemId={props.knowledgeItemId as string}
            parseRevisionId={active.parseRevisionId}
          />
        </ScrollArea>
      </TabsContent>
      {view === 'mapping' ? null : (
        <div className='grid gap-1 border-t py-3 text-xs text-muted-foreground sm:grid-cols-2'>
          <span>Source SHA-256: {active.sourceSha256}</span>
          <span>Remote task: {active.remoteTaskId}</span>
          <span>Parse revision: {active.parseRevisionId}</span>
          <span>Activated: {new Date(active.activatedAt).toLocaleString()}</span>
        </div>
      )}
    </Tabs>
  )

  if (props.inline) {
    return <div className='flex h-full min-h-0 flex-col pt-4'>{content}</div>
  }
  return (
    <Dialog open={props.knowledgeItemId !== null} onOpenChange={props.onOpenChange}>
      <DialogContent className='flex h-[85vh] max-w-5xl! flex-col overflow-hidden'>
        <DialogHeader>
          <DialogTitle>{props.displayName || 'Parsed document'}</DialogTitle>
          <DialogDescription>
            Normalized MinerU content with source-page and raw-result provenance.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

function isParseInProgress(state: string | null | undefined): boolean {
  return [
    'queued',
    'allocating',
    'awaiting_upload',
    'polling',
    'downloading',
    'extracting',
    'publishing'
  ].includes(state ?? '')
}

function ParsedMarkdown(props: {
  markdown: string
  projectSessionId: string
  knowledgeItemId: string
  parseRevisionId: string
}): React.JSX.Element {
  return (
    <article
      className={
        'flex max-w-none flex-col gap-4 py-4 text-sm leading-7 ' +
        '[&_h1]:scroll-m-20 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight ' +
        '[&_h2]:mt-8 [&_h2]:scroll-m-20 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight ' +
        '[&_h3]:mt-6 [&_h3]:scroll-m-20 [&_h3]:text-xl [&_h3]:font-semibold ' +
        '[&_p]:leading-7 [&_ul]:my-4 [&_ul]:ml-6 [&_ul]:list-disc [&_ol]:my-4 [&_ol]:ml-6 [&_ol]:list-decimal ' +
        '[&_li]:mt-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-6 [&_blockquote]:italic ' +
        '[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 ' +
        '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 ' +
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] ' +
        '[&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-2'
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, markdownSanitizeSchema],
          rehypeRenderHtmlMath,
          rehypeKatex
        ]}
        urlTransform={(url, key) => (key === 'src' && !isNormalizedAssetRef(url) ? '' : url)}
        components={{
          a: ({ children, href }) => (
            <a href={href} target='_blank' rel='noreferrer'>
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <ParsedMarkdownImage
              src={src}
              alt={alt}
              projectSessionId={props.projectSessionId}
              knowledgeItemId={props.knowledgeItemId}
              parseRevisionId={props.parseRevisionId}
            />
          ),
          table: ({ children }) => <Table className='min-w-[40rem] table-fixed'>{children}</Table>,
          tbody: ({ children }) => <TableBody>{children}</TableBody>,
          td: ({ children }) => <TableCell>{children}</TableCell>,
          th: ({ children }) => <TableHead>{children}</TableHead>,
          thead: ({ children }) => <TableHeader>{children}</TableHeader>,
          tr: ({ children }) => <TableRow>{children}</TableRow>
        }}
      >
        {props.markdown}
      </ReactMarkdown>
    </article>
  )
}

function isNormalizedAssetRef(value: string): boolean {
  return /^images\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

function ParsedMarkdownImage(props: {
  src?: string
  alt?: string
  projectSessionId: string
  knowledgeItemId: string
  parseRevisionId: string
}): React.JSX.Element {
  const assetRef = props.src !== undefined && isNormalizedAssetRef(props.src) ? props.src : null
  const query = useQuery({
    queryKey: [
      'parsed-markdown-asset',
      props.projectSessionId,
      props.knowledgeItemId,
      props.parseRevisionId,
      assetRef
    ],
    queryFn: async () => {
      if (assetRef === null) throw new Error('Markdown image reference is not normalized')
      return window.desktop.knowledge.parsedAsset({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId,
        parseRevisionId: props.parseRevisionId,
        assetRef
      })
    },
    enabled: assetRef !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY
  })

  if (assetRef === null) {
    return <p className='text-xs text-muted-foreground'>Image unavailable.</p>
  }
  if (query.isLoading) {
    return (
      <div className='flex min-h-28 items-center justify-center rounded-md bg-muted text-muted-foreground'>
        <ImageIcon className='size-5' />
      </div>
    )
  }
  if (!query.data) {
    return <p className='text-xs text-destructive'>Image unavailable.</p>
  }
  return (
    <img
      src={`data:${query.data.mimeType};base64,${query.data.dataBase64}`}
      alt={props.alt ?? 'Parsed document image'}
      className='max-h-[32rem] max-w-full rounded-md border object-contain'
      loading='lazy'
    />
  )
}

function ParsedBlock(props: {
  block: NormalizedKnowledgeBlock
  isPdf: boolean
  projectSessionId: string
  knowledgeItemId: string
  parseRevisionId: string
  onOpenMapping(): void
}): React.JSX.Element {
  const mappingQuery = useQuery({
    queryKey: [
      'knowledge-mapping',
      props.projectSessionId,
      props.knowledgeItemId,
      props.block.page ?? 0
    ],
    queryFn: () =>
      window.desktop.knowledge.mappingPage({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId,
        pageIndex: props.block.page ?? 0
      }),
    enabled: props.isPdf && props.block.page !== undefined,
    retry: false,
    staleTime: 30_000
  })
  const usedByCount =
    props.block.page === undefined || mappingQuery.data?.state !== 'ready'
      ? null
      : mappingQuery.data.chunks.filter((chunk) =>
          chunk.coverages.some((coverage) => coverage.normalizedBlockIds.includes(props.block.id))
        ).length
  return (
    <article className='grid gap-2 py-5' data-block-id={props.block.id}>
      <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
        <Badge variant='secondary'>{props.block.type}</Badge>
        <span>Block {props.block.ordinal + 1}</span>
        {props.block.page !== undefined ? <span>Page {props.block.page + 1}</span> : null}
        {props.block.bbox !== undefined ? <span>bbox {props.block.bbox.join(', ')}</span> : null}
        {props.block.sourceProviderBlockId ? (
          <span>Provider block {props.block.sourceProviderBlockId}</span>
        ) : null}
        {usedByCount !== null ? (
          <Badge variant='outline'>Used by {usedByCount} chunks</Badge>
        ) : null}
        {usedByCount !== null && usedByCount > 0 ? (
          <Button size='xs' variant='ghost' onClick={props.onOpenMapping}>
            View in Mapping
          </Button>
        ) : null}
      </div>
      {props.block.headingPath.length > 0 ? (
        <p className='text-xs text-muted-foreground'>{props.block.headingPath.join(' / ')}</p>
      ) : null}
      {props.block.assetRefs.map((assetRef) => (
        <ParsedAsset
          key={assetRef}
          projectSessionId={props.projectSessionId}
          knowledgeItemId={props.knowledgeItemId}
          parseRevisionId={props.parseRevisionId}
          assetRef={assetRef}
          alt={props.block.text ?? 'Parsed document image'}
        />
      ))}
      {props.block.markdown || props.block.text ? (
        <div className='whitespace-pre-wrap break-words text-sm leading-6'>
          {props.block.markdown ?? props.block.text}
        </div>
      ) : null}
    </article>
  )
}

function ParsedAsset(props: {
  projectSessionId: string
  knowledgeItemId: string
  parseRevisionId: string
  assetRef: string
  alt: string
}): React.JSX.Element {
  const query = useQuery({
    queryKey: [
      'parsed-knowledge-asset',
      props.projectSessionId,
      props.knowledgeItemId,
      props.assetRef
    ],
    queryFn: () =>
      window.desktop.knowledge.parsedAsset({
        projectSessionId: props.projectSessionId,
        knowledgeItemId: props.knowledgeItemId,
        parseRevisionId: props.parseRevisionId,
        assetRef: props.assetRef
      }),
    staleTime: Number.POSITIVE_INFINITY
  })
  if (query.isLoading) {
    return (
      <div className='flex min-h-28 items-center justify-center rounded-md bg-muted text-muted-foreground'>
        <ImageIcon className='size-5' />
      </div>
    )
  }
  if (!query.data) return <p className='text-xs text-destructive'>Image unavailable.</p>
  return (
    <img
      src={`data:${query.data.mimeType};base64,${query.data.dataBase64}`}
      alt={props.alt}
      className='max-h-[32rem] w-auto max-w-full rounded-md border object-contain'
    />
  )
}
