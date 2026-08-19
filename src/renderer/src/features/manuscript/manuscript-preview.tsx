import type { ManuscriptAssembly } from '../../../../shared/contracts/manuscript'
import { manuscriptToMarkdown } from '../../../../shared/manuscript-markdown'
import { isAllowedExternalUrl } from '../../../../shared/security/urls'
import { AlertCircle, FileText, ImageOff, RefreshCw } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { WorkspaceRail } from '@/components/app-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
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
import { Spinner } from '@/components/ui/spinner'
import { useTheme } from '@/theme-provider'
import { markdownSanitizeSchema, rehypeRenderHtmlMath } from '../knowledge/markdown-math'
import { logicalAssetId, resolveProjectAssetUrl } from './project-asset-url'
import { renderMermaidPreviewDataUrl } from './rich-media-blocks'

const previewMarkdownSanitizeSchema = {
  ...markdownSanitizeSchema,
  protocols: {
    ...markdownSanitizeSchema.protocols,
    src: ['writellm-asset']
  }
}

interface PreviewNavigationProps {
  onOpenManuscript(): void
  onOpenKnowledge(): void
  onOpenChecks(): void
  onOpenAssets(): void
  onOpenReferences(): void
  onOpenIssues(): void
  onOpenWritingRules(): void
  onOpenFind(): void
  onOpenSettings(): void
}

export interface ManuscriptPreviewWorkspaceProps extends PreviewNavigationProps {
  projectSessionId: string
  projectName: string
  assembly: ManuscriptAssembly | undefined
  loading: boolean
  error: boolean
  onRetry(): void
}

export function safePreviewMarkdownUrl(url: string, key: string): string {
  if (key === 'href') return isAllowedExternalUrl(url) ? url : ''
  if (key !== 'src') return ''
  try {
    logicalAssetId(url)
    return url
  } catch {
    return ''
  }
}

export function ManuscriptPreviewWorkspace(
  props: ManuscriptPreviewWorkspaceProps
): React.JSX.Element {
  const projection = useMemo(
    () =>
      props.assembly === undefined ? undefined : manuscriptToMarkdown(props.assembly, (url) => url),
    [props.assembly]
  )
  const empty = props.assembly?.sections.length === 0 || projection?.markdown.trim() === ''

  return (
    <SidebarProvider
      data-testid='manuscript-preview-workspace'
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '280px' } as React.CSSProperties}
    >
      <Sidebar
        collapsible='icon'
        className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      >
        <WorkspaceRail
          activeWorkspace='preview'
          onOpenPreview={() => undefined}
          onOpenManuscript={props.onOpenManuscript}
          onOpenKnowledge={props.onOpenKnowledge}
          onOpenChecks={props.onOpenChecks}
          onOpenAssets={props.onOpenAssets}
          onOpenReferences={props.onOpenReferences}
          onOpenIssues={props.onOpenIssues}
          onOpenWritingRules={props.onOpenWritingRules}
          onOpenFind={props.onOpenFind}
          onOpenSettings={props.onOpenSettings}
        />
        <Sidebar collapsible='none' className='min-w-0 flex-1 overflow-hidden'>
          <SidebarHeader className='border-b p-4'>
            <div className='flex items-center gap-2'>
              <FileText className='size-4' aria-hidden='true' />
              <span className='font-medium'>Preview</span>
            </div>
            <p className='text-xs text-muted-foreground'>Rendered Markdown</p>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Preview</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive aria-current='page'>
                      <FileText />
                      <span>Markdown preview</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </Sidebar>
      <SidebarInset className='min-h-0 min-w-0 overflow-auto'>
        <header className='sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background p-4'>
          <SidebarTrigger className='-ml-1' />
          <Separator orientation='vertical' className='mr-2 data-[orientation=vertical]:h-4' />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <span>{props.projectName}</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Markdown preview</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main
          className='min-w-0 px-5 py-8 sm:px-8 lg:px-12'
          data-testid='whole-manuscript-preview-scroll'
        >
          <div className='mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-8'>
            <div className='flex min-w-0 flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between'>
              <div className='min-w-0'>
                <h1 className='text-2xl font-semibold tracking-tight'>Markdown preview</h1>
                <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
                  A read-only projection of the manuscript’s current Markdown export.
                </p>
                {props.assembly === undefined ? null : (
                  <p className='mt-2 text-sm text-muted-foreground' data-testid='preview-counts'>
                    {props.assembly.wordCount.toLocaleString()} words ·{' '}
                    {props.assembly.characterCount.toLocaleString()} characters
                  </p>
                )}
              </div>
              <Button
                className='self-start sm:self-auto'
                variant='outline'
                size='sm'
                disabled={props.loading}
                onClick={props.onRetry}
              >
                {props.loading ? (
                  <Spinner data-icon='inline-start' />
                ) : (
                  <RefreshCw data-icon='inline-start' />
                )}
                Refresh
              </Button>
            </div>

            {props.loading ? (
              <PreviewLoading />
            ) : props.error ? (
              <Alert variant='destructive'>
                <AlertCircle />
                <AlertTitle>The Markdown preview could not be assembled</AlertTitle>
                <AlertDescription>
                  <p>Your manuscript is unchanged. Retry when you are ready.</p>
                  <Button className='mt-3' variant='outline' size='sm' onClick={props.onRetry}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : empty || projection === undefined ? (
              <Empty className='min-h-80 border'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>No manuscript content is available</EmptyTitle>
                  <EmptyDescription>
                    Add a section and manuscript body to create a Markdown preview.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className='min-w-0'>
                {projection.lossReport.losses.length > 0 ? (
                  <Alert className='mx-auto mb-8 max-w-[70ch]' data-testid='preview-loss-report'>
                    <AlertCircle />
                    <AlertTitle>Some native formatting is simplified in Markdown</AlertTitle>
                    <AlertDescription>
                      {projection.lossReport.losses.length.toLocaleString()}{' '}
                      {projection.lossReport.losses.length === 1 ? 'detail is' : 'details are'} not
                      preserved by the Markdown format.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <ManuscriptMarkdown
                  projectSessionId={props.projectSessionId}
                  markdown={projection.markdown}
                />
              </div>
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function PreviewLoading(): React.JSX.Element {
  return (
    <div className='mx-auto w-full max-w-[70ch]' role='status' aria-label='Assembling manuscript'>
      <div className='mb-8 flex items-center gap-2 text-sm text-muted-foreground'>
        <Spinner /> Assembling manuscript…
      </div>
      <div className='space-y-4' aria-hidden='true'>
        <Skeleton className='h-8 w-2/3' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-11/12' />
        <Skeleton className='h-4 w-4/5' />
      </div>
    </div>
  )
}

export function ManuscriptMarkdown(props: {
  projectSessionId: string
  markdown: string
}): React.JSX.Element {
  return (
    <article
      className='typeset typeset-manuscript mx-auto w-full max-w-[70ch] min-w-0'
      data-testid='whole-manuscript-preview'
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, previewMarkdownSanitizeSchema],
          rehypeRenderHtmlMath,
          rehypeKatex
        ]}
        urlTransform={safePreviewMarkdownUrl}
        components={{
          a: ({ children, href }) =>
            href !== undefined && isAllowedExternalUrl(href) ? (
              <a href={href} target='_blank' rel='noreferrer'>
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt, src }) => (
            <ProjectAssetImage
              alt={alt ?? ''}
              logicalUrl={src ?? ''}
              projectSessionId={props.projectSessionId}
            />
          ),
          pre: ({ children, node }) => {
            const source = mermaidSource(node)
            return source === null ? <pre>{children}</pre> : <MarkdownMermaid source={source} />
          },
          table: ({ children }) => (
            <div className='typeset-scroll'>
              <table>{children}</table>
            </div>
          )
        }}
      >
        {props.markdown}
      </ReactMarkdown>
    </article>
  )
}

function ProjectAssetImage(props: {
  projectSessionId: string
  logicalUrl: string
  alt: string
}): React.JSX.Element {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    setResolvedUrl(null)
    setFailed(false)
    if (safePreviewMarkdownUrl(props.logicalUrl, 'src') === '') {
      setFailed(true)
      return
    }
    void resolveProjectAssetUrl(
      props.logicalUrl,
      props.projectSessionId,
      window.desktop.editor.resolveAsset
    )
      .then((url) => {
        if (disposed) return
        if (url === '') setFailed(true)
        else setResolvedUrl(url)
      })
      .catch((error: unknown) => {
        if (disposed) return
        reportPreviewError('renderer.manuscript_preview_asset_failed', error)
        setFailed(true)
      })
    return () => {
      disposed = true
    }
  }, [props.logicalUrl, props.projectSessionId])

  if (failed) return <MediaFallback label={props.alt || 'Image unavailable'} />
  if (resolvedUrl === null) {
    return <Skeleton className='aspect-video w-full' aria-label='Loading image' />
  }
  return (
    <img
      src={resolvedUrl}
      alt={props.alt}
      className='h-auto max-w-full'
      onError={() => setFailed(true)}
    />
  )
}

