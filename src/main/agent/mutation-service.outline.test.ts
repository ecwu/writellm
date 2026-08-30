import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ManuscriptAssetService } from '../manuscript/asset-service'
import { MutationProposalService } from './mutation-service'
import { AgentToolDomainError } from './read-tools'
import { AgentContextBuilder } from './context'
import { MainAgentTools } from './tools'
import {
  log,
  projectSessionId,
  agentSessionId,
  agentRunId,
  fixture,
  currentContent,
  imageModelRequestId,
  seedImageModelRequest,
  png,
  paragraph
} from './mutation-service.test-support'

describe('MutationProposalService: outline', () => {
  it('normalizes sequential outline moves against the updated provisional sibling order', async () => {
    const value = await fixture()
    const root = value.manuscript.listSections()[0]
    if (root === undefined) throw new Error('Missing root section')
    const second = value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Second',
      parentSectionId: null,
      position: 1
    })
    const third = value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Third',
      parentSectionId: null,
      position: 2
    })
    value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Fourth',
      parentSectionId: null,
      position: 3
    })
    const contextBuilder = new AgentContextBuilder(value.manuscript)
    const snapshot = contextBuilder.capture('snapshot-outline-sequence', {
      activeSectionId: null,
      activeBlockId: null,
      selectedBlockIds: []
    })
    const tools = new MainAgentTools(
      { contextBuilder: () => contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const context = value.toolCall('submit_outline_change')
    const result = await tools.execute({
      toolName: 'submit_outline_change',
      args: {
        operations: [
          {
            type: 'moveSection',
            section: { kind: 'existing', sectionId: third.sectionId },
            parent: null,
            placement: { kind: 'before', anchor: { kind: 'existing', sectionId: root.sectionId } }
          },
          {
            type: 'deleteSection',
            section: { kind: 'existing', sectionId: second.sectionId }
          },
          {
            type: 'createSection',
            clientRef: 'created-conclusion',
            parent: null,
            placement: { kind: 'after', anchor: { kind: 'existing', sectionId: root.sectionId } },
            title: 'Conclusion',
            objective: null,
            status: 'planned'
          },
          {
            type: 'moveSection',
            section: { kind: 'created', clientRef: 'created-conclusion' },
            parent: null,
            placement: { kind: 'first' }
          }
        ]
      },
      editorContext: snapshot.editorContext,
      snapshot,
      ...context
    })

    const proposal = value.service
      .list(agentSessionId)
      .find((item) => item.proposalId === result.proposalId)
    if (proposal?.payload.kind !== 'outline_patch') throw new Error('Missing outline proposal')
    expect(proposal.payload.mutation.operations).toMatchObject([
      { type: 'moveSection', sectionId: third.sectionId, parentSectionId: null, position: 0 },
      { type: 'deleteSection', sectionId: second.sectionId },
      { type: 'createSection', parentSectionId: null, position: 2, title: 'Conclusion' },
      { type: 'moveSection', parentSectionId: null, position: 0 }
    ])
    expect(proposal.payload.preview.presentation).toMatchObject({
      kind: 'outline_operations',
      operations: [
        { type: 'move', title: third.title, before: { position: 2 }, after: { position: 0 } },
        { type: 'delete', section: { sectionId: second.sectionId } },
        { type: 'create', section: { title: 'Conclusion', location: { position: 2 } } },
        {
          type: 'move',
          title: 'Conclusion',
          before: { position: 2 },
          after: { position: 0 }
        }
      ]
    })
    value.database.close()
  })

  it('creates native math and application-owned diagram blocks through the Agent tool', async () => {
    const value = await fixture()
    const section = value.manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const contextBuilder = new AgentContextBuilder(value.manuscript)
    const snapshot = contextBuilder.capture('snapshot-rich-blocks', {
      activeSectionId: section.sectionId,
      activeBlockId: null,
      selectedBlockIds: []
    })
    const tools = new MainAgentTools(
      { contextBuilder: () => contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const result = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: section.sectionId,
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
      },
      editorContext: snapshot.editorContext,
      snapshot,
      ...value.toolCall('submit_section_change')
    })

    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: result.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied' })
    expect(currentContent(value, section.sectionId)).toMatchObject([
      {
        type: 'mathBlock',
        props: {},
        content: [{ type: 'text', text: String.raw`\frac{x}{y}`, styles: {} }]
      },
      {
        type: 'diagram',
        props: { engine: 'mermaid', caption: 'Flow', altText: 'A flows to B' },
        content: [{ type: 'text', text: 'flowchart LR\nA --> B', styles: {} }]
      }
    ])
    value.database.close()
  })

  it('creates a normalized native table through a reviewable section proposal', async () => {
    const value = await fixture()
    const section = value.manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const contextBuilder = new AgentContextBuilder(value.manuscript)
    const snapshot = contextBuilder.capture('snapshot-table-create', {
      activeSectionId: section.sectionId,
      activeBlockId: null,
      selectedBlockIds: []
    })
    const tools = new MainAgentTools(
      { contextBuilder: () => contextBuilder, execute: vi.fn() } as never,
      value.service
    )
    const result = await tools.execute({
      toolName: 'submit_section_change',
      args: {
        sectionId: section.sectionId,
        operations: [
          {
            type: 'insertTable',
            placement: 'end',
            table: {
              clientRef: 'results',
              headerRows: 1,
              headerCols: 1,
              rows: [
                [
                  'Metric',
                  { content: [{ type: 'math', content: 'R^2' }], textAlignment: 'center' }
                ],
                ['Score', '0.91']
              ]
            }
          }
        ]
      },
      editorContext: snapshot.editorContext,
      snapshot,
      ...value.toolCall('submit_section_change')
    })
    expect(result.createdBlockRefs).toMatchObject({ results: expect.any(String) })
    expect(result.preview.presentation).toMatchObject({
      kind: 'table_diff',
      tables: [{ beforeRows: 0, afterRows: 2, afterColumns: 2 }]
    })
    const applied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: result.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied' })
    expect(currentContent(value, section.sectionId)).toMatchObject([
      {
        id: result.createdBlockRefs?.results,
        type: 'table',
        content: {
          type: 'tableContent',
          headerRows: 1,
          headerCols: 1,
          columnWidths: [null, null],
          rows: [
            {
              cells: [
                { type: 'tableCell', props: { textAlignment: 'left' } },
                { type: 'tableCell', props: { textAlignment: 'center' } }
              ]
            },
            {
              cells: [
                { type: 'tableCell', props: { textAlignment: 'left' } },
                { type: 'tableCell', props: { textAlignment: 'left' } }
              ]
            }
          ]
        }
      }
    ])
    value.database.close()
  })

  it('tombstones a section with accepted Agent lineage and preserves every revision reference', async () => {
    const value = await fixture()
    const root = value.manuscript.listSections()[0]
    if (root === undefined) throw new Error('Missing root section')
    const target = value.manuscript.createSection({
      baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
      title: 'Agent-edited section',
      parentSectionId: null,
      position: 1
    })
    const sectionProposal = value.service.propose(
      'submit_section_change',
      {
        schemaVersion: 1,
        sectionId: target.sectionId,
        baseRevisionId: target.currentRevisionId,
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [paragraph('agent-outline-delete', 'Accepted before outline deletion')]
          }
        ],
        citationIds: []
      },
      value.toolCall('submit_section_change')
    )
    const sectionApplied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: sectionProposal.proposalId
    })
    const appliedRevisionId = sectionApplied.proposal.appliedRevisionId
    if (appliedRevisionId === null) throw new Error('Missing accepted revision')
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM section_materializations WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toBe(1)

    const workspace = value.manuscript.getWorkspace()
    const outlineProposal = value.service.propose(
      'submit_outline_change',
      {
        schemaVersion: 1,
        manuscriptId: workspace.manuscriptId,
        baseOutlineVersion: workspace.outlineVersion,
        operations: [{ type: 'deleteSection', sectionId: target.sectionId }],
        citationIds: []
      },
      value.toolCall('submit_outline_change')
    )
    const outlineApplied = await value.service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: outlineProposal.proposalId
    })

    expect(outlineApplied.proposal).toMatchObject({
      status: 'applied',
      appliedOutlineVersion: workspace.outlineVersion + 1
    })
    expect(value.manuscript.listSections().map((section) => section.sectionId)).toEqual([
      root.sectionId
    ])
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT deleted_at FROM sections WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toEqual(expect.any(String))
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM section_revisions WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toBe(2)
    expect(
      value.database.immediate((database) =>
        database
          .prepare(
            'SELECT applied_revision_id FROM mutation_proposals WHERE mutation_proposal_id = ?'
          )
          .pluck()
          .get(sectionProposal.proposalId)
      )
    ).toBe(appliedRevisionId)
    expect(
      value.database.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM section_materializations WHERE section_id = ?')
          .pluck()
          .get(target.sectionId)
      )
    ).toBe(0)
    expect(value.database.immediate((database) => database.pragma('foreign_key_check'))).toEqual([])
    await expect(
      value.service.undo({
        projectSessionId,
        agentSessionId,
        proposalId: sectionProposal.proposalId
      })
    ).rejects.toMatchObject({ code: 'proposal_not_undoable' })
    expect(
      value.service
        .list(agentSessionId)
        .find((item) => item.proposalId === sectionProposal.proposalId)?.status
    ).toBe('applied')
    const afterDeletion = value.manuscript.getWorkspace()
    expect(() =>
      value.service.propose(
        'submit_outline_change',
        {
          schemaVersion: 1,
          manuscriptId: afterDeletion.manuscriptId,
          baseOutlineVersion: afterDeletion.outlineVersion,
          operations: [
            {
              type: 'createSection',
              sectionId: target.sectionId,
              parentSectionId: null,
              position: 1,
              title: 'Do not reuse tombstone ID',
              objective: null,
              status: 'planned'
            }
          ],
          citationIds: []
        },
        value.toolCall('submit_outline_change')
      )
    ).toThrowError(expect.objectContaining({ code: 'invalid_arguments' }))
    value.database.close()
  })

  it('returns a retryable conflict with refresh guidance when an outline proposal uses a stale version', async () => {
    const value = await fixture()
    const workspace = value.manuscript.getWorkspace()
    const context = value.toolCall('submit_outline_change')
    let error: unknown
    try {
      value.service.propose(
        'submit_outline_change',
        {
          schemaVersion: 1,
          manuscriptId: workspace.manuscriptId,
          baseOutlineVersion: workspace.outlineVersion + 1,
          operations: [
            {
              type: 'createSection',
              sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc753',
              parentSectionId: null,
              position: 1,
              title: 'Fresh context required',
              objective: null,
              status: 'planned'
            }
          ],
          citationIds: []
        },
        context
      )
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(AgentToolDomainError)
    expect(error).toMatchObject({ code: 'conflict', retryable: true })
    expect((error as Error).message).toContain('get_writing_context')
    expect(
      value.database.immediate((database) =>
        database.prepare('SELECT COUNT(*) FROM mutation_proposals').pluck().get()
      )
    ).toBe(0)
    value.database.close()
  })

  it('reuses one generated asset when an edit during generation requires a refreshed proposal', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const base = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('base', 'Before generation')]
    })
    const manuscriptAssets = new ManuscriptAssetService({
      projectRoot: value.projectRoot,
      projectId: value.manifest.projectId,
      database: value.database,
      log
    })
    let finishGeneration: ((result: Record<string, unknown>) => void) | undefined
    const generatedResult = new Promise<Record<string, unknown>>((resolve) => {
      finishGeneration = resolve
    })
    const generateImage = vi.fn(async () => {
      seedImageModelRequest(value.database)
      return generatedResult
    })
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      manuscriptAssets,
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const snapshot = new AgentContextBuilder(value.manuscript).capture('image-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: [],
      activeBlockId: null
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'A clean architecture diagram without embedded text',
        altText: 'Architecture diagram',
        caption: 'Generated architecture',
        aspectRatio: '16:9',
        imageSize: '1K'
      },
      snapshot,
      value.toolCall('generate_image')
    )
    expect(generateImage).not.toHaveBeenCalled()

    const approval = service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))
    await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: base.revision.sectionRevisionId,
      baseContentHash: base.revision.contentHash,
      document: [paragraph('base', 'Edited while generating')]
    })
    finishGeneration?.({
      dataBase64: png(64, 36).toString('base64'),
      mimeType: 'image/png',
      effectiveImageSize: '1K',
      modelRequestId: imageModelRequestId,
      metadata: {
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          estimatedCostUsdMicros: null
        },
        responseIds: ['gemini-response'],
        retryCount: 0,
        providerModelId: 'gemini-3.1-flash-image'
      }
    })
    const refreshed = await approval
    expect(refreshed).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { status: 'superseded' },
      proposal: { status: 'pending' }
    })
    if (refreshed.outcome !== 'refresh_required') throw new Error('Expected image refresh')
    expect(refreshed.proposal.payload).toMatchObject({
      kind: 'generated_image_insert',
      mutation: { assetId: expect.any(String), imageModelRequestId }
    })
    if (
      refreshed.proposal.payload.kind !== 'generated_image_insert' ||
      refreshed.proposal.payload.mutation.assetId === null
    ) {
      throw new Error('Expected generated image asset')
    }
    const generatedAssetId = refreshed.proposal.payload.mutation.assetId

    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: refreshed.proposal.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied', proposal: { status: 'applied' } })
    expect(generateImage).toHaveBeenCalledTimes(1)
    const current = value.manuscript.getRevision(applied.proposal.appliedRevisionId ?? '')
    expect(current.content.map((block) => block.type)).toEqual(['paragraph', 'image'])
    expect(current.content.at(-1)).toMatchObject({
      type: 'image',
      props: { url: `writellm-asset:${generatedAssetId}` }
    })
    const assetRow = value.database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT relative_path, mime_type, source_type, generation_request_json,
                      model_request_id, agent_run_id
                 FROM manuscript_assets
                WHERE asset_id = ?`
          )
          .get(generatedAssetId) as {
          relative_path: string
          mime_type: string
          source_type: string
          generation_request_json: string
          model_request_id: string
          agent_run_id: string
        }
    )
    expect(assetRow).toMatchObject({
      relative_path: expect.stringMatching(/^manuscript\/assets\/[0-9a-f]{64}\.png$/),
      mime_type: 'image/png',
      source_type: 'generated',
      model_request_id: imageModelRequestId,
      agent_run_id: agentRunId
    })
    expect(JSON.parse(assetRow.generation_request_json)).toEqual({
      prompt: 'A clean architecture diagram without embedded text',
      aspectRatio: '16:9',
      requestedImageSize: '1K',
      effectiveImageSize: '1K'
    })
    expect(await readFile(join(value.projectRoot, assetRow.relative_path))).toEqual(png(64, 36))
    expect(
      value.database.immediate((native) =>
        native
          .prepare(
            `SELECT section_revision_id, asset_id
                 FROM section_revision_assets
                WHERE asset_id = ?`
          )
          .get(generatedAssetId)
      )
    ).toEqual({
      section_revision_id: current.sectionRevisionId,
      asset_id: generatedAssetId
    })
    value.database.close()
  })

  it('refreshes a stale image base before calling the billable gateway', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const snapshot = new AgentContextBuilder(value.manuscript).capture('stale-image-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: [],
      activeBlockId: null
    })
    const generateImage = vi.fn(async () => {
      seedImageModelRequest(value.database)
      return {
        dataBase64: png(64, 36).toString('base64'),
        mimeType: 'image/png',
        effectiveImageSize: '1K',
        modelRequestId: imageModelRequestId,
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimatedCostUsdMicros: null
          },
          responseIds: ['gemini-response'],
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
      manuscriptAssets: new ManuscriptAssetService({
        projectRoot: value.projectRoot,
        projectId: value.manifest.projectId,
        database: value.database,
        log
      }),
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'An image that must not be billed after a stale edit',
        altText: 'Stale image',
        caption: '',
        aspectRatio: 'auto',
        imageSize: '1K'
      },
      snapshot,
      value.toolCall('generate_image')
    )
    const edited = await value.persistence.save({
      projectSessionId,
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('new-base', 'Changed before approval')]
    })

    const refreshed = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(refreshed).toMatchObject({
      outcome: 'refresh_required',
      previousProposal: { status: 'superseded' },
      proposal: { status: 'pending', kind: 'generated_image_insert' }
    })
    expect(generateImage).not.toHaveBeenCalled()
    if (
      refreshed.outcome !== 'refresh_required' ||
      refreshed.proposal.payload.kind !== 'generated_image_insert'
    ) {
      throw new Error('Expected a refreshed image proposal')
    }
    expect(refreshed.proposal.payload.mutation).toMatchObject({
      baseRevisionId: edited.revision.sectionRevisionId,
      assetId: null
    })

    const applied = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: refreshed.proposal.proposalId
    })
    expect(applied).toMatchObject({ outcome: 'applied', proposal: { status: 'applied' } })
    expect(generateImage).toHaveBeenCalledTimes(1)
    value.database.close()
  })

  it('resolves an image proposal as conflicted when its section was removed before approval', async () => {
    const value = await fixture()
    const opened = value.persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const snapshot = new AgentContextBuilder(value.manuscript).capture('missing-image-snapshot', {
      activeSectionId: opened.section.sectionId,
      selectedBlockIds: [],
      activeBlockId: null
    })
    const generateImage = vi.fn()
    const service = new MutationProposalService({
      projectId: value.manifest.projectId,
      projectSessionId,
      database: value.database,
      manuscript: value.manuscript,
      editorPersistence: value.persistence,
      manuscriptAssets: new ManuscriptAssetService({
        projectRoot: value.projectRoot,
        projectId: value.manifest.projectId,
        database: value.database,
        log
      }),
      modelExecution: { generateImage } as never,
      flushForMutation: async () => undefined,
      log
    })
    const proposed = service.proposeGeneratedImage(
      {
        sectionId: opened.section.sectionId,
        anchor: null,
        placement: 'end',
        prompt: 'An image whose target section is removed before approval',
        altText: 'Removed target image',
        caption: '',
        aspectRatio: 'auto',
        imageSize: '1K'
      },
      snapshot,
      value.toolCall('generate_image')
    )
    value.database.immediate((database) =>
      database
        .prepare('UPDATE sections SET deleted_at = ? WHERE section_id = ?')
        .run('2026-07-21T00:02:00.000Z', opened.section.sectionId)
    )

    const result = await service.approve({
      projectSessionId,
      agentSessionId,
      proposalId: proposed.proposalId
    })
    expect(result).toMatchObject({
      outcome: 'conflict',
      conflict: { code: 'target_missing' },
      proposal: { status: 'conflicted' }
    })
    expect(generateImage).not.toHaveBeenCalled()
    value.database.close()
  })
})
