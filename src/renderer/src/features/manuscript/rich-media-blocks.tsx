import { plainContentToString } from '@blocknote/core'
import {
  createReactBlockSpec,
  PreviewPlaceholder,
  SourceBlockWithPreview,
  type ReactCustomBlockRenderProps
} from '@blocknote/react'
import { Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from '../../theme-provider'
import { MediaMetadataPopover } from './media-metadata-popover'

const diagramConfig = {
  type: 'diagram',
  propSchema: {
    engine: { default: 'mermaid' as const, values: ['mermaid'] as const },
    caption: { default: '' },
    altText: { default: '' }
  },
  content: 'plain'
} as const

let mermaidRenderChain: Promise<void> = Promise.resolve()
let mermaidRenderSequence = 0

export const diagramBlockSpec = createReactBlockSpec(diagramConfig, {
  meta: {
    code: true,
    defining: true,
    isolating: false,
    hasPreview: true,
    hardBreakShortcut: 'enter'
  },
  render: DiagramBlock,
  toExternalHTML: ({ block }) => (
    <figure
      data-rich-block='diagram'
      data-engine='mermaid'
      data-alt-text={block.props.altText || undefined}
    >
      <pre>
        <code className='language-mermaid'>{plainContentToString(block.content)}</code>
      </pre>
      {block.props.caption ? <figcaption>{block.props.caption}</figcaption> : null}
    </figure>
  )
})()

function DiagramBlock({
  block,
  editor,
  contentRef
}: ReactCustomBlockRenderProps<typeof diagramConfig>): React.JSX.Element {
  const resolvedTheme = useDiagramTheme()
  const source = plainContentToString(block.content)
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let disposed = false
    if (source.length === 0) {
      setPreview(undefined)
      setError(undefined)
      return
    }
    if (source.includes('\0') || source.length > 64_000) {
      setError('Mermaid source must not contain NUL and cannot exceed 64,000 characters.')
      return
    }
    if (new TextEncoder().encode(source).byteLength > 64 * 1024) {
      setError('Mermaid source cannot exceed 64 KiB.')
      return
    }
    mermaidRenderSequence += 1
    void renderMermaidPreviewDataUrl(
      `mermaid-${block.id}-${mermaidRenderSequence}`,
      source,
      resolvedTheme === 'dark'
    )
      .then((url) => {
        if (!disposed) {
          setPreview(url)
          setError(undefined)
        }
      })
      .catch(() => {
        if (!disposed) setError('This Mermaid diagram is not valid or uses unsafe content.')
      })
    return () => {
      disposed = true
    }
  }, [block.id, resolvedTheme, source])

  const previewNode =
    preview === undefined ? undefined : (
      <figure className='m-0 flex max-w-full flex-col items-center gap-2'>
        <img
          src={preview}
          alt={block.props.altText || block.props.caption || 'Mermaid diagram'}
          className='h-auto max-h-[min(42rem,70vh)] max-w-full object-contain'
          draggable={false}
        />
        {block.props.caption ? (
          <figcaption className='max-w-[70ch] text-center text-sm text-muted-foreground'>
            {block.props.caption}
          </figcaption>
        ) : null}
      </figure>
    )

  return (
    <div className='relative my-2 w-full min-w-0 max-w-full'>
      <SourceBlockWithPreview
        block={block}
        editor={editor}
        contentRef={contentRef}
        source={source}
        preview={previewNode}
        error={error}
        emptySourcePlaceholder={
          <PreviewPlaceholder icon={<Workflow />} text='Add Mermaid source' />
        }
        errorPreview={
          <PreviewPlaceholder error icon={<Workflow />} text='Diagram preview unavailable' />
        }
        sourcePlaceholder='Enter Mermaid source'
      />
      {editor.isEditable ? (
        <div className='absolute right-2 top-2 z-10' contentEditable={false}>
          <MediaMetadataPopover
            idPrefix={`diagram-${block.id}`}
            title='Diagram metadata'
            description='Caption is visible to readers. Alt text describes the diagram for accessibility.'
            triggerLabel='Edit diagram metadata'
            caption={block.props.caption}
            altText={block.props.altText}
            onSave={(metadata) => editor.updateBlock(block, { props: metadata })}
          />
        </div>
      ) : null}
    </div>
  )
}

function useDiagramTheme(): 'light' | 'dark' {
  const { resolvedTheme } = useTheme()
  const [documentTheme, setDocumentTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : resolvedTheme
  )
  useEffect(() => setDocumentTheme(resolvedTheme), [resolvedTheme])
  useEffect(() => {
    const root = document.documentElement
    const update = (): void => setDocumentTheme(root.dataset.theme === 'dark' ? 'dark' : 'light')
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    update()
    return () => observer.disconnect()
  }, [])
  return documentTheme
}

function renderMermaid(id: string, source: string, dark: boolean): Promise<string> {
  const task = mermaidRenderChain.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize(getMermaidRenderConfig(dark))
    return (await mermaid.render(id, source)).svg
  })
  mermaidRenderChain = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

export async function renderMermaidPreviewDataUrl(
  id: string,
  source: string,
  dark: boolean
): Promise<string> {
  if (
    source.includes('\0') ||
    source.length > 64_000 ||
    new TextEncoder().encode(source).byteLength > 64 * 1024
  ) {
    throw new Error('Mermaid source exceeds its safe input boundary')
  }
  return svgDataUrl(sanitizeMermaidSvg(await renderMermaid(id, source, dark)))
}

export function getMermaidRenderConfig(dark: boolean) {
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: dark ? ('dark' as const) : ('default' as const),
    htmlLabels: false,
    flowchart: { htmlLabels: false }
  }
}

export function sanitizeMermaidSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (document.querySelector('parsererror') !== null) throw new Error('Invalid Mermaid SVG')
  for (const element of document.querySelectorAll('script,foreignObject,iframe,object,embed')) {
    element.remove()
  }
  for (const style of document.querySelectorAll('style')) {
    if (isUnsafeMermaidCss(style.textContent ?? '')) style.remove()
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (isUnsafeMermaidAttribute(name, value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement)
}

export function isUnsafeMermaidCss(value: string): boolean {
  if (/\b(?:@import|expression)\b/iu.test(value)) return true
  return [...value.matchAll(/url\(([^)]*)\)/giu)].some((match) => {
    const target = match[1]?.trim().replace(/^['"]|['"]$/gu, '') ?? ''
    return !target.startsWith('#')
  })
}

export function isUnsafeMermaidAttribute(name: string, value: string): boolean {
  const normalizedName = name.trim().toLowerCase()
  const normalizedValue = value.trim().toLowerCase()
  return (
    normalizedName.startsWith('on') ||
    normalizedName === 'src' ||
    ((normalizedName === 'href' || normalizedName === 'xlink:href') &&
      !normalizedValue.startsWith('#')) ||
    (normalizedName === 'style' && isUnsafeMermaidCss(normalizedValue))
  )
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
