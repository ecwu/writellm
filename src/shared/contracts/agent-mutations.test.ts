import { describe, expect, it } from 'vitest'
import {
  AGENT_MUTATION_OPERATION_LIMIT,
  briefUpdateSchema,
  generateImageArgsSchema,
  modelSubmitSectionChangeArgsSchema,
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
