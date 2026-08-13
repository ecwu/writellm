import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseLatexImport } from './latex-import-parser'

const requestId = '00000000-0000-4000-8000-000000000037'

describe('isolated LaTeX import parser adapter', () => {
  it('maps multilingual structure and preserves unsupported source without execution', () => {
    const source = String.raw`\documentclass{article}
\usepackage{unknownpkg}
\title{多语言 café study}
\newcommand{\danger}[1]{#1}
\begin{document}
% retained comment
\section{引言}
Hello \textbf{bold} and \emph{强调} with $x^2$ and \cite{missing-key}.

\begin{itemize}
\item First
\item 第二
\end{itemize}

\begin{quote}Quoted text.\end{quote}
\begin{equation}E = mc^2\end{equation}
\footnote{A visible note}
\danger{inert custom macro}
\begin{verbatim}
raw % text
\end{verbatim}
\subsection{Details}
Editable body.
\end{document}`
    const result = parseLatexImport({
      type: 'latex-import-parse',
      requestId,
      sourceHash: hash(source),
      source
    })

    expect(result.proposedTitle).toBe('多语言 café study')
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]).toMatchObject({ title: '引言', outlineLevel: 1 })
    expect(result.sections[0]?.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(['paragraph', 'list', 'quote', 'math', 'code', 'heading'])
    )
    expect(JSON.stringify(result.sections)).toContain('First')
    expect(JSON.stringify(result.sections)).toContain('第二')
    expect(result.losses.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'comment_preserved_inert',
        'inline_math_text_fallback',
        'footnote_text_fallback'
      ])
    )
    expect(result.unsupported.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['citation_unresolved', 'latex_construct_preserved_inert'])
    )
    expect(JSON.stringify(result)).toContain('missing-key')
    expect(JSON.stringify(result)).toContain('danger')
  })

  it('normalizes part/chapter/section hierarchy and is deterministic', () => {
    const source = String.raw`\begin{document}
\chapter{One}Chapter body.
\section{Child}Child body.
\chapter{Two}Second body.
\end{document}`
    const input = {
      type: 'latex-import-parse' as const,
      requestId,
      sourceHash: hash(source),
      source
    }
    const first = parseLatexImport(input)
    const second = parseLatexImport(input)
    expect(first).toEqual(second)
    expect(first.sections.map(({ title, outlineLevel }) => [title, outlineLevel])).toEqual([
      ['One', 1],
      ['Child', 2],
      ['Two', 1]
    ])
  })

  it('resolves contained includes, bibliography, tables, figures, labels, and cycles', () => {
    const source = String.raw`\title{Project import}
\begin{document}
\input{chapters/intro}
\input{chapters/cycle}
\end{document}`
    const input = {
      type: 'latex-import-parse' as const,
      requestId,
      sourceHash: hash(source),
      source,
      project: {
        entryRelativePath: 'main.tex',
        textFiles: [
          { relativePath: 'main.tex', kind: 'tex' as const, source },
          {
            relativePath: 'chapters/intro.tex',
            kind: 'tex' as const,
            source: String.raw`\section{Evidence}
See \cite{zhang2024} and Figure \ref{fig:plot}.
\begin{table}
\caption{Results}
\begin{tabular}{lc}
Name & Value \\
Alpha & 2
\end{tabular}
\end{table}
\begin{figure}
\includegraphics{../images/plot.png}
\caption{Observed result}
\label{fig:plot}
\end{figure}`
          },
          {
            relativePath: 'chapters/cycle.tex',
            kind: 'tex' as const,
            source: String.raw`\input{../main}`
          },
          {
            relativePath: 'references.bib',
            kind: 'bib' as const,
            source:
              '@article{zhang2024,title={Study},author={Zhang, Wei and Müller, Ana},year={2024}}'
          }
        ],
        assetPaths: ['images/plot.png']
      }
    }

    const first = parseLatexImport(input)
    expect(parseLatexImport(input)).toEqual(first)
    expect(first.proposedTitle).toBe('Project import')
    expect(first.sections).toHaveLength(1)
    expect(first.sections[0]?.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(['paragraph', 'table', 'figure', 'code'])
    )
    expect(JSON.stringify(first.sections)).toContain('(Zhang & Müller, 2024)')
    expect(JSON.stringify(first.sections)).toContain('[fig:plot]')
    expect(first.sections[0]?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'figure',
          relativePath: 'images/plot.png',
          caption: 'Observed result'
        })
      ])
    )
    expect(first.losses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'include_cycle' })])
    )
    expect(first.warnings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'include_resolved',
        'citation_style_normalized',
        'cross_reference_normalized'
      ])
    )
  })

  it('preserves malformed syntax inertly and rejects excessive AST depth', () => {
    const malformed = '\\begin{document}'
    const result = parseLatexImport({
      type: 'latex-import-parse',
      requestId,
      sourceHash: hash(malformed),
      source: malformed
    })
    expect(JSON.stringify(result.sections)).toContain('begin')
    expect(result.unsupported).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'latex_construct_preserved_inert' })])
    )

    const deeplyNested = `${'\\textbf{'.repeat(70)}x${'}'.repeat(70)}`
    expect(() =>
      parseLatexImport({
        type: 'latex-import-parse',
        requestId,
        sourceHash: hash(deeplyNested),
        source: deeplyNested
      })
    ).toThrow(/nesting/iu)
  })
})

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
