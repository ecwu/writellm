import { describe, expect, it, vi } from 'vitest'
import type { PublicationAssembly } from '../../shared/contracts/publication'
import { createPdfPublicationRenderer, renderPublicationHtml } from './pdf-publication'

const sectionId = '019d0000-0000-7000-8000-000000000801'
const revisionId = '019d0000-0000-7000-8000-000000000802'
const assetId = '019d0000-0000-7000-8000-000000000803'
const target = { sectionId, revisionId, blockId: 'block' }

describe('PDF publication', () => {
  it('renders a print-only, escaped, accessible publication document', () => {
    const result = renderPublicationHtml({
      assembly: fixtureAssembly(),
      resolveAssetUrl: (id) => `writellm-pdf-asset://asset/${id}`,
      tableOfContents: true,
      tocPages: [2, 3]
    })

    expect(result.html).toContain('@page { size: A4; margin: 25mm 25mm 25mm 25mm; }')
    expect(result.html).toContain('中文 &amp; Latin &lt;script&gt;')
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain("content=\"default-src 'none'")
    expect(result.html).toContain(`writellm-pdf-asset://asset/${assetId}`)
    expect(result.html).toContain('alt="Alternative figure"')
    expect(result.html).toContain('Table of Contents')
    expect(result.html).toContain('<span>2</span>')
    expect(result.html).toContain('katex')
    expect(result.html).toContain('class="inline-math"')
    expect(result.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'math_text_fallback' }),
        expect.objectContaining({ code: 'mermaid_source_fallback' })
      ])
    )
  })

  it('never turns hostile inline math into links, remote resources, HTML, or extreme layout', () => {
    const assembly = fixtureAssembly()
    const paragraph = assembly.nodes.find((node) => node.type === 'paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('Fixture paragraph is missing')
    paragraph.content = [
      { type: 'math', source: String.raw`\href{https://evil.example}{click}` },
      { type: 'math', source: String.raw`\includegraphics{https://evil.example/pixel.png}` },
      { type: 'math', source: String.raw`\htmlClass{danger}{x}` },
      { type: 'math', source: String.raw`\rule{9999em}{1em}` }
    ]

    const result = renderPublicationHtml({
      assembly,
      resolveAssetUrl: (id) => `writellm-pdf-asset://asset/${id}`,
      tableOfContents: false
    })
    expect(result.losses.filter((loss) => loss.code === 'math_text_fallback')).toHaveLength(4)
    expect(result.html).not.toContain('<a href="https://evil.example')
    expect(result.html).not.toContain('<img src="https://evil.example')
    expect(result.html).not.toContain('class="danger"')
    expect(result.html).not.toContain('style="height:9999em')
  })

  it('uses one locked-down hidden window, two print passes, and destroys it', async () => {
    const loaded: string[] = []
    const printToPDF = vi.fn(async () => Buffer.from('%PDF-1.7\nfixture'))
    const destroy = vi.fn()
    const stop = vi.fn()
    let destroyed = false
    const handle = vi.fn()
    const permission = vi.fn()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const createWindow = vi.fn((_options) => ({
      loadURL: async (url: string) => {
        loaded.push(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8'))
      },
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true
        destroy()
      },
      webContents: {
        printToPDF,
        stop,
        setWindowOpenHandler: vi.fn(),
        session: {
          setPermissionRequestHandler: permission,
          protocol: { handle }
        }
      }
    }))
    const extractOutlinePages = vi
      .fn<() => Promise<number[]>>()
      .mockResolvedValueOnce([2, 3])
      .mockResolvedValueOnce([3, 4])
    const renderer = createPdfPublicationRenderer({
      createWindow: createWindow as never,
      createId: () => 'renderer',
      extractOutlinePages
    })

    const result = await renderer({
      assembly: fixtureAssembly(),
      readAsset: async () => Buffer.from('image'),
      log
    })

    expect(result.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          javascript: false,
          partition: 'writellm-pdf-renderer'
        })
      })
    )
    expect(handle).toHaveBeenCalledOnce()
    expect(permission).toHaveBeenCalledOnce()
    expect(printToPDF).toHaveBeenCalledTimes(3)
    expect(printToPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        printBackground: true,
        preferCSSPageSize: true,
        generateTaggedPDF: true,
        generateDocumentOutline: true
      })
    )
    expect(loaded[0]).not.toContain('Table of Contents')
    expect(loaded[1]).toContain('Table of Contents')
    expect(loaded[2]).toContain('<span>3</span>')
    expect(destroy).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()

    const events = log.info.mock.calls.map((call) => (call[0] as { event: string }).event)
    expect(events).toEqual([
      'manuscript.publication.pdf_render.started',
      'manuscript.publication.pdf_window.created',
      'manuscript.publication.pdf_print.completed',
      'manuscript.publication.pdf_print.completed',
      'manuscript.publication.pdf_print.completed',
      'manuscript.publication.pdf_render.completed'
    ])
    expect(log.info).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: 'manuscript.publication.pdf_render.completed',
        byteSize: result.bytes.byteLength,
        printPasses: 3,
        tocRestabilized: true
      }),
      expect.any(String)
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'manuscript.publication.pdf_toc.restabilized' }),
      expect.any(String)
    )
    expect(log.error).not.toHaveBeenCalled()
  })

  it('logs the original error and window state when a print pass fails', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const failure = new Error('simulated printToPDF failure')
    let destroyed = false
    const createWindow = vi.fn((_options) => ({
      loadURL: async () => undefined,
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true
      },
      webContents: {
        printToPDF: async () => {
          throw failure
        },
        stop: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        session: {
          setPermissionRequestHandler: vi.fn(),
          protocol: { handle: vi.fn() }
        }
      }
    }))
    const renderer = createPdfPublicationRenderer({
      createWindow: createWindow as never,
      createId: () => 'failing'
    })

    await expect(
      renderer({
        assembly: fixtureAssembly(),
        readAsset: async () => Buffer.from('image'),
        log
      })
    ).rejects.toThrow('simulated printToPDF failure')
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.publication.pdf_render.failed',
        err: failure,
        printPasses: 0,
        windowDestroyed: false
      }),
      expect.any(String)
    )
    expect(destroyed).toBe(true)
  })

  it('fails closed and destroys the hidden window when PDF.js receives malformed output', async () => {
    const failureBytes = Buffer.from('%PDF-1.7\nmalformed')
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    let destroyed = false
    const destroy = vi.fn(() => {
      destroyed = true
    })
    const createWindow = vi.fn((_options) => ({
      loadURL: async () => undefined,
      isDestroyed: () => destroyed,
      destroy,
      webContents: {
        printToPDF: async () => failureBytes,
        stop: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        session: {
          setPermissionRequestHandler: vi.fn(),
          protocol: { handle: vi.fn() }
        }
      }
    }))
    const renderer = createPdfPublicationRenderer({
      createWindow: createWindow as never,
      createId: () => 'malformed'
    })

    await expect(
      renderer({
        assembly: fixtureAssembly(),
        readAsset: async () => Buffer.from('image'),
        log
      })
    ).rejects.toThrow()
    expect(destroy).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.publication.pdf_render.failed',
        err: expect.any(Error),
        printPasses: 1
      }),
      expect.any(String)
    )
  })

  it('logs blocking preflight findings before rejecting', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const createWindow = vi.fn()
    const renderer = createPdfPublicationRenderer({ createWindow, createId: () => 'blocked' })

    await expect(
      renderer({
        assembly: { ...fixtureAssembly(), ready: false },
        readAsset: async () => Buffer.from('image'),
        log
      })
    ).rejects.toThrow('Publication preflight contains blocking errors')
    expect(createWindow).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.publication.pdf_render.failed',
        err: expect.any(Error),
        findingCount: 0
      }),
      expect.any(String)
    )
    expect(log.info).not.toHaveBeenCalled()
  })

  it('fails before allocating a window when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const createWindow = vi.fn()
    const renderer = createPdfPublicationRenderer({ createWindow, createId: () => 'cancelled' })

    await expect(
      renderer({
        assembly: fixtureAssembly(),
        readAsset: async () => Buffer.from('image'),
        signal: controller.signal
      })
    ).rejects.toThrow('cancelled')
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('renders a bounded large manuscript without dropping publication nodes', () => {
    const assembly = fixtureAssembly()
    const paragraph = assembly.nodes.find((node) => node.type === 'paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('Fixture paragraph is missing')
    assembly.nodes = Array.from({ length: 5_000 }, (_, index) => ({
      ...paragraph,
      target: { ...paragraph.target, blockId: `paragraph-${index}` }
    }))

    const result = renderPublicationHtml({
      assembly,
      resolveAssetUrl: (id) => `writellm-pdf-asset://asset/${id}`,
      tableOfContents: false
    })

    expect(result.html.match(/<p>/gu)).toHaveLength(5_000)
    expect(result.html.length).toBeGreaterThan(500_000)
  })
})

