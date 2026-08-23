import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ManuscriptAssembly } from './manuscript'
import {
  buildPublicationAssembly,
  derivePublicationFigures,
  publicationPreview
} from './publication'

describe('publication figure nodes', () => {
  it('derives order-dependent numbers while retaining stable figure identities', () => {
    const manuscript = {
      manuscriptId: 'manuscript',
      outlineVersion: 1,
      brief: {
        manuscriptBriefId: 'brief',
        manuscriptId: 'manuscript',
        version: 1,
        title: 'Publication fixture',
        description: null,
        topic: null,
        targetAudience: null,
        language: 'en',
        styleTone: null,
        scopeExclusions: null,
        targetLength: null,
        citationRequirements: null,
        additionalInstructions: null,
        extensible: {},
        createdAt: '2026-08-13T00:00:00.000Z',
        updatedAt: '2026-08-13T00:00:00.000Z'
      },
      sections: [
        entry('019d0000-0000-7000-8000-000000000401', 'First', [
          image('block-a', 'figure:a', '019d0000-0000-7000-8000-000000000411'),
          {
            id: 'parent',
            type: 'paragraph',
            props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
            content: [],
            children: [image('block-b', 'figure:b', '019d0000-0000-7000-8000-000000000412')]
          }
        ]),
        entry('019d0000-0000-7000-8000-000000000402', 'Second', [
          image('block-c', 'figure:c', '019d0000-0000-7000-8000-000000000413')
        ])
      ],
      wordCount: 0,
      characterCount: 0
    } as ManuscriptAssembly

    const original = derivePublicationFigures(manuscript)
    expect(original.map(({ figureId, label }) => [figureId, label])).toEqual([
      ['figure:a', 'Figure 1'],
      ['figure:b', 'Figure 2'],
      ['figure:c', 'Figure 3']
    ])

    manuscript.sections.reverse()
    const reordered = derivePublicationFigures(manuscript)
    expect(reordered.map(({ figureId, label }) => [figureId, label])).toEqual([
      ['figure:c', 'Figure 1'],
      ['figure:a', 'Figure 2'],
      ['figure:b', 'Figure 3']
    ])
  })

  it('builds one deterministic typed assembly and blocks missing assets and sources', () => {
    const sectionId = '019d0000-0000-7000-8000-000000000421'
    const revisionId = '019d0000-0000-7000-8000-000000000521'
    const assetId = '019d0000-0000-7000-8000-000000000431'
    const manuscript = publicationManuscript(sectionId, revisionId, assetId)
    const input = {
      manuscript,
      references: {
        outlineVersion: 1,
        entries: [
          {
            number: 1,
            title: 'Research Source',
            count: 1,
            occurrences: [
              {
                sectionId,
                sectionRevisionId: revisionId,
                blockId: 'paragraph',
                ordinal: 0,
                raw: '[Source: Research Source, p. 2]',
                syntax: 'english' as const,
                title: 'Research Source',
                pageIndex: 1
              }
            ]
          }
        ]
      },
      assets: [
        {
          assetId,
          logicalUrl: `writellm-asset:${assetId}`,
          mimeType: 'image/png' as const,
          byteSize: 24,
          width: 640,
          height: 360,
          availability: 'missing' as const
        }
      ],
      availableReferenceTitles: new Set<string>(),
      hash: (value: string) => createHash('sha256').update(value).digest('hex')
    }
    const first = buildPublicationAssembly(input)
    const second = buildPublicationAssembly(input)

    expect(second).toEqual(first)
    expect(first.nodes.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'table',
      'math',
      'diagram',
      'figure',
      'references'
    ])
    expect(
      first.nodes[1]?.type === 'paragraph'
        ? first.nodes[1].content.find((node) => node.type === 'citation')
        : null
    ).toMatchObject({ type: 'citation', number: 1, title: 'Research Source', pageIndex: 1 })
    expect(
      first.nodes[1]?.type === 'paragraph'
        ? first.nodes[1].content.find((node) => node.type === 'math')
        : null
    ).toEqual({ type: 'math', source: 'E = mc^2' })
    expect(first.ready).toBe(false)
    expect(first.findings.map((finding) => finding.code)).toEqual([
      'unresolved_citation',
      'mermaid_requires_rendering',
      'missing_asset'
    ])
    expect(publicationPreview(first)).toMatchObject({
      sourceHash: first.sourceHash,
      options: first.options,
      errorCount: 2,
      warningCount: 1,
      ready: false
    })
  })
})

function publicationManuscript(
  sectionId: string,
  revisionId: string,
  assetId: string
): ManuscriptAssembly {
  const content = [
    {
      id: 'paragraph',
      type: 'paragraph',
      props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
      content: [
        {
          type: 'text',
          text: 'Evidence [Source: Research Source, p. 2].',
          styles: { italic: true }
        },
        { type: 'math', content: 'E = mc^2' }
      ],
      children: []
    },
    {
      id: 'table',
      type: 'table',
      props: { textColor: 'default' },
      content: {
        type: 'tableContent',
        columnWidths: [100],
        headerRows: 1,
        rows: [{ cells: [[{ type: 'text', text: 'Header', styles: {} }]] }]
      },
      children: []
    },
    {
      id: 'math',
      type: 'mathBlock',
      props: {},
      content: [{ type: 'text', text: 'x^2', styles: {} }],
      children: []
    },
    {
      id: 'mermaid',
      type: 'diagram',
      props: { engine: 'mermaid', caption: 'Flow', altText: 'A flows to B' },
      content: [{ type: 'text', text: 'graph TD; A-->B', styles: {} }],
      children: []
    },
    image('figure', 'figure:publication', assetId)
  ]
  return {
    manuscriptId: 'manuscript',
    outlineVersion: 1,
    brief: {
      manuscriptBriefId: 'brief',
      manuscriptId: 'manuscript',
      version: 1,
      title: 'Publication fixture',
      description: null,
      topic: null,
      targetAudience: null,
      language: 'en',
      styleTone: null,
      scopeExclusions: null,
      targetLength: null,
      citationRequirements: null,
      additionalInstructions: null,
      extensible: {},
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z'
    },
    sections: [entry(sectionId, 'Publication section', content, revisionId) as never],
    wordCount: 1,
    characterCount: 8
  }
}

function entry(
  sectionId: string,
  title: string,
  content: unknown[],
  exactRevisionId?: string
): unknown {
  const revisionId = exactRevisionId ?? sectionId.replace('0000000004', '0000000005')
  return {
    section: {
      sectionId,
      manuscriptId: 'manuscript',
      parentSectionId: null,
      position: 0,
      level: 1,
      title,
      objective: null,
      status: 'drafting',
      currentRevisionId: revisionId,
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z'
    },
    revision: {
      sectionRevisionId: revisionId,
      sectionId,
      revisionNumber: 1,
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      content,
      contentSchemaVersion: 5,
      contentHash: 'a'.repeat(64),
      priorRevisionId: null,
      wordCount: 0,
      characterCount: 0,
      countAlgorithmVersion: 2,
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null,
      createdAt: '2026-08-13T00:00:00.000Z'
    }
  }
}

function image(blockId: string, figureId: string, assetId: string): unknown {
  return {
    id: blockId,
    type: 'image',
    props: {
      backgroundColor: 'default',
      textAlignment: 'center',
      name: '',
      url: `writellm-asset:${assetId}`,
      caption: `Caption ${blockId}`,
      figureId,
      altText: `Alternative ${blockId}`,
      showPreview: true,
      previewWidth: 720
    },
    children: []
  }
}
