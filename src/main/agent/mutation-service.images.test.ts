import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { ManuscriptAssetService } from '../manuscript/asset-service'
import { MutationProposalService } from './mutation-service'
import { AgentContextBuilder } from './context'
import { MainAgentTools } from './tools'
import {
  log,
  projectSessionId,
  agentSessionId,
  agentRunId,
  fixture,
  imageRelocationFixture,
  submitExistingImage,
  currentContent,
  isImage,
  imageModelRequestId,
  seedImageModelRequest,
  png,
  paragraph
} from './mutation-service.test-support'

async function generatedImageFixture(
  flushForMutation: (affectedSectionIds: readonly string[]) => Promise<void> = async () => undefined
) {
  const value = await fixture()
  const opened = value.persistence.openEditor().activeSection
  if (opened === null) throw new Error('Missing section')
  const generatedModelRequestId = '019c6a5c-8d34-4a8e-a602-3d37a52dc797'
  const assets = new ManuscriptAssetService({
    projectRoot: value.projectRoot,
    projectId: value.manifest.projectId,
    database: value.database,
    log
  })
  const publishChanged = vi.fn()
  const service = new MutationProposalService({
    projectId: value.manifest.projectId,
    projectSessionId,
    database: value.database,
    manuscript: value.manuscript,
    editorPersistence: value.persistence,
    manuscriptAssets: assets,
    modelExecution: {
      generateImage: vi.fn(async () => {
        seedImageModelRequest(value.database, generatedModelRequestId)
        return {
          dataBase64: png(80, 45).toString('base64'),
          mimeType: 'image/png',
          effectiveImageSize: '1K',
          modelRequestId: generatedModelRequestId,
          metadata: {
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              estimatedCostUsdMicros: null
            },
            responseIds: ['generated-response'],
            retryCount: 0,
            providerModelId: 'gemini-3.1-flash-image'
          }
        }
      })
    } as never,
    flushForMutation,
    publishChanged,
    log
  })
  const snapshot = new AgentContextBuilder(value.manuscript).capture('image-publication-snapshot', {
    activeSectionId: opened.section.sectionId,
    selectedBlockIds: [],
    activeBlockId: null
  })
  const propose = (altText: string) =>
    service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'A compact evidence flow diagram',
        altText,
        caption: 'Evidence flow.',
        aspectRatio: '16:9',
        imageSize: '1K',
        iteration: undefined
      },
      snapshot,
      value.toolCall('generate_image')
    )
  return { value, service, publishChanged, propose }
}