function fixtureAssembly(): PublicationAssembly {
  return {
    schemaVersion: 1,
    manuscriptId: 'manuscript',
    outlineVersion: 1,
    title: 'PDF Publication',
    language: 'zh-CN',
    options: {
      schemaVersion: 1,
      pageSize: 'A4',
      marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
      template: 'academic',
      includeTableOfContents: true,
      includeReferences: true,
      mermaidFallback: 'source'
    },
    nodes: [
      {
        type: 'heading',
        level: 1,
        content: [{ type: 'text', text: '中文 & Latin <script>', style: style() }],
        target: { ...target, blockId: null }
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Evidence ', style: { ...style(), bold: true } },
          { type: 'citation', number: 1, title: 'Source', raw: '[Source]' },
          { type: 'math', source: 'E = mc^2' },
          { type: 'math', source: '\\input{/private/secret}' },
          {
            type: 'link',
            href: 'https://example.com/research?a=1&b=2',
            children: [{ type: 'text', text: 'Link', style: style() }]
          }
        ],
        target
      },
      {
        type: 'table',
        headerRows: 1,
        columnWidths: [100],
        rows: [
          [
            {
              content: [{ type: 'text', text: 'Header', style: style() }],
              colspan: 1,
              rowspan: 1
            }
          ]
        ],
        target
      },
      { type: 'math', source: '\\frac{x}{y}', target },
      {
        type: 'diagram',
        engine: 'mermaid',
        source: 'graph TD; A-->B',
        caption: 'Flow',
        altText: 'A flows to B',
        target
      },
      {
        type: 'figure',
        figureId: 'figure:pdf',
        figureNumber: 1,
        label: 'Figure 1',
        target,
        assetId,
        caption: 'A figure',
        altText: 'Alternative figure',
        width: 1,
        height: 1
      },
      { type: 'references', entries: [{ number: 1, title: 'Source', count: 1 }] }
    ],
    assets: [
      {
        assetId,
        logicalUrl: `writellm-asset:${assetId}`,
        mimeType: 'image/png',
        byteSize: 1,
        width: 1,
        height: 1,
        availability: 'available'
      }
    ],
    referenceCount: 1,
    figureCount: 1,
    sourceHash: 'c'.repeat(64),
    findings: [],
    ready: true
  }
}

function style(): {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
} {
  return { bold: false, italic: false, underline: false, strike: false, code: false }
}
