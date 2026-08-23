import { randomUUID } from 'node:crypto'
import type { BrowserWindowConstructorOptions, PrintToPDFOptions } from 'electron'
import katex from 'katex'
import type { Logger } from 'pino'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {
  PublicationAssembly,
  PublicationInlineNode,
  PublicationNode
} from '../../shared/contracts/publication'
import { isMathSourceStructurallySafe } from '../../shared/math-source-safety'
import { PDF_ASSET_SCHEME } from '../bootstrap/protocol'

export interface PdfPublicationLoss {
  code: 'math_text_fallback' | 'mermaid_source_fallback' | 'pdf_toc_page_unavailable'
  sectionId: string
  blockId: string
  message: string
}

export interface PdfPublicationRenderInput {
  assembly: PublicationAssembly
  readAsset(assetId: string): Promise<Buffer>
  signal?: AbortSignal
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export type PdfPublicationRenderer = (
  input: PdfPublicationRenderInput
) => Promise<{ bytes: Buffer; losses: PdfPublicationLoss[] }>

interface PdfWindow {
  loadURL(url: string): Promise<void>
  isDestroyed(): boolean
  destroy(): void
  webContents: {
    printToPDF(options: PrintToPDFOptions): Promise<Buffer>
    stop(): void
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
    session: {
      setPermissionRequestHandler(
        handler: (
          webContents: Electron.WebContents,
          permission: string,
          callback: (allowed: boolean) => void
        ) => void
      ): void
      protocol: {
        handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void
      }
    }
  }
}

export function createPdfPublicationRenderer(options: {
  createWindow(options: BrowserWindowConstructorOptions): PdfWindow
  createId?: () => string
  extractOutlinePages?: typeof extractPdfOutlinePages
}): PdfPublicationRenderer {
  return async (input) => {
    if (!input.assembly.ready) {
      const err = new Error('Publication preflight contains blocking errors')
      input.log?.error(
        {
          event: 'manuscript.publication.pdf_render.failed',
          err,
          findingCount: input.assembly.findings.length
        },
        'PDF publication preflight contains blocking errors'
      )
      throw err
    }
    throwIfAborted(input.signal)
    const startedAt = Date.now()
    let printPasses = 0
    input.log?.info(
      {
        event: 'manuscript.publication.pdf_render.started',
        nodeCount: input.assembly.nodes.length,
        assetCount: input.assembly.assets.length,
        pageSize: input.assembly.options.pageSize,
        includeTableOfContents: input.assembly.options.includeTableOfContents
      },
      'PDF publication render started'
    )
    const partition = `writellm-pdf-${(options.createId ?? randomUUID)()}`
    const window = options.createWindow({
      width: 900,
      height: 1200,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        javascript: false,
        webSecurity: true
      }
    })
    input.log?.info(
      { event: 'manuscript.publication.pdf_window.created' },
      'PDF render window created'
    )
    const abort = (): void => {
      if (!window.isDestroyed()) {
        input.log?.warn(
          { event: 'manuscript.publication.pdf_render.aborted', printPasses },
          'PDF publication render aborted; destroying render window'
        )
        window.webContents.stop()
        window.destroy()
      }
    }
    input.signal?.addEventListener('abort', abort, { once: true })
    const print = async (): Promise<Buffer> => {
      const passStartedAt = Date.now()
      const bytes = await window.webContents.printToPDF(printOptions(input.assembly))
      printPasses += 1
      input.log?.info(
        {
          event: 'manuscript.publication.pdf_print.completed',
          pass: printPasses,
          byteSize: bytes.byteLength,
          durationMs: Date.now() - passStartedAt
        },
        'PDF print pass completed'
      )
      return bytes
    }
    try {
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false)
      )
      const assets = new Map<string, { bytes: Buffer; mimeType: string }>()
      for (const asset of input.assembly.assets) {
        throwIfAborted(input.signal)
        assets.set(asset.assetId, {
          bytes: await input.readAsset(asset.assetId),
          mimeType: asset.mimeType
        })
      }
      window.webContents.session.protocol.handle(PDF_ASSET_SCHEME, (request) => {
        const assetId = new URL(request.url).pathname.slice(1)
        const asset = assets.get(assetId)
        return asset === undefined
          ? new Response('Not found', { status: 404 })
          : new Response(new Uint8Array(asset.bytes), {
              headers: { 'content-type': asset.mimeType }
            })
      })
      const resolveAssetUrl = (assetId: string): string => `${PDF_ASSET_SCHEME}://asset/${assetId}`
      const first = renderPublicationHtml({
        assembly: input.assembly,
        resolveAssetUrl,
        tableOfContents: false
      })
      await loadHtml(window, first.html)
      throwIfAborted(input.signal)
      const firstPdf = await print()
      throwIfAborted(input.signal)
      const tocPages = input.assembly.options.includeTableOfContents
        ? await (options.extractOutlinePages ?? extractPdfOutlinePages)(firstPdf)
        : []
      const second = renderPublicationHtml({
        assembly: input.assembly,
        resolveAssetUrl,
        tableOfContents: input.assembly.options.includeTableOfContents,
        tocPages
      })
      await loadHtml(window, second.html)
      throwIfAborted(input.signal)
      let bytes = await print()
      throwIfAborted(input.signal)
      let losses = second.losses
      let tocRestabilized = false
      if (input.assembly.options.includeTableOfContents) {
        const correctedPages = await (options.extractOutlinePages ?? extractPdfOutlinePages)(bytes)
        if (!samePages(tocPages, correctedPages)) {
          tocRestabilized = true
          input.log?.warn(
            {
              event: 'manuscript.publication.pdf_toc.restabilized',
              headingCount: correctedPages.length
            },
            'Table-of-contents page numbers shifted; re-rendering with corrected pages'
          )
          const stabilized = renderPublicationHtml({
            assembly: input.assembly,
            resolveAssetUrl,
            tableOfContents: true,
            tocPages: correctedPages
          })
          await loadHtml(window, stabilized.html)
          throwIfAborted(input.signal)
          bytes = await print()
          throwIfAborted(input.signal)
          losses = stabilized.losses
        }
      }
      if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('Chromium returned an invalid PDF package')
      }
      input.log?.info(
        {
          event: 'manuscript.publication.pdf_render.completed',
          byteSize: bytes.byteLength,
          lossCount: losses.length,
          printPasses,
          tocRestabilized,
          durationMs: Date.now() - startedAt
        },
        'PDF publication render completed'
      )
      return { bytes, losses }
    } catch (err) {
      input.log?.error(
        {
          event: 'manuscript.publication.pdf_render.failed',
          err,
          printPasses,
          windowDestroyed: window.isDestroyed(),
          durationMs: Date.now() - startedAt
        },
        'PDF publication render failed'
      )
      throw err
    } finally {
      input.signal?.removeEventListener('abort', abort)
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

export function renderPublicationHtml(input: {
  assembly: PublicationAssembly
  resolveAssetUrl(assetId: string): string
  tableOfContents: boolean
  tocPages?: readonly number[]
}): { html: string; losses: PdfPublicationLoss[] } {
  const losses: PdfPublicationLoss[] = []
  const headings = publicationHeadings(input.assembly)
  const body = input.assembly.nodes.map((node) => htmlNode(node, input, losses)).join('\n')
  const toc = input.tableOfContents
    ? `<nav class="toc" aria-label="Table of contents"><h1>Table of Contents</h1><ol>${headings
        .map(
          (heading, index) =>
            `<li class="level-${heading.level}"><a href="#${heading.id}"><span>${escapeHtml(
              heading.title
            )}</span><span class="leader"></span><span>${input.tocPages?.[index] ?? '—'}</span></a></li>`
        )
        .join('')}</ol></nav>`
    : ''
  if (
    input.tableOfContents &&
    (input.tocPages === undefined || input.tocPages.length !== headings.length)
  ) {
    const first = input.assembly.nodes.find((node) => 'target' in node)?.target
    if (first !== undefined) {
      losses.push({
        code: 'pdf_toc_page_unavailable',
        sectionId: first.sectionId,
        blockId: first.blockId ?? 'section',
        message: 'One or more table-of-contents page numbers could not be resolved.'
      })
    }
  }
  const margins = input.assembly.options.marginsMm
  const page = input.assembly.options.pageSize === 'A4' ? 'A4' : 'Letter'
  const html = `<!doctype html>
<html lang="${escapeHtmlAttribute(input.assembly.language)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src writellm-pdf-asset:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(input.assembly.title)}</title>
<style>
@page { size: ${page}; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm; }
* { box-sizing: border-box; }
html { font-family: "Noto Serif CJK SC", "Songti SC", "PingFang SC", "Hiragino Mincho ProN", Georgia, serif; color: #18181b; font-size: 11pt; line-height: 1.55; }
body { margin: 0; }
.title-page { min-height: 60vh; display: flex; align-items: center; justify-content: center; text-align: center; break-after: page; }
.title-page .title { font-size: 28pt; font-weight: 650; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; line-height: 1.2; margin: 1.4em 0 .55em; }
h1 { font-size: 21pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
p { margin: 0 0 .8em; orphans: 3; widows: 3; }
a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.toc { break-after: page; } .toc ol { padding: 0; list-style: none; }
.toc li { margin: .25em 0; } .toc li.level-2 { padding-left: 1.5em; } .toc li.level-3 { padding-left: 3em; }
.toc a { display: flex; text-decoration: none; gap: .4em; } .toc .leader { flex: 1; border-bottom: 1px dotted #a1a1aa; transform: translateY(-.3em); }
blockquote { border-left: 2px solid #a1a1aa; margin: 1em 0; padding-left: 1em; color: #3f3f46; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f4f4f5; padding: .8em; break-inside: avoid; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9pt; }
table { width: 100%; border-collapse: collapse; margin: 1em 0; break-inside: avoid; }
th, td { border: 1px solid #a1a1aa; padding: .35em .5em; text-align: left; vertical-align: top; }
figure { margin: 1.2em 0; break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 65vh; object-fit: contain; }
figcaption { margin-top: .45em; font-style: italic; }
.math { overflow-wrap: anywhere; text-align: center; margin: 1em 0; break-inside: avoid; }
.inline-math { display: inline-block; max-width: 100%; overflow-wrap: anywhere; vertical-align: -0.15em; }
.references { break-before: page; }
</style>
</head>
<body>
<header class="title-page"><div class="title">${escapeHtml(input.assembly.title)}</div></header>
${toc}
<main>${body}</main>
</body>
</html>`
  return { html, losses }
}

function htmlNode(
  node: PublicationNode,
  input: {
    assembly: PublicationAssembly
    resolveAssetUrl(assetId: string): string
  },
  losses: PdfPublicationLoss[]
): string {
  switch (node.type) {
    case 'heading':
      return `<h${Math.min(node.level, 6)} id="${headingId(node)}">${inlineHtml(node.content, node.target, losses)}</h${Math.min(node.level, 6)}>`
    case 'paragraph':
      return `<p>${inlineHtml(node.content, node.target, losses)}</p>`
    case 'list_item': {
      const tag = node.kind === 'numbered' ? 'ol' : 'ul'
      const marker = node.kind === 'check' ? `${node.checked ? '☒' : '☐'} ` : ''
      return `<${tag}><li>${marker}${inlineHtml(node.content, node.target, losses)}</li></${tag}>`
    }
    case 'quote':
      return `<blockquote>${inlineHtml(node.content, node.target, losses)}</blockquote>`
    case 'code':
      return `<pre><code>${escapeHtml(node.content)}</code></pre>`
    case 'table':
      return `<table>${node.rows
        .map(
          (row, rowIndex) =>
            `<tr>${row
              .map((cell) => {
                const tag = rowIndex < node.headerRows ? 'th' : 'td'
                return `<${tag} colspan="${cell.colspan}" rowspan="${cell.rowspan}">${inlineHtml(cell.content, node.target, losses)}</${tag}>`
              })
              .join('')}</tr>`
        )
        .join('')}</table>`
    case 'figure':
      return `<figure id="${safeHtmlId(`figure-${node.figureId}`)}"><img src="${escapeHtmlAttribute(
        input.resolveAssetUrl(node.assetId)
      )}" alt="${escapeHtmlAttribute(node.altText)}"><figcaption>${escapeHtml(`${node.label}. ${node.caption}`)}</figcaption></figure>`
    case 'math': {
      const rendered = safeKatexHtml(node.source, true)
      if (rendered !== null) return `<div class="math">${rendered}</div>`
      losses.push({
        code: 'math_text_fallback',
        sectionId: node.target.sectionId,
        blockId: node.target.blockId ?? '',
        message: 'Unsafe or invalid display mathematics was emitted as readable source text.'
      })
      return `<pre><code>${escapeHtml(node.source)}</code></pre>`
    }
    case 'diagram':
      losses.push({
        code: 'mermaid_source_fallback',
        sectionId: node.target.sectionId,
        blockId: node.target.blockId ?? '',
        message: 'Mermaid was retained as source in the PDF publication.'
      })
      return `<figure>${node.caption ? `<figcaption><strong>${escapeHtml(node.caption)}</strong></figcaption>` : ''}<pre aria-label="${escapeHtmlAttribute(node.altText || node.caption || 'Mermaid diagram')}"><code>${escapeHtml(node.source)}</code></pre></figure>`
    case 'references':
      return `<section class="references"><h1 id="references">References</h1><ol>${node.entries
        .map((entry) => `<li value="${entry.number}">${escapeHtml(entry.title)}</li>`)
        .join('')}</ol></section>`
  }
}

function inlineHtml(
  nodes: PublicationInlineNode[],
  target: { sectionId: string; blockId: string | null },
  losses: PdfPublicationLoss[]
): string {
  return nodes
    .map((node) => {
      if (node.type === 'citation') return `<sup>[${node.number}]</sup>`
      if (node.type === 'link') {
        return `<a href="${escapeHtmlAttribute(node.href)}">${node.children.map(styledHtml).join('')}</a>`
      }
      if (node.type === 'math') {
        const rendered = safeKatexHtml(node.source, false)
        if (rendered !== null) return `<span class="inline-math">${rendered}</span>`
        losses.push({
          code: 'math_text_fallback',
          sectionId: target.sectionId,
          blockId: target.blockId ?? '',
          message: 'Invalid inline mathematics was emitted as readable source text.'
        })
        return `<code>${escapeHtml(`$${node.source}$`)}</code>`
      }
      return styledHtml(node)
    })
    .join('')
}

function safeKatexHtml(source: string, displayMode: boolean): string | null {
  if (!isMathSourceStructurallySafe(source)) return null
  const rendered = katex.renderToString(source, {
    displayMode,
    output: 'html',
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    maxExpand: 1_000,
    maxSize: 50
  })
  return rendered.includes('katex-error') ? null : rendered
}

function styledHtml(node: {
  text: string
  style: { bold: boolean; italic: boolean; underline: boolean; strike: boolean; code: boolean }
}): string {
  let result = escapeHtml(node.text)
  if (node.style.code) result = `<code>${result}</code>`
  if (node.style.strike) result = `<s>${result}</s>`
  if (node.style.underline) result = `<u>${result}</u>`
  if (node.style.italic) result = `<em>${result}</em>`
  if (node.style.bold) result = `<strong>${result}</strong>`
  return result
}

function publicationHeadings(assembly: PublicationAssembly): Array<{
  id: string
  title: string
  level: number
}> {
  return [
    ...assembly.nodes.flatMap((node) =>
      node.type === 'heading'
        ? [{ id: headingId(node), title: plainInline(node.content), level: node.level }]
        : []
    ),
    ...(assembly.nodes.some((node) => node.type === 'references')
      ? [{ id: 'references', title: 'References', level: 1 }]
      : [])
  ]
}

function headingId(node: Extract<PublicationNode, { type: 'heading' }>): string {
  return safeHtmlId(`heading-${node.target.sectionId}-${node.target.blockId ?? 'section'}`)
}

function safeHtmlId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '-').slice(0, 160)
}

