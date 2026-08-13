import { parse } from '@unified-latex/unified-latex-util-parse'
import { describe, expect, it } from 'vitest'
import type { PublicationAssembly } from '../../shared/contracts/publication'
import { escapeLatex, renderLatexPublication } from './latex-publication'

const sectionId = '019d0000-0000-7000-8000-000000000701'
const revisionId = '019d0000-0000-7000-8000-000000000702'
const assetId = '019d0000-0000-7000-8000-000000000703'
const target = { sectionId, revisionId, blockId: 'block' }

describe('LaTeX publication renderer', () => {
  it('emits deterministic, independently parseable XeLaTeX with bounded fallbacks', () => {
    const assembly = fixtureAssembly()
    const first = renderLatexPublication({
      assembly,
      assetRelativePath: () => 'assets/abc.png'
    })
    const second = renderLatexPublication({
      assembly,
      assetRelativePath: () => 'assets/abc.png'
    })

    expect(second).toEqual(first)
    expect(first.tex).toContain('\\documentclass[UTF8,a4paper]{ctexart}')
    expect(first.tex).toContain('中文与 Latin')
    expect(first.tex).toContain('\\textbackslash{}end\\{document\\}')
    expect(first.tex).toContain('\\href{https://example.com/a\\#b}')
    expect(first.tex).toContain('\\includegraphics')
    expect(first.tex).toContain('\\frac{x}{y}')
    expect(first.tex).not.toContain('\\input{/private/secret}')
    expect(first.tex).toContain('＼end{lstlisting}')
    expect(first.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'bibliography_metadata_unavailable' }),
        expect.objectContaining({ code: 'latex_table_span_fallback' }),
        expect.objectContaining({ code: 'latex_verbatim_sanitized' }),
        expect.objectContaining({ code: 'math_text_fallback' }),
        expect.objectContaining({ code: 'mermaid_source_fallback' })
      ])
    )

    const ast = parse(first.tex)
    expect(ast.type).toBe('root')
    const parsed = JSON.stringify(ast)
    expect(parsed).toContain('documentclass')
    expect(parsed).toContain('longtable')
    expect(parsed).toContain('figure')
    expect(parsed).toContain('References')
  })

  it('escapes every TeX text metacharacter without making manuscript text executable', () => {
    expect(escapeLatex('\\{}#$%&_ ^~')).toBe(
      '\\textbackslash{}\\{\\}\\#\\$\\%\\&\\_ \\textasciicircum{}\\textasciitilde{}'
    )
  })
})

function fixtureAssembly(): PublicationAssembly {
  return {
    schemaVersion: 1,
    manuscriptId: 'manuscript',
    outlineVersion: 1,
    title: 'Title # { \\end{document}',
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
        content: [{ type: 'text', text: '中文与 Latin', style: style() }],
        target: { ...target, blockId: null }
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Reserved # $ % & _ ', style: { ...style(), bold: true } },
          { type: 'citation', number: 1, title: 'Source', raw: '[Source]' },
          {
            type: 'link',
            href: 'https://example.com/a#b',
            children: [{ type: 'text', text: 'Link', style: style() }]
          }
        ],
        target
      },
      {
        type: 'code',
        language: 'typescript',
        content: 'const value = 1;\n\\end{lstlisting}',
        target
      },
      {
        type: 'table',
        headerRows: 1,
        columnWidths: [100],
        rows: [
          [
            {
              content: [{ type: 'text', text: 'Cell', style: style() }],
              colspan: 1,
              rowspan: 2
            }
          ]
        ],
        target
      },
      { type: 'math', source: '\\frac{x}{y}', caption: '', target },
      { type: 'math', source: '\\input{/private/secret}', caption: '', target },
      { type: 'mermaid', source: 'graph TD; A-->B', caption: 'Flow', target },
      {
        type: 'figure',
        figureId: 'figure:latex',
        figureNumber: 1,
        label: 'Figure 1',
        target,
        assetId,
        caption: 'Caption #1',
        altText: 'Alternative',
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
    sourceHash: 'b'.repeat(64),
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
