import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { manuscriptAssemblySchema } from '../../../../shared/contracts/manuscript'
import { manuscriptToMarkdown } from '../../../../shared/manuscript-markdown'
import { ThemeProvider } from '@/theme-provider'
import {
  ManuscriptMarkdown,
  ManuscriptPreviewWorkspace,
  safePreviewMarkdownUrl
} from './manuscript-preview'

const projectAsset = 'writellm-asset:019c6a5c-8d34-4a8e-a602-3d37a52dc901'

describe('Markdown preview rendering', () => {
  it('renders readable GFM, code, math, and Mermaid without horizontal page primitives', () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <ManuscriptMarkdown
          projectSessionId='session-1'
          markdown={`# Heading

Paragraph with **bold text** and $E = mc^2$.

- List item

> Quoted text

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`ts
const value = 1
\`\`\`

\`\`\`mermaid
graph TD
A-->B
\`\`\``}
        />
      </ThemeProvider>
    )

    expect(html).toContain('class="typeset typeset-manuscript')
    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('class="typeset-scroll"')
    expect(html).toContain('language-ts')
    expect(html).toContain('class="katex"')
    expect(html).toContain('Rendering diagram')
    expect(html).not.toContain('language-mermaid')
  })

  it('shows projection losses and excludes Brief metadata and objectives', () => {
    const assembly = manuscriptAssemblySchema.parse({
      manuscriptId: 'manuscript-1',
      outlineVersion: 1,
      brief: {
        manuscriptBriefId: 'brief-1',
        manuscriptId: 'manuscript-1',
        version: 1,
        schemaVersion: 1,
        title: 'Private brief title',
        description: 'Private brief description',
        topic: '',
        targetAudience: '',
        language: 'en',
        styleTone: '',
        scopeExclusions: '',
        targetLength: '',
        citationRequirements: '',
        additionalInstructions: '',
        extensible: {},
        createdAt: '2026-08-19T12:00:00.000Z'
      },
      sections: [
        {
          section: {
            sectionId: 'section-1',
            manuscriptId: 'manuscript-1',
            parentSectionId: null,
            position: 0,
            level: 1,
            title: 'Visible section',
            objective: 'Private objective',
            status: 'drafting',
            currentRevisionId: 'revision-1',
            createdAt: '2026-08-19T12:00:00.000Z',
            updatedAt: '2026-08-19T12:00:00.000Z'
          },
          revision: {
            sectionRevisionId: 'revision-1',
            sectionId: 'section-1',
            revisionNumber: 1,
            source: 'manual',
            sourceClass: 'manual_checkpoint',
            content: [
              {
                id: 'paragraph-1',
                type: 'paragraph',
                props: {
                  backgroundColor: 'yellow',
                  textColor: 'default',
                  textAlignment: 'left'
                },
                content: [{ type: 'text', text: 'Visible body', styles: {} }],
                children: []
              }
            ],
            contentSchemaVersion: 4,
            contentHash: 'a'.repeat(64),
            priorRevisionId: null,
            wordCount: 2,
            characterCount: 12,
            countAlgorithmVersion: 2,
            agentRunId: null,
            agentToolCallId: null,
            agentProposalId: null,
            createdAt: '2026-08-19T12:00:00.000Z'
          }
        }
      ],
      wordCount: 2,
      characterCount: 12
    })
    const noop = (): void => undefined
    const html = renderToStaticMarkup(
      <ManuscriptPreviewWorkspace
        projectSessionId='session-1'
        projectName='Preview fixture'
        assembly={assembly}
        loading={false}
        error={false}
        onRetry={noop}
        onOpenManuscript={noop}
        onOpenKnowledge={noop}
        onOpenChecks={noop}
        onOpenAssets={noop}
        onOpenReferences={noop}
        onOpenIssues={noop}
        onOpenWritingRules={noop}
        onOpenFind={noop}
        onOpenSettings={noop}
      />
    )

    expect(html).toContain('data-testid="preview-loss-report"')
    expect(html).toContain('1 detail is not preserved')
    expect(html).toContain('<h1>Visible section</h1>')
    expect(html).toContain('Visible body')
    expect(html).not.toContain('Private brief title')
    expect(html).not.toContain('Private brief description')
    expect(html).not.toContain('Private objective')
    expect(manuscriptToMarkdown(assembly, (url) => url).markdown).not.toContain('References')
  })

  it('allows only safe HTTPS links and session-bound project assets', () => {
    expect(safePreviewMarkdownUrl('https://example.com/path', 'href')).toBe(
      'https://example.com/path'
    )
    expect(safePreviewMarkdownUrl('http://example.com/path', 'href')).toBe('')
    expect(safePreviewMarkdownUrl('https://localhost/path', 'href')).toBe('')
    expect(safePreviewMarkdownUrl(projectAsset, 'src')).toBe(projectAsset)
    expect(safePreviewMarkdownUrl('https://example.com/image.png', 'src')).toBe('')
    expect(safePreviewMarkdownUrl('data:image/svg+xml,unsafe', 'src')).toBe('')
    expect(safePreviewMarkdownUrl('writellm-asset:not-a-uuid', 'src')).toBe('')
  })
})
