import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { MainAgentTools } from './tools'

const agentSessionId = '019d0000-0000-4000-8000-000000000101'
const agentRunId = '019d0000-0000-4000-8000-000000000102'
const modelRequestId = '019d0000-0000-4000-8000-000000000103'
const sourceSectionId = '019d0000-0000-4000-8000-000000000104'
const targetSectionId = '019d0000-0000-4000-8000-000000000105'
const sourceRevisionId = '019d0000-0000-4000-8000-000000000106'
const targetRevisionId = '019d0000-0000-4000-8000-000000000107'
const assetId = '019d0000-0000-4000-8000-000000000108'

const sourceImage: BlockNoteDocument[number] = {
  id: 'source-image',
  type: 'image',
  props: {
    backgroundColor: 'default',
    textAlignment: 'center',
    name: 'SPACE taxonomy',
    url: `writellm-asset:${assetId}`,
    caption: 'The SPACE taxonomy and reference loop.',
    figureId: 'figure:space-taxonomy',
    altText: 'SPACE taxonomy diagram',
    showPreview: true,
    previewWidth: 960
  },
  children: []
}
const targetAnchor: BlockNoteDocument[number] = paragraph('target-anchor', 'Third paragraph.')
const sourceHash = hash(sourceImage)
const targetHash = hash(targetAnchor)

describe('existing image relocation tools', () => {
  it.each([
    { anchor: null, placement: 'end' as const },
    {
      anchor: { blockId: targetAnchor.id, expectedBlockHash: targetHash },
      placement: 'after' as const
    }
  ])('copies authoritative image metadata and rebuilds the target ID', async (insertion) => {
    const { tools, propose, assertExistingImageRead } = createTools()

    await tools.execute({
      ...execution(),
      args: {
        sectionId: targetSectionId,
        operations: [
          {
            type: 'insertExistingImage',
            source: {
              sectionId: sourceSectionId,
              blockId: sourceImage.id,
              expectedBlockHash: sourceHash
            },
            ...insertion
          }
        ]
      }
    })

    expect(assertExistingImageRead).toHaveBeenCalledWith(
      agentSessionId,
      agentRunId,
      sourceSectionId,
      sourceImage.id,
      sourceHash,
      targetSectionId
    )
    const normalized = propose.mock.calls[0]?.[1] as {
      sectionId: string
      baseRevisionId: string
      operations: Array<{
        type: string
        anchorBlockId: string | null
        blocks: BlockNoteDocument
      }>
    }
    expect(normalized).toMatchObject({
      sectionId: targetSectionId,
      baseRevisionId: targetRevisionId,
      operations: [
        {
          type: 'insertBlocks',
          anchorBlockId: insertion.anchor?.blockId ?? null,
          placement: insertion.placement,
          blocks: [{ type: 'image', props: sourceImage.props, children: [] }]
        }
      ]
    })
    expect(normalized.operations[0]?.blocks[0]?.id).not.toBe(sourceImage.id)
  })

  it.each([
    {
      label: 'same section',
      operation: {
        type: 'insertExistingImage',
        source: {
          sectionId: targetSectionId,
          blockId: targetAnchor.id,
          expectedBlockHash: targetHash
        },
        anchor: null,
        placement: 'end'
      },
      code: 'invalid_arguments'
    },
    {
      label: 'non-image source',
      operation: {
        type: 'insertExistingImage',
        source: {
          sectionId: sourceSectionId,
          blockId: 'source-text',
          expectedBlockHash: hash(paragraph('source-text', 'Not an image.'))
        },
        anchor: null,
        placement: 'end'
      },
      code: 'invalid_arguments'
    },
    {
      label: 'stale source hash',
      operation: {
        type: 'insertExistingImage',
        source: {
          sectionId: sourceSectionId,
          blockId: sourceImage.id,
          expectedBlockHash: 'a'.repeat(64)
        },
        anchor: null,
        placement: 'end'
      },
      code: 'conflict'
    },
    {
      label: 'missing source block',
      operation: {
        type: 'insertExistingImage',
        source: {
          sectionId: sourceSectionId,
          blockId: 'missing-image',
          expectedBlockHash: 'a'.repeat(64)
        },
        anchor: null,
        placement: 'end'
      },
      code: 'conflict'
    },
    {
      label: 'section outside the snapshot',
      operation: {
        type: 'insertExistingImage',
        source: {
          sectionId: '019d0000-0000-4000-8000-000000000199',
          blockId: sourceImage.id,
          expectedBlockHash: sourceHash
        },
        anchor: null,
        placement: 'end'
      },
      code: 'invalid_arguments'
    },
    {
      label: 'wrong target anchor',
      operation: {
        type: 'insertExistingImage',
        source: {
          sectionId: sourceSectionId,
          blockId: sourceImage.id,
          expectedBlockHash: sourceHash
        },
        anchor: { blockId: targetAnchor.id, expectedBlockHash: 'a'.repeat(64) },
        placement: 'after'
      },
      code: 'conflict'
    }
  ])('fails closed for $label without proposing', async ({ operation, code }) => {
    const { tools, propose } = createTools()

    await expect(
      tools.execute({
        ...execution(),
        args: { sectionId: targetSectionId, operations: [operation] }
      })
    ).rejects.toMatchObject({ code })
    expect(propose).not.toHaveBeenCalled()
  })

  it('routes a block found in another section away from moveBlocks', async () => {
    const { tools, propose } = createTools()

    await expect(
      tools.execute({
        ...execution(),
        args: {
          sectionId: targetSectionId,
          operations: [
            {
              type: 'moveBlocks',
              targets: [{ blockId: sourceImage.id, expectedBlockHash: sourceHash }],
              anchor: { blockId: targetAnchor.id, expectedBlockHash: targetHash },
              placement: 'after'
            }
          ]
        }
      })
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: expect.stringContaining('insertExistingImage')
    })
    expect(propose).not.toHaveBeenCalled()
  })

  it('rejects a nested image subtree', async () => {
    const { tools, propose } = createTools()
    const input = execution()
    const parent = paragraph('source-parent', 'Parent block.')
    parent.children = [sourceImage]
    const nestedSnapshot = input.snapshot as unknown as {
      sectionContents: Map<string, BlockNoteDocument>
    }
    nestedSnapshot.sectionContents = new Map([
      [sourceRevisionId, [parent]],
      [targetRevisionId, [targetAnchor]]
    ])

    await expect(
      tools.execute({
        ...input,
        args: {
          sectionId: targetSectionId,
          operations: [
            {
              type: 'insertExistingImage',
              source: {
                sectionId: sourceSectionId,
                blockId: sourceImage.id,
                expectedBlockHash: sourceHash
              },
              placement: 'end'
            }
          ]
        }
      })
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: expect.stringContaining('root-level')
    })
    expect(propose).not.toHaveBeenCalled()
  })
})

