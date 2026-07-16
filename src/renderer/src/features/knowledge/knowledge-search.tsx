import {
  SUPPORTED_KNOWLEDGE_EXTENSIONS,
  type KnowledgeItem
} from '../../../../shared/contracts/knowledge'
import type { KnowledgeSearchInput } from '../../../../shared/contracts/search'
import { useQuery } from '@tanstack/react-query'
import { Bug, FileSearch, ImageIcon, LoaderCircle, Search, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

export function KnowledgeSearch(props: {
  projectSessionId: string
  items: KnowledgeItem[]
  onError(message: string): void
}): React.JSX.Element {
  const [queryText, setQueryText] = useState('')
  const [heading, setHeading] = useState('')
  const [page, setPage] = useState('')
  const [extension, setExtension] = useState('all')
  const [knowledgeItemId, setKnowledgeItemId] = useState('all')
  const [request, setRequest] = useState<KnowledgeSearchInput | null>(null)
  const [debug, setDebug] = useState(false)
  const [citationId, setCitationId] = useState<string | null>(null)
  const searchQuery = useQuery({
    queryKey: ['knowledge-search', props.projectSessionId, request],
    queryFn: () => window.desktop.knowledge.search(request as KnowledgeSearchInput),
    enabled: request !== null,
    retry: false
  })
  const citationQuery = useQuery({
    queryKey: ['knowledge-citation', props.projectSessionId, citationId],
    queryFn: () =>
      window.desktop.knowledge.expandCitations({
        projectSessionId: props.projectSessionId,
        citationIds: [citationId as string]
      }),
    enabled: citationId !== null,
    retry: false
  })
  const selectedItem = props.items.find((item) => item.knowledgeItemId === knowledgeItemId)
  const submit = (): void => {
    const normalizedQuery = queryText.trim()
    if (!normalizedQuery) return
    const parsedPage = page.trim() === '' ? undefined : Number(page) - 1
    if (parsedPage !== undefined && (!Number.isInteger(parsedPage) || parsedPage < 0)) {
      props.onError('Search page must be a positive whole number.')
      return
    }
    setRequest({
      projectSessionId: props.projectSessionId,
      query: normalizedQuery,
      filters: {
        knowledgeItemIds: knowledgeItemId === 'all' ? [] : [knowledgeItemId],
        fileExtensions: extension === 'all' ? [] : [extension as never],
        parseRevisionIds: [],
        ...(parsedPage === undefined ? {} : { pageFrom: parsedPage, pageTo: parsedPage }),
        ...(heading.trim() === '' ? {} : { heading: heading.trim() })
      },
      limits: { fts: 100, vector: 100, fused: 50, results: 20 },
      rerank: true
    })
  }
  const citation = citationQuery.data?.[0]

  return (
    <section className='grid gap-3' aria-label='Knowledge search'>
      <form
        className='grid gap-3'
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className='flex gap-2'>
          <Input
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder='Search parsed project knowledge…'
            aria-label='Knowledge search query'
          />
          <Button type='submit' disabled={queryText.trim().length === 0 || searchQuery.isFetching}>
            {searchQuery.isFetching ? <LoaderCircle className='animate-spin' /> : <Search />}
            Search
          </Button>
        </div>
        <div className='flex flex-wrap gap-2'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type='button' variant='outline' size='sm'>
                <SlidersHorizontal /> {selectedItem?.displayName ?? 'All sources'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className='max-w-72'>
              <DropdownMenuLabel>Source</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={knowledgeItemId} onValueChange={setKnowledgeItemId}>
                <DropdownMenuRadioItem value='all'>All sources</DropdownMenuRadioItem>
                {props.items.map((item) => (
                  <DropdownMenuRadioItem key={item.knowledgeItemId} value={item.knowledgeItemId}>
                    <span className='truncate'>{item.displayName}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>File type</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={extension} onValueChange={setExtension}>
                <DropdownMenuRadioItem value='all'>All file types</DropdownMenuRadioItem>
                {SUPPORTED_KNOWLEDGE_EXTENSIONS.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {value.toUpperCase()}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Input
            className='h-8 w-28'
            inputMode='numeric'
            value={page}
            onChange={(event) => setPage(event.target.value)}
            placeholder='Page'
            aria-label='Source page filter'
          />
          <Input
            className='h-8 min-w-36 flex-1'
            value={heading}
            onChange={(event) => setHeading(event.target.value)}
            placeholder='Heading contains…'
            aria-label='Source heading filter'
          />
          <Button
            type='button'
            variant={debug ? 'secondary' : 'ghost'}
            size='sm'
            aria-pressed={debug}
            onClick={() => setDebug((value) => !value)}
          >
            <Bug /> Developer scores
          </Button>
        </div>
      </form>

      {searchQuery.isError ? (
        <p className='text-sm text-destructive'>Search could not be completed.</p>
      ) : null}
      {searchQuery.data ? (
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <Badge variant='outline'>{searchQuery.data.mode}</Badge>
          <Badge variant='outline'>rerank: {searchQuery.data.rerankStatus}</Badge>
          <span>{searchQuery.data.hits.length} results</span>
        </div>
      ) : null}
      <div className='divide-y border-y' data-testid='knowledge-search-results'>
        {searchQuery.data?.hits.map((hit) => (
          <article key={hit.citationId} className='grid gap-2 py-4'>
            <div className='flex items-start gap-2'>
              <FileSearch className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>{hit.title}</p>
                <p className='text-xs text-muted-foreground'>
                  {hit.headingPath.join(' / ') || 'No heading'}
                  {hit.page === undefined ? '' : ` · Page ${hit.page + 1}`}
                </p>
              </div>
              <Button variant='ghost' size='sm' onClick={() => setCitationId(hit.citationId)}>
                Preview source
              </Button>
            </div>
            <p className='pl-6 text-sm leading-6'>{hit.snippet}</p>
            {hit.assetRefs.length > 0 ? (
              <p className='pl-6 text-xs text-muted-foreground'>
                <ImageIcon className='mr-1 inline size-3' /> {hit.assetRefs.length} linked images
              </p>
            ) : null}
            {debug ? (
              <pre className='ml-6 overflow-x-auto rounded-md bg-muted p-2 text-[11px]'>
                {JSON.stringify({ score: hit.score, ...hit.debug }, null, 2)}
              </pre>
            ) : null}
          </article>
        ))}
        {searchQuery.data?.hits.length === 0 ? (
          <p className='py-4 text-center text-sm text-muted-foreground'>No matching chunks.</p>
        ) : null}
      </div>

      <Dialog open={citationId !== null} onOpenChange={(open) => !open && setCitationId(null)}>
        <DialogContent className='max-h-[85vh] max-w-3xl! overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>{citation?.title ?? 'Source preview'}</DialogTitle>
            <DialogDescription>
              {citation?.headingPath.join(' / ') || 'Normalized source chunk'}
              {citation?.page === undefined ? '' : ` · Page ${citation.page + 1}`}
            </DialogDescription>
          </DialogHeader>
          {citationQuery.isLoading ? (
            <div className='flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground'>
              <LoaderCircle className='size-4 animate-spin' /> Loading citation…
            </div>
          ) : citation ? (
            <div className='grid gap-4'>
              <div className='whitespace-pre-wrap text-sm leading-6'>{citation.text}</div>
              {citation.assetRefs.map((assetRef) => (
                <SearchAsset
                  key={assetRef}
                  projectSessionId={props.projectSessionId}
                  knowledgeItemId={citation.knowledgeItemId}
                  parseRevisionId={citation.parseRevisionId}
                  assetRef={assetRef}
                />
              ))}
              <div className='grid gap-1 border-t pt-3 text-xs text-muted-foreground'>
                <span>Citation: {citation.citationId}</span>
                <span>Parse revision: {citation.parseRevisionId}</span>
                <span>Source blocks: {citation.sourceBlockIds.join(', ')}</span>
              </div>
            </div>
          ) : (
            <p className='py-8 text-sm text-destructive'>Citation is no longer available.</p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function SearchAsset(props: {
  projectSessionId: string
  knowledgeItemId: string
  parseRevisionId: string
  assetRef: string
}): React.JSX.Element {
  const query = useQuery({
    queryKey: [
      'search-citation-asset',
      props.projectSessionId,
      props.knowledgeItemId,
      props.parseRevisionId,
      props.assetRef
    ],
    queryFn: () => window.desktop.knowledge.parsedAsset(props),
    staleTime: Number.POSITIVE_INFINITY
  })
  if (!query.data) {
    return (
      <div className='flex min-h-24 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground'>
        {query.isLoading ? 'Loading linked image…' : `Image unavailable: ${props.assetRef}`}
      </div>
    )
  }
  return (
    <figure className='grid gap-1'>
      <img
        src={`data:${query.data.mimeType};base64,${query.data.dataBase64}`}
        alt={`Source asset ${props.assetRef}`}
        className='max-h-[32rem] w-auto max-w-full rounded-md border object-contain'
      />
      <figcaption className='text-xs text-muted-foreground'>{props.assetRef}</figcaption>
    </figure>
  )
}
