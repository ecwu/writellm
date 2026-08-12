import type { ExpandedCitation } from '../../../../shared/contracts/search'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ExpandedCitationPreview(props: {
  projectSessionId: string
  citation: ExpandedCitation
}): React.JSX.Element {
  return (
    <div className='grid gap-4'>
      <div className='whitespace-pre-wrap text-sm leading-6'>{props.citation.text}</div>
      {props.citation.assetRefs.map((assetRef) => (
        <CitationAsset
          key={assetRef}
          projectSessionId={props.projectSessionId}
          knowledgeItemId={props.citation.knowledgeItemId}
          parseRevisionId={props.citation.parseRevisionId}
          assetRef={assetRef}
        />
      ))}
      <div className='grid gap-1 border-t pt-3 text-xs text-muted-foreground'>
        <span>Citation: {props.citation.citationId}</span>
        <span>Parse revision: {props.citation.parseRevisionId}</span>
        <span>Source blocks: {props.citation.sourceBlockIds.join(', ')}</span>
      </div>
    </div>
  )
}

export function CitationCandidatePicker(props: {
  citations: ExpandedCitation[]
  onSelect(citation: ExpandedCitation): void
}): React.JSX.Element {
  return (
    <ul className='grid gap-2' aria-label='Matching citation evidence'>
      {props.citations.map((citation) => (
        <li key={citation.citationId}>
          <Button
            type='button'
            variant='outline'
            className='h-auto w-full min-w-0 justify-start gap-3 whitespace-normal px-4 py-3 text-left'
            onClick={() => props.onSelect(citation)}
            aria-label={`Open ${citation.title}${citation.page === undefined ? '' : `, page ${citation.page + 1}`}`}
          >
            <FileText className='size-4 shrink-0 text-muted-foreground' />
            <span className='min-w-0 flex-1'>
              <span className='block truncate font-medium'>{citation.title}</span>
              <span className='mt-0.5 block text-xs text-muted-foreground'>
                {citation.headingPath.join(' / ') || 'Normalized source chunk'}
                {citation.page === undefined ? '' : ` · Page ${citation.page + 1}`}
              </span>
              <span className='mt-1 line-clamp-2 block text-xs font-normal text-muted-foreground'>
                {citation.text}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

function CitationAsset(props: {
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