describe('MutationProposalService: images', () => {
  it('keeps the full alt text while bounding the derived image name', async () => {
    const { value, service, propose } = await generatedImageFixture()
    const altText = 'A'.repeat(501)
    const proposed = propose(altText)

    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })

    expect(applied.outcome).toBe('applied')
    const revision = value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '')
    expect(revision.content.at(-1)).toMatchObject({
      type: 'image',
      props: { name: 'A'.repeat(500), altText }
    })
    value.database.close()
  })

  it('terminalizes a generated image when manuscript publication fails', async () => {
    const { value, service, publishChanged, propose } = await generatedImageFixture(async () => {
      throw new Error('Editor flush failed')
    })
    const proposed = propose('Evidence flow diagram')

    await expect(
      service.approve({ projectSessionId, agentSessionId, proposalId: proposed.proposalId })
    ).rejects.toMatchObject({ code: 'stale_base' })
    expect(service.list(agentSessionId)[0]).toMatchObject({
      proposalId: proposed.proposalId,
      status: 'failed',
      rejectedReason: 'The image was generated, but it could not be inserted safely',
      decisionAt: expect.any(String)
    })
    expect(publishChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ proposalId: proposed.proposalId, status: 'failed' })
    )
    value.database.close()
  })

  it('recovers request-scoped image generations interrupted before service recreation', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const snapshot = new AgentContextBuilder(value.manuscript).capture(
      'interrupted-generation-snapshot',
      {
        activeSectionId: opened.section.sectionId,
        selectedBlockIds: [],
        activeBlockId: null
      }
    )
    const proposed = value.service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'An interrupted image request',
        altText: 'Interrupted request',
        caption: 'Interrupted request.',
        aspectRatio: 'auto',
        imageSize: '1K',
        iteration: undefined
      },
      snapshot,
      value.toolCall('generate_image')
    )
    value.database.immediate((database) =>
      database
        .prepare(
          `UPDATE mutation_proposals
              SET status = 'generating', decision_at = ?, updated_at = ?
            WHERE mutation_proposal_id = ?`
        )
        .run('2026-08-25T16:31:09.560Z', '2026-08-25T16:31:32.769Z', proposed.proposalId)
    )

    const restarted = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      now: () => new Date('2026-08-30T12:00:00.000Z'),
      log
    })

    expect(restarted.list(agentSessionId)[0]).toMatchObject({
      proposalId: proposed.proposalId,
      status: 'failed',
      rejectedReason: 'Image generation was interrupted before it could be completed',
      decisionAt: '2026-08-25T16:31:09.560Z'
    })
    value.database.close()
  })

  it('generates an immutable image candidate and replaces only the figure URL through a normal proposal', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    seedImageModelRequest(value.database)
    const assets = new ManuscriptAssetService({
      projectRoot: value.projectRoot,
      projectId: value.manifest.projectId,
      database: value.database,
      log
    })
    const parent = await assets.store({
      bytes: png(64, 36),
      mimeType: 'image/png',
      sourceType: 'generated',
      generationRequest: {
        prompt: 'A blue systems diagram with three labeled layers',
        aspectRatio: '16:9',
        requestedImageSize: '1K',
        effectiveImageSize: '1K'
      },
      modelRequestId: imageModelRequestId,
      agentRunId,
      agentToolCallId: 'original-image-call'
    })
    const imageBlock: BlockNoteDocument[number] = {
      id: 'stable-figure-block',
      type: 'image',
      props: {
        backgroundColor: 'default',
        textAlignment: 'center',
        name: 'Original systems diagram',
        url: parent.logicalUrl,
        caption: 'Architecture overview',
        figureId: 'figure:stable-architecture',
        altText: 'Three-layer systems architecture',
        showPreview: true,
        previewWidth: 680
      },
      children: []
    }
    const saved = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('context', 'The manuscript discusses a modular system.'), imageBlock]
    })
    const candidateModelRequestId = '019c6a5c-8d34-4a8e-a602-3d37a52dc798'
    const generateImage = vi.fn(async (_database, input: { prompt: string }) => {
      seedImageModelRequest(value.database, candidateModelRequestId)
      expect(input.prompt).toContain('A blue systems diagram with three labeled layers')
      expect(input.prompt).toContain('Use warmer colors and simplify the labels')
      expect(input.prompt).toContain('The manuscript discusses a modular system.')
      return {
        dataBase64: png(80, 45).toString('base64'),
        mimeType: 'image/png',
        effectiveImageSize: '1K',
        modelRequestId: candidateModelRequestId,
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimatedCostUsdMicros: null
          },
          responseIds: ['candidate-response'],
          retryCount: 0,
          providerModelId: 'gemini-3.1-flash-image'
        }
      }
    })
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      manuscriptAssets: assets,
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const snapshot = new AgentContextBuilder(value.manuscript).capture('iteration-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: ['stable-figure-block'],
      activeBlockId: 'stable-figure-block'
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'Use warmer colors and simplify the labels',
        altText: 'Ignored replacement alt text',
        caption: 'Ignored replacement caption',
        aspectRatio: '16:9',
        imageSize: '1K',
        iteration: {
          sourceBlock: {
            blockId: 'stable-figure-block',
            expectedBlockHash: createHash('sha256').update(JSON.stringify(imageBlock)).digest('hex')
          },
          disposition: 'replace'
        }
      },
      snapshot,
      value.toolCall('generate_image')
    )

    const candidateReady = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(candidateReady).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { kind: 'generated_image_insert', status: 'superseded' },
      proposal: { kind: 'section_patch', status: 'pending' }
    })
    if (
      candidateReady.outcome !== 'refresh_required' ||
      candidateReady.proposal.payload.kind !== 'section_patch'
    ) {
      throw new Error('Expected a reviewable candidate section proposal')
    }
    expect(candidateReady.proposal.payload.mutation.operations).toEqual([
      {
        type: 'updateBlock',
        blockId: 'stable-figure-block',
        update: { props: { url: expect.stringMatching(/^writellm-asset:/) } }
      }
    ])
    const lineage = value.database.immediate(
      (database) =>
        database.prepare('SELECT * FROM manuscript_asset_variants').get() as {
          parent_asset_id: string
          candidate_asset_id: string
          candidate_model_request_id: string
          generation_proposal_id: string
          section_proposal_id: string
        }
    )
    expect(lineage).toMatchObject({
      parent_asset_id: parent.assetId,
      candidate_model_request_id: candidateModelRequestId,
      generation_proposal_id: proposed.proposalId,
      section_proposal_id: candidateReady.proposal.proposalId
    })
    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: candidateReady.proposal.proposalId
    })
    expect(applied.outcome).toBe('applied')
    const replaced = value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '')
    expect(replaced.content[1]).toMatchObject({
      id: 'stable-figure-block',
      type: 'image',
      props: {
        url: `writellm-asset:${lineage.candidate_asset_id}`,
        caption: 'Architecture overview',
        figureId: 'figure:stable-architecture',
        altText: 'Three-layer systems architecture',
        previewWidth: 680
      }
    })
    const undone = await service.undo({
      projectSessionId,
      agentSessionId,
      proposalId: candidateReady.proposal.proposalId
    })
    expect(value.manuscript.getRevision(undone.proposal.undoRevisionId ?? '').content[1]).toEqual(
      imageBlock
    )
    const workspace = await assets.listWorkspace({
      projectSessionId,
      usage: 'all',
      source: 'generated',
      limit: 40
    })
    expect(
      workspace.items.find((item) => item.assetId === parent.assetId)?.candidates[0]
    ).toMatchObject({
      assetId: lineage.candidate_asset_id,
      modelRequestId: candidateModelRequestId,
      agentRunId,
      agentToolCallId: expect.stringMatching(/^tool-call-/)
    })
    expect(
      workspace.items.every((item) => item.protectionReasons.includes('candidate_lineage'))
    ).toBe(true)
    expect(saved.revision.sectionRevisionId).toBeTruthy()
    value.database.close()
  })

  it('presents Writing Rules as a concise typed proposal and applies them through Brief versioning', async () => {
    const value = await fixture()
    const workspace = value.manuscript.assemble()
    const ruleId = '019c6a5c-8d34-7a8e-a602-3d37a52dc750'
    const proposed = value.service.propose(
      'submit_writing_rules_change',
      {
        schemaVersion: 1,
        manuscriptId: workspace.manuscriptId,
        baseBriefVersion: workspace.brief.version,
        changes: {
          extensible: {
            ...workspace.brief.extensible,
            writingRulesV1: {
              schemaVersion: 1,
              rules: [
                {
                  ruleId,
                  category: 'translation',
                  instruction: 'Translate LLM consistently.',
                  preferredForm: '大型语言模型',
                  discouragedForms: ['大语言模型'],
                  rationale: null,
                  active: true
                }
              ]
            }
          }
        },
        citationIds: []
      },
      value.toolCall('submit_writing_rules_change')
    )

    expect(proposed.preview).toMatchObject({
      summary: 'Update project Writing Rules',
      beforeText: 'No Writing Rules'
    })
    expect(proposed.preview.afterText).toContain('Active · translation')
    expect(proposed.preview.afterText).toContain('Translate LLM consistently.')
    expect(proposed.preview.afterText).not.toContain('targetAudience')
    expect(proposed.preview.presentation).toMatchObject({
      schemaVersion: 1,
      kind: 'writing_rules',
      changes: [
        {
          action: 'add',
          ruleId,
          before: null,
          after: { instruction: 'Translate LLM consistently.', active: true }
        }
      ]
    })

    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(applied.outcome).toBe('applied')
    expect(value.manuscript.assemble().brief).toMatchObject({
      version: workspace.brief.version + 1,
      extensible: {
        writingRulesV1: {
          schemaVersion: 1,
          rules: [expect.objectContaining({ ruleId, active: true })]
        }
      }
    })
    value.database.close()
  })

  it('relocates the SPACE image by applying a target copy before removing the source without generation', async () => {
    const value = await imageRelocationFixture()
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const insertion = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: value.targetSection.sectionId,
        operations: [
          {
            type: 'insertExistingImage',
            source: {
              sectionId: value.sourceSection.sectionId,
              blockId: value.imageBlock.id,
              expectedBlockHash: value.imageHash
            },
            anchor: { blockId: value.targetAnchor.id, expectedBlockHash: value.targetAnchorHash },
            placement: 'after'
          }
        ]
      },
      editorContext: value.snapshot.editorContext,
      snapshot: value.snapshot,
      ...value.toolCall('submit_section_change')
    })

    expect(insertion).toMatchObject({ kind: 'section_patch', status: 'pending' })
    expect(currentContent(value, value.sourceSection.sectionId)).toContainEqual(value.imageBlock)
    expect(currentContent(value, value.targetSection.sectionId).filter(isImage)).toHaveLength(0)

    const inserted = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: insertion.proposalId
    })
    expect(inserted).toMatchObject({ outcome: 'applied' })
    const targetImage = currentContent(value, value.targetSection.sectionId).find(isImage)
    expect(targetImage).toMatchObject({ type: 'image', props: value.imageBlock.props })
    expect(targetImage?.id).not.toBe(value.imageBlock.id)
    expect(currentContent(value, value.sourceSection.sectionId)).toContainEqual(value.imageBlock)

    const removalSnapshot = value.contextBuilder.capture('space-removal-snapshot', {
      activeSectionId: value.sourceSection.sectionId,
      activeBlockId: value.imageBlock.id,
      selectedBlockIds: [value.imageBlock.id]
    })
    const removal = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: value.sourceSection.sectionId,
        operations: [
          {
            type: 'removeBlocks',
            targets: [{ blockId: value.imageBlock.id, expectedBlockHash: value.imageHash }]
          }
        ]
      },
      editorContext: removalSnapshot.editorContext,
      snapshot: removalSnapshot,
      ...value.toolCall('submit_section_change')
    })
    const removed = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: removal.proposalId
    })
    expect(removed).toMatchObject({ outcome: 'applied' })
    expect(currentContent(value, value.sourceSection.sectionId).filter(isImage)).toHaveLength(0)
    expect(currentContent(value, value.targetSection.sectionId).filter(isImage)).toHaveLength(1)
    expect(
      value.database.immediate((database) =>
        database
          .prepare("SELECT COUNT(*) FROM model_requests WHERE operation_kind = 'image'")
          .pluck()
          .get()
      )
    ).toBe(0)
    value.database.close()
  })

  it('rejects an existing image relocation without a matching current-run read', async () => {
    const value = await imageRelocationFixture()
    value.database.immediate((database) =>
      database.prepare("DELETE FROM agent_events WHERE type = 'tool_result'").run()
    )
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )

    await expect(submitExistingImage(tools, value)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: expect.stringContaining('current Agent run')
    })
    expect(value.service.list(agentSessionId)).toHaveLength(0)
    value.database.close()
  })

  it('keeps the applied target copy when the original source hash changes before deletion', async () => {
    const value = await imageRelocationFixture()
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const insertion = await submitExistingImage(tools, value)
    expect(
      await value.service.approve({
        projectSessionId,
        agentSessionId,
        proposalId: insertion.proposalId
      })
    ).toMatchObject({ outcome: 'applied' })
    const currentSource = value.manuscript.getSection(value.sourceSection.sectionId)
    const currentSourceRevision = value.manuscript.getRevision(currentSource.currentRevisionId)
    const changedImage = {
      ...value.imageBlock,
      props: { ...value.imageBlock.props, caption: 'Caption changed after insertion.' }
    } as BlockNoteDocument[number]
    await value.persistence.save({
      projectSessionId,
      sectionId: currentSource.sectionId,
      baseRevisionId: currentSourceRevision.sectionRevisionId,
      baseContentHash: currentSourceRevision.contentHash,
      document: [changedImage, paragraph('background-body', 'Background text.')]
    })
    const removalSnapshot = value.contextBuilder.capture('changed-source-removal-snapshot', {
      activeSectionId: currentSource.sectionId,
      activeBlockId: changedImage.id,
      selectedBlockIds: [changedImage.id]
    })

    await expect(
      tools.execute({
        toolName: 'submit_section_change',
        args: {
          sectionId: currentSource.sectionId,
          operations: [
            {
              type: 'removeBlocks',
              targets: [{ blockId: changedImage.id, expectedBlockHash: value.imageHash }]
            }
          ]
        },
        editorContext: removalSnapshot.editorContext,
        snapshot: removalSnapshot,
        ...value.toolCall('submit_section_change')
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(currentContent(value, currentSource.sectionId).filter(isImage)).toHaveLength(1)
    expect(currentContent(value, value.targetSection.sectionId).filter(isImage)).toHaveLength(1)
    expect(value.service.list(agentSessionId)).toHaveLength(1)
    value.database.close()
  })

  it('rejects an existing image relocation with an unavailable asset before proposal creation', async () => {
    const value = await imageRelocationFixture()
    value.database.immediate((database) =>
      database
        .prepare("UPDATE manuscript_assets SET deletion_state = 'deleting' WHERE asset_id = ?")
        .run(value.assetId)
    )
    const tools = new MainAgentTools(
      { contextBuilder: () => value.contextBuilder, execute: vi.fn() } as never,
      value.service
    )

    await expect(submitExistingImage(tools, value)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Mutation references an unavailable manuscript asset'
    })
    expect(value.service.list(agentSessionId)).toHaveLength(0)
    value.database.close()
  })
})