function MediaFallback({ label }: { label: string }): React.JSX.Element {
  return (
    <span
      role='img'
      aria-label={label}
      className='flex min-h-32 w-full items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground'
    >
      <ImageOff className='size-5' aria-hidden='true' />
      {label}
    </span>
  )
}

function MarkdownMermaid({ source }: { source: string }): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const reactId = useId()
  const [preview, setPreview] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    setPreview(null)
    setFailed(false)
    const id = `markdown-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
    void renderMermaidPreviewDataUrl(id, source, resolvedTheme === 'dark')
      .then((url) => {
        if (!disposed) setPreview(url)
      })
      .catch((error: unknown) => {
        if (disposed) return
        reportPreviewError('renderer.manuscript_preview_mermaid_failed', error)
        setFailed(true)
      })
    return () => {
      disposed = true
    }
  }, [reactId, resolvedTheme, source])

  if (failed) return <MediaFallback label='Mermaid diagram unavailable' />
  if (preview === null) {
    return (
      <span className='flex min-h-32 items-center justify-center gap-2 rounded-md border bg-muted/20 text-sm text-muted-foreground'>
        <Spinner /> Rendering diagram…
      </span>
    )
  }
  return <img src={preview} alt='Mermaid diagram' className='mx-auto h-auto max-w-full' />
}

function mermaidSource(node: unknown): string | null {
  if (!isRecord(node) || !Array.isArray(node.children) || node.children.length !== 1) return null
  const code = node.children[0]
  if (!isRecord(code) || code.tagName !== 'code' || !isRecord(code.properties)) return null
  const classes = code.properties.className
  if (!Array.isArray(classes) || !classes.includes('language-mermaid')) return null
  if (!Array.isArray(code.children)) return null
  return code.children
    .filter((child): child is Record<string, unknown> => isRecord(child) && child.type === 'text')
    .map((child) => (typeof child.value === 'string' ? child.value : ''))
    .join('')
    .replace(/\n$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function reportPreviewError(event: string, error: unknown): void {
  const original = error instanceof Error ? error : new Error(String(error))
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.error',
    message: `${event}: ${original.message || 'Markdown preview rendering failed'}`,
    stack: original.stack
  })
}