function createTools() {
  const propose = vi.fn((_name: unknown, _args: unknown, _context: unknown) => ({
    proposalId: 'proposal'
  }))
  const assertExistingImageRead = vi.fn()
  const tools = new MainAgentTools(
    { contextBuilder: vi.fn() } as never,
    {
      propose,
      assertCanonicalBlockRead: vi.fn(),
      assertExistingImageRead,
      list: vi.fn(() => [])
    } as never
  )
  return { tools, propose, assertExistingImageRead }
}

function execution() {
  return {
    toolName: 'submit_section_change' as const,
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
    agentSessionId,
    agentRunId,
    toolCallId: 'tool-call',
    toolCallEventId: 'tool-call-event',
    modelRequestId,
    snapshot: {
      snapshotId: modelRequestId,
      observedAt: '2026-08-18T00:00:00.000Z',
      workspace: {
        manuscriptId: 'manuscript',
        outlineVersion: 1,
        brief: { version: 1 },
        sections: [
          {
            section: { sectionId: sourceSectionId, currentRevisionId: sourceRevisionId },
            revision: { sectionRevisionId: sourceRevisionId }
          },
          {
            section: { sectionId: targetSectionId, currentRevisionId: targetRevisionId },
            revision: { sectionRevisionId: targetRevisionId }
          }
        ]
      },
      sectionContents: new Map([
        [sourceRevisionId, [sourceImage, paragraph('source-text', 'Not an image.')]],
        [targetRevisionId, [targetAnchor]]
      ]),
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    } as never,
    signal: new AbortController().signal
  }
}

function paragraph(id: string, text: string): BlockNoteDocument[number] {
  return {
    id,
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text, styles: {} }],
    children: []
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