function plainInline(nodes: PublicationInlineNode[]): string {
  return nodes
    .map((node) =>
      node.type === 'citation'
        ? `[${node.number}]`
        : node.type === 'link'
          ? node.children.map((child) => child.text).join('')
          : node.type === 'math'
            ? `$${node.source}$`
            : node.text
    )
    .join('')
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>]/gu,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] ?? character
  )
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function printOptions(assembly: PublicationAssembly): PrintToPDFOptions {
  return {
    landscape: false,
    displayHeaderFooter: true,
    printBackground: true,
    preferCSSPageSize: true,
    generateTaggedPDF: true,
    generateDocumentOutline: true,
    pageSize: assembly.options.pageSize === 'A4' ? 'A4' : 'Letter',
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#71717a;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  }
}

async function loadHtml(window: PdfWindow, html: string): Promise<void> {
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
}

async function extractPdfOutlinePages(bytes: Buffer): Promise<number[]> {
  const loading = getDocument({ data: new Uint8Array(bytes) })
  const document = await loading.promise
  try {
    const outline = (await document.getOutline()) ?? []
    const pages: number[] = []
    const visit = async (items: typeof outline): Promise<void> => {
      for (const item of items) {
        const destination =
          typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest
        const reference = destination?.[0]
        if (reference !== undefined && typeof reference === 'object') {
          pages.push((await document.getPageIndex(reference)) + 1)
        }
        if (item.items.length > 0) await visit(item.items)
      }
    }
    await visit(outline)
    return pages
  } finally {
    await loading.destroy()
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('PDF publication was cancelled')
}

function samePages(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((page, index) => page === right[index])
}
