import { describe, expect, it } from 'vitest'
import {
  AGENT_MUTATION_OPERATION_LIMIT,
  briefUpdateSchema,
  generateImageArgsSchema,
  modelSubmitSectionChangeArgsSchema,
  mutationPreviewSchema,
  outlinePatchSchema,
  rejectMutationProposalInputSchema,
  sectionPatchSchema
} from './agent-mutations'

const manuscriptId = '019c6a5c-8d34-7a8e-a602-3d37a52dc611'
const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc612'
const revisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc613'

describe('Agent mutation contracts', () => {
  it('keeps ordinary rejection compatible while allowing an explicit continuation request', () => {
    const base = {
      projectSessionId: manuscriptId,
      agentSessionId: revisionId,
      proposalId: sectionId,
      reason: 'Try a quieter opening.'
    }
    expect(rejectMutationProposalInputSchema.parse(base).continueRequested).toBe(false)
    expect(
      rejectMutationProposalInputSchema.parse({ ...base, continueRequested: true })
        .continueRequested
    ).toBe(true)
  })

  it('defaults version and citations while rejecting untyped or capability-bearing fields', () => {
    expect(
      briefUpdateSchema.parse({
        manuscriptId,
        baseBriefVersion: 1,
        changes: { title: 'Revised' }
      })
    ).toMatchObject({ schemaVersion: 1, citationIds: [] })
    expect(
      briefUpdateSchema.safeParse({
        manuscriptId,
        baseBriefVersion: 1,
        changes: { title: 'Revised' },
        projectSessionId: manuscriptId
      }).success
    ).toBe(false)
    expect(
      briefUpdateSchema.safeParse({ manuscriptId, baseBriefVersion: 1, changes: {} }).success
    ).toBe(false)
  })

  it('keeps semantic presentation optional and bounds projected field text', () => {
    const legacyPreview = {
      summary: 'Legacy preview',
      affectedSectionIds: [],
      beforeText: 'Before',
      afterText: 'After',
      beforeTextTruncated: false,
      afterTextTruncated: false,
      citedSources: []
    }
    expect(mutationPreviewSchema.parse(legacyPreview).presentation).toBeUndefined()
    expect(
      mutationPreviewSchema.safeParse({
        ...legacyPreview,
        presentation: {
          schemaVersion: 1,
          kind: 'brief_fields',
          fields: [
            {
              field: 'title',
              before: { text: null, truncated: false },
              after: { text: 'x'.repeat(4_097), truncated: false }
            }
          ]
        }
      }).success
    ).toBe(false)
  })

  it('bounds and types the frozen outline operation set', () => {
    expect(
      outlinePatchSchema.parse({
        manuscriptId,
        baseOutlineVersion: 1,
        operations: [
          {
            type: 'createSection',
            sectionId,
            parentSectionId: null,
            position: 0,
            title: 'New section',
            objective: null,
            status: 'planned'
          }
        ]
      }).operations[0]
    ).toMatchObject({ type: 'createSection', sectionId })
    expect(
      outlinePatchSchema.safeParse({
        manuscriptId,
        baseOutlineVersion: 1,
        operations: Array.from({ length: AGENT_MUTATION_OPERATION_LIMIT + 1 }, () => ({
          type: 'deleteSection',
          sectionId
        }))
      }).success
    ).toBe(false)
  })

  it('enforces typed BlockNote operations, unique IDs, and anchor placement', () => {
    expect(
      sectionPatchSchema.parse({
        sectionId,
        baseRevisionId: revisionId,
        operations: [{ type: 'removeBlocks', blockIds: ['a', 'b'] }]
      })
    ).toMatchObject({ schemaVersion: 1, citationIds: [] })
    expect(
      sectionPatchSchema.safeParse({
        sectionId,
        baseRevisionId: revisionId,
        operations: [{ type: 'removeBlocks', blockIds: ['a', 'a'] }]
      }).success
    ).toBe(false)
    expect(
      sectionPatchSchema.safeParse({
        sectionId,
        baseRevisionId: revisionId,
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'before',
            blocks: []
          }
        ]
      }).success
    ).toBe(false)
  })

  it('allows Agent canonical block replacement to preserve or create inline math', () => {
    const operation = {
      type: 'replaceCanonicalBlock' as const,
      target: { blockId: 'paragraph', expectedBlockHash: 'a'.repeat(64) },
      block: {
        id: 'paragraph',
        type: 'paragraph' as const,
        props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
        content: [
          { type: 'text' as const, text: 'Energy ', styles: {} },
          { type: 'math' as const, content: 'E = mc^2' }
        ],
        children: []
      }
    }
    expect(
      modelSubmitSectionChangeArgsSchema.parse({ sectionId, operations: [operation] }).operations[0]
    ).toMatchObject(operation)
    expect(
      modelSubmitSectionChangeArgsSchema.safeParse({
        sectionId,
        operations: [
          {
            ...operation,
            block: { ...operation.block, content: [{ type: 'math', content: 'x\ny' }] }
          }
        ]
      }).success
    ).toBe(false)
  })

  it('types native block math and application-owned diagrams as disjoint rich blocks', () => {
    expect(
      modelSubmitSectionChangeArgsSchema.parse({
        sectionId,
        operations: [
          {
            type: 'insertRichBlock',
            placement: 'end',
            block: { blockType: 'mathBlock', source: String.raw`\frac{x}{y}` }
          },
          {
            type: 'insertRichBlock',
            placement: 'end',
            block: {
              blockType: 'diagram',
              source: 'flowchart LR\nA --> B',
              caption: 'Flow',
              altText: 'A flows to B'
            }
          }
        ]
      }).operations
    ).toMatchObject([
      { type: 'insertRichBlock', anchor: null, block: { blockType: 'mathBlock' } },
      {
        type: 'insertRichBlock',
        anchor: null,
        block: { blockType: 'diagram', caption: 'Flow', altText: 'A flows to B' }
      }
    ])
    expect(
      modelSubmitSectionChangeArgsSchema.safeParse({
        sectionId,
        operations: [
          {
            type: 'insertRichBlock',
            placement: 'end',
            block: { blockType: 'mathBlock', source: 'x', caption: 'not supported' }
          }
        ]
      }).success
    ).toBe(false)
  })

  it('types bounded table insertion and sequential table edits', () => {
    const parsed = modelSubmitSectionChangeArgsSchema.parse({
      sectionId,
      operations: [
        {
          type: 'insertTable',
          placement: 'end',
          table: {
            clientRef: 'results-table',
            headerRows: 1,
            headerCols: 1,
            rows: [
              ['Metric', { content: [{ type: 'math', content: 'R^2' }], textAlignment: 'center' }],
              [
                {
                  content: [
                    {
                      type: 'link',
                      href: 'https://example.com',
                      content: [{ type: 'text', text: 'Source', styles: {} }]
                    }
                  ]
                },
                '0.9'
              ]
            ]
          }
        },
        {
          type: 'editTable',
          target: { blockId: 'table-1', expectedBlockHash: 'a'.repeat(64) },
          operations: [
            { type: 'setCell', row: 1, column: 1, cell: '' },
            { type: 'insertRows', index: 2, rows: [['F1', '0.8']] },
            { type: 'setColumnAlignment', column: 1, textAlignment: 'right' }
          ]
        }
      ]
    })
    expect(parsed.operations).toHaveLength(2)
    expect(parsed.operations[0]).toMatchObject({ type: 'insertTable', anchor: null })
    expect(
      modelSubmitSectionChangeArgsSchema.safeParse({
        sectionId,
        operations: [
          {
            type: 'insertTable',
            placement: 'end',
            table: { headerRows: 1, headerCols: 0, rows: [['javascript:[x]']] },
            unknown: true
          }
        ]
      }).success
    ).toBe(false)
  })

  it('defaults root insertion anchors and keeps image insert/iterate modes disjoint', () => {
    expect(
      modelSubmitSectionChangeArgsSchema.parse({
        sectionId,
        operations: [
          { type: 'insertTextBlocks', placement: 'end', blocks: [{ text: 'New ending.' }] }
        ]
      }).operations[0]
    ).toMatchObject({ type: 'insertTextBlocks', anchor: null, placement: 'end' })
    expect(
      modelSubmitSectionChangeArgsSchema.safeParse({
        sectionId,
        operations: [
          { type: 'insertTextBlocks', placement: 'before', blocks: [{ text: 'Invalid root.' }] }
        ]
      }).success
    ).toBe(false)

    const sourceSectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc614'
    expect(
      modelSubmitSectionChangeArgsSchema.parse({
        sectionId,
        operations: [
          {
            type: 'insertExistingImage',
            source: {
              sectionId: sourceSectionId,
              blockId: 'source-image',
              expectedBlockHash: 'b'.repeat(64)
            },
            placement: 'end'
          }
        ]
      }).operations[0]
    ).toMatchObject({ type: 'insertExistingImage', anchor: null, placement: 'end' })
    expect(
      modelSubmitSectionChangeArgsSchema.safeParse({
        sectionId,
        operations: [
          {
            type: 'insertExistingImage',
            source: {
              sectionId: sourceSectionId,
              blockId: 'source-image',
              expectedBlockHash: 'b'.repeat(64)
            },
            placement: 'before'
          }
        ]
      }).success
    ).toBe(false)
    expect(
      modelSubmitSectionChangeArgsSchema.safeParse({
        sectionId,
        operations: [
          {
            type: 'insertExistingImage',
            source: {
              sectionId: sourceSectionId,
              blockId: 'source-image',
              expectedBlockHash: 'b'.repeat(64),
              assetId: manuscriptId,
              url: 'https://example.com/forged.png'
            },
            placement: 'end',
            block: { type: 'image' }
          }
        ]
      }).success
    ).toBe(false)

    const common = {
      mode: 'insert' as const,
      sectionId,
      placement: 'start' as const,
      prompt: 'A precise architecture diagram',
      altText: 'Architecture diagram',
      caption: '',
      aspectRatio: '16:9' as const,
      imageSize: '2K' as const
    }
    expect(generateImageArgsSchema.parse(common).anchor).toBeNull()
    expect(
      generateImageArgsSchema.parse({
        mode: 'iterate',
        sectionId,
        prompt: common.prompt,
        altText: common.altText,
        caption: common.caption,
        aspectRatio: common.aspectRatio,
        imageSize: common.imageSize,
        iteration: {
          sourceBlock: { blockId: 'image-1', expectedBlockHash: 'a'.repeat(64) },
          disposition: 'replace'
        }
      })
    ).toMatchObject({ mode: 'iterate', iteration: { disposition: 'replace' } })
  })
})
