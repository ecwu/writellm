import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react'
import katex, { type KatexOptions } from 'katex'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { useTheme } from '../../theme-provider'

const alignmentValues = ['left', 'center', 'right', 'justify'] as const

const sharedPropSchema = {
  textAlignment: { default: 'center' as const, values: alignmentValues },
  source: { default: '' },
  caption: { default: '' },
  previewWidth: { default: 720 }
}

const mermaidConfig = {
  type: 'mermaid',
  propSchema: sharedPropSchema,
  content: 'none'
} as const

const mathConfig = {
  type: 'math',
  propSchema: sharedPropSchema,
  content: 'none'
} as const

let mermaidRenderChain: Promise<void> = Promise.resolve()

const displayMathOptions = {
  displayMode: true,
  throwOnError: true,
  trust: false,
  strict: 'error',
  maxExpand: 1_000,
  maxSize: 50,
  output: 'htmlAndMathml'
} satisfies KatexOptions

export const mermaidBlockSpec = createReactBlockSpec(mermaidConfig, {
  render: MermaidBlock,
  toExternalHTML: ({ block }) => (
    <pre data-rich-block='mermaid'>
      <code>{block.props.source}</code>
    </pre>
  )
})()

export const mathBlockSpec = createReactBlockSpec(mathConfig, {
  render: MathBlock,
  toExternalHTML: ({ block }) => (
    <div data-rich-block='math'>
      <span>{block.props.source}</span>
    </div>
  )
})()

function MermaidBlock({
  block,
  editor
}: ReactCustomBlockRenderProps<typeof mermaidConfig>): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const [editing, setEditing] = useState(block.props.source.length === 0)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    if (block.props.source.length === 0) {
      setPreview(null)
      setError(null)
      return
    }
    if (new TextEncoder().encode(block.props.source).byteLength > 64 * 1024) {
      setPreview(null)
      setError('Mermaid source exceeds the 64 KiB limit.')
      return
    }
    void renderMermaid(`mermaid-${block.id}`, block.props.source, resolvedTheme === 'dark')
      .then((rendered) => {
        if (!disposed) {
          setPreview(svgDataUrl(sanitizeMermaidSvg(rendered)))
          setError(null)
        }
      })
      .catch(() => {
        if (!disposed) {
          setPreview(null)
          setError('This Mermaid diagram is not valid.')
        }
      })
    return () => {
      disposed = true
    }
  }, [block.id, block.props.source, resolvedTheme])

  return (
    <RichBlockFrame
      title='Mermaid diagram'
      editing={editing}
      setEditing={setEditing}
      caption={block.props.caption}
      onCaption={(caption) => editor.updateBlock(block, { props: { caption } })}
    >
      {editing ? (
        <Textarea
          aria-label='Mermaid source'
          className='min-h-40 font-mono'
          value={block.props.source}
          maxLength={64_000}
          onChange={(event) => {
            const source = event.currentTarget.value
            if (new TextEncoder().encode(source).byteLength <= 64 * 1024) {
              editor.updateBlock(block, { props: { source } })
            }
          }}
        />
      ) : error !== null ? (
        <p className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
          {error}
        </p>
      ) : preview === null ? (
        <p className='text-sm text-muted-foreground'>Add Mermaid source to render a diagram.</p>
      ) : (
        <img
          src={preview}
          alt={block.props.caption || 'Mermaid diagram'}
          className='mx-auto h-auto max-w-full'
          style={{ width: Math.min(block.props.previewWidth, 8_192) }}
        />
      )}
    </RichBlockFrame>
  )
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

function MathBlock({
  block,
  editor
}: ReactCustomBlockRenderProps<typeof mathConfig>): React.JSX.Element {
  const [editing, setEditing] = useState(block.props.source.length === 0)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = previewRef.current
    if (editing) return
    if (target === null || block.props.source.length === 0) {
      setError(null)
      if (target !== null) target.replaceChildren()
      return
    }
    if (new TextEncoder().encode(block.props.source).byteLength > 32 * 1024) {
      setError('LaTeX source exceeds the 32 KiB limit.')
      target.replaceChildren()
      return
    }
    try {
      renderDisplayMath(block.props.source, target)
      setError(null)
    } catch {
      target.replaceChildren()
      setError('This LaTeX formula is not valid or uses an unsafe command.')
    }
  }, [block.props.source, editing])

  return (
    <RichBlockFrame
      title='Display formula'
      editing={editing}
      setEditing={setEditing}
      caption={block.props.caption}
      onCaption={(caption) => editor.updateBlock(block, { props: { caption } })}
    >
      {editing ? (
        <Textarea
          aria-label='LaTeX source'
          className='min-h-28 font-mono'
          value={block.props.source}
          maxLength={32_000}
          onChange={(event) => {
            const source = event.currentTarget.value
            if (new TextEncoder().encode(source).byteLength <= 32 * 1024) {
              editor.updateBlock(block, { props: { source } })
            }
          }}
        />
      ) : (
        <>
          {error !== null ? (
            <p className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
              {error}
            </p>
          ) : null}
          <div
            ref={previewRef}
            className={error === null ? 'max-w-full overflow-auto py-3 text-center' : 'hidden'}
          />
        </>
      )}
    </RichBlockFrame>
  )
}

function RichBlockFrame(props: {
  title: string
  editing: boolean
  setEditing(value: boolean): void
  caption: string
  onCaption(value: string): void
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className='my-2 w-full rounded-md border bg-background p-3' contentEditable={false}>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <span className='text-xs font-medium text-muted-foreground'>{props.title}</span>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => props.setEditing(!props.editing)}
        >
          {props.editing ? 'Preview' : 'Edit source'}
        </Button>
      </div>
      {props.children}
      <Input
        aria-label={`${props.title} caption`}
        className='mt-3'
        value={props.caption}
        maxLength={2_000}
        placeholder='Optional caption'
        onChange={(event) => props.onCaption(event.currentTarget.value)}
      />
    </div>
  )
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

export function renderDisplayMath(source: string, target: HTMLElement): void {
  katex.render(source, target, displayMathOptions)
}

export function renderDisplayMathToString(source: string): string {
  return katex.renderToString(source, displayMathOptions)
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
      if (
        name.startsWith('on') ||
        name === 'src' ||
        ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) ||
        (name === 'style' && isUnsafeMermaidCss(value))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement)
}

export function isUnsafeMermaidCss(value: string): boolean {
  if (/\b(?:@import|expression)\b/i.test(value)) return true
  return [...value.matchAll(/url\(([^)]*)\)/gi)].some((match) => {
    const target = match[1]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
    return !target.startsWith('#')
  })
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
