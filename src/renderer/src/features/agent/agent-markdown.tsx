import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useRef } from 'react'
import { isAllowedExternalUrl } from '../../../../shared/security/urls'
import { Button } from '@/components/ui/button'

export function AgentMarkdown(props: {
  content: string
  citationOrdinals?: readonly number[]
  onCitation?: (ordinal: number) => void
}): React.JSX.Element {
  const citationToken = useRef(globalThis.crypto.randomUUID()).current
  const citationOrdinals = props.citationOrdinals ?? []
  const content = notebookCitationMarkdown(props.content, citationOrdinals, citationToken)
  return (
    <article
      className={
        'max-w-full min-w-0 wrap-anywhere text-sm leading-6 ' +
        '[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold ' +
        '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold ' +
        '[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold ' +
        '[&_p:not(:first-child)]:mt-3 [&_ul]:my-3 [&_ul]:ml-5 [&_ul]:list-disc ' +
        '[&_ol]:my-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_li]:mt-1 ' +
        '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground ' +
        '[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 ' +
        '[&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 ' +
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] ' +
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_hr]:my-4 [&_hr]:border-border ' +
        '[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left ' +
        '[&_td]:border [&_td]:px-2 [&_td]:py-1'
      }
    >
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) => {
          if (key !== 'href') return ''
          return isNotebookCitationUrl(url, citationToken) || isAllowedExternalUrl(url) ? url : ''
        }}
        components={{
          a: ({ children, href }) => {
            const citationOrdinal = notebookCitationOrdinal(href, citationToken)
            if (
              citationOrdinal !== null &&
              citationOrdinals.includes(citationOrdinal) &&
              props.onCitation !== undefined
            ) {
              return (
                <Button
                  type='button'
                  variant='outline'
                  size='xs'
                  className='mx-0.5 inline-flex align-baseline no-underline'
                  aria-label={`Open citation ${citationOrdinal}`}
                  onClick={() => props.onCitation?.(citationOrdinal)}
                >
                  {children}
                </Button>
              )
            }
            return href !== undefined && isAllowedExternalUrl(href) ? (
              <a href={href} target='_blank' rel='noreferrer'>
                {children}
              </a>
            ) : (
              <span>{children}</span>
            )
          },
          img: ({ alt }) => (
            <span className='text-muted-foreground'>{alt ? `[Image: ${alt}]` : '[Image]'}</span>
          ),
          table: ({ children }) => (
            <div className='my-3 max-w-full overflow-x-auto'>
              <table>{children}</table>
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}

export function notebookCitationMarkdown(
  content: string,
  citationOrdinals: readonly number[],
  citationToken = 'registered'
): string {
  const allowed = new Set(citationOrdinals)
  return content
    .replace(/writellm-citation:/giu, 'writellm-citation-text:')
    .replace(/\[\[cite:(\d{1,3})\]\]/gu, (marker, rawOrdinal: string) => {
      const ordinal = Number(rawOrdinal)
      if (!allowed.has(ordinal)) return marker
      return `[${ordinal}](writellm-citation:${citationToken}:${ordinal})`
    })
}

function isNotebookCitationUrl(url: string, citationToken: string): boolean {
  return notebookCitationOrdinal(url, citationToken) !== null
}

function notebookCitationOrdinal(href: string | undefined, citationToken: string): number | null {
  if (href === undefined) return null
  const prefix = `writellm-citation:${citationToken}:`
  if (!href.startsWith(prefix)) return null
  const ordinal = href.slice(prefix.length)
  return /^\d{1,3}$/u.test(ordinal) ? Number(ordinal) : null
}
