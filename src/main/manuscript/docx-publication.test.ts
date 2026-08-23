import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { describe, expect, it, vi } from 'vitest'
import type { PublicationAssembly } from '../../shared/contracts/publication'
import { renderDocxPublication } from './docx-publication'

const assetId = '019d0000-0000-7000-8000-000000000601'
const sectionId = '019d0000-0000-7000-8000-000000000602'
const revisionId = '019d0000-0000-7000-8000-000000000603'
const target = { sectionId, revisionId, blockId: 'block' }
const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

describe('DOCX publication renderer', () => {
  it('produces deterministic, structurally valid OOXML with semantic Word content', async () => {
    const assembly = fixtureAssembly()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const first = await renderDocxPublication({
      assembly,
      readAsset: async () => imageBytes,
      log
    })
    const second = await renderDocxPublication({
      assembly,
      readAsset: async () => imageBytes
    })

    expect(second.bytes).toEqual(first.bytes)
    expect(first.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'math_text_fallback' }),
        expect.objectContaining({ code: 'mermaid_source_fallback' })
      ])
    )
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'manuscript.publication.docx_render.started' }),
      expect.any(String)
    )
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.publication.docx_render.completed',
        byteSize: first.bytes.byteLength,
        lossCount: first.losses.length,
        lossesByCode: { math_text_fallback: 1, mermaid_source_fallback: 1 }
      }),
      expect.any(String)
    )
    expect(log.error).not.toHaveBeenCalled()

    const zip = await JSZip.loadAsync(first.bytes)
    const names = Object.keys(zip.files)
    expect(names).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'word/document.xml',
        'word/footer1.xml',
        'word/_rels/document.xml.rels'
      ])
    )
    const documentXml = await requiredEntry(zip, 'word/document.xml')
    const relationshipsXml = await requiredEntry(zip, 'word/_rels/document.xml.rels')
    const footerXml = await requiredEntry(zip, 'word/footer1.xml')
    expect(() => new XMLParser({ ignoreAttributes: false }).parse(documentXml)).not.toThrow()
    expect(documentXml).toContain('<m:oMath>')
    expect(documentXml).toContain('<m:f>')
    expect(documentXml).toContain('Alternative figure')
    expect(documentXml).toContain('Figure 1. A deterministic pixel')
    expect(relationshipsXml).toContain('https://example.com/research')
    expect(footerXml).toContain('PAGE')
    expect(footerXml).toContain('NUMPAGES')

    const extracted = await mammoth.extractRawText({ buffer: first.bytes })
    expect(extracted.value).toContain('Publication fixture 文档')
    expect(extracted.value).toContain('Introduction 介绍')
    expect(extracted.value).toContain('Evidence')
    expect(extracted.value).toContain('[1]')
    expect(extracted.value).toContain('References')
    expect(extracted.value).toContain('Research Source')
  })

  it('records an explicit loss instead of embedding unsupported WebP bytes', async () => {
    const assembly = fixtureAssembly()
    const asset = assembly.assets[0]
    if (asset === undefined) throw new Error('Fixture asset is missing')
    assembly.assets[0] = { ...asset, mimeType: 'image/webp' }

    const rendered = await renderDocxPublication({
      assembly,
      readAsset: async () => Buffer.from('not-used')
    })

    expect(rendered.losses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'webp_unsupported' })])
    )
    const extracted = await mammoth.extractRawText({ buffer: rendered.bytes })
    expect(extracted.value).toContain('[Figure 1: Alternative figure]')
  })
})

async function requiredEntry(zip: JSZip, name: string): Promise<string> {
  const entry = zip.file(name)
  if (entry === null) throw new Error(`Missing DOCX entry: ${name}`)
  return entry.async('string')
}

function fixtureAssembly(): PublicationAssembly {
  return {
    schemaVersion: 1,
    manuscriptId: 'manuscript',
    outlineVersion: 1,
    title: 'Publication fixture 文档',
    language: 'en',
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
        content: [{ type: 'text', text: 'Introduction 介绍', style: emptyStyle() }],
        target: { ...target, blockId: null }
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Evidence ', style: { ...emptyStyle(), bold: true } },
          { type: 'citation', number: 1, title: 'Research Source', pageIndex: 1, raw: '[Source]' },
          { type: 'text', text: ' and ', style: emptyStyle() },
          { type: 'math', source: 'E = mc^2' },
          {
            type: 'link',
            href: 'https://example.com/research',
            children: [{ type: 'text', text: 'external link', style: emptyStyle() }]
          }
        ],
        target
      },
      {
        type: 'list_item',
        kind: 'bullet',
        depth: 0,
        checked: null,
        ordinal: null,
        content: [{ type: 'text', text: 'A list item', style: emptyStyle() }],
        target
      },
      {
        type: 'table',
        headerRows: 1,
        columnWidths: [100],
        rows: [
          [
            {
              content: [{ type: 'text', text: 'Header', style: emptyStyle() }],
              colspan: 1,
              rowspan: 1
            }
          ]
        ],
        target
      },
      { type: 'math', source: '\\frac{x^2}{y}', target },
      { type: 'math', source: '\\begin{aligned}x^2+y^2\\end{aligned}', target },
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
        figureId: 'figure:publication',
        figureNumber: 1,
        label: 'Figure 1',
        target,
        assetId,
        caption: 'A deterministic pixel',
        altText: 'Alternative figure',
        width: 640,
        height: 360
      },
      {
        type: 'references',
        entries: [{ number: 1, title: 'Research Source', count: 1 }]
      }
    ],
    assets: [
      {
        assetId,
        logicalUrl: `writellm-asset:${assetId}`,
        mimeType: 'image/png',
        byteSize: imageBytes.byteLength,
        width: 1,
        height: 1,
        availability: 'available'
      }
    ],
    referenceCount: 1,
    figureCount: 1,
    sourceHash: 'a'.repeat(64),
    findings: [],
    ready: true
  }
}

function emptyStyle(): {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
} {
  return { bold: false, italic: false, underline: false, strike: false, code: false }
}
