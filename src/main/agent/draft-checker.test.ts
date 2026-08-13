import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { writeWritingRules } from '../../shared/contracts/writing-rules'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { initializeProjectDatabase } from '../project/project-database'
import { AgentContextBuilder } from './context'
import { runDraftChecks } from './draft-checker'

const roots: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('runDraftChecks', () => {
  it('reports exact figure targets for missing caption and alt text', async () => {
    const { database, manuscript } = await fixture()
    const section = manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const snapshot = new AgentContextBuilder(manuscript).capture(
      '019d0000-0000-7000-8000-000000000200',
      { activeSectionId: section.sectionId, activeBlockId: null, selectedBlockIds: [] }
    )
    const revisionId = snapshot.workspace.sections[0]?.revision.sectionRevisionId
    if (revisionId === undefined) throw new Error('Missing revision')
    const sectionContents = new Map(snapshot.sectionContents)
    sectionContents.set(revisionId, [
      {
        id: 'figure-block',
        type: 'image',
        props: {
          backgroundColor: 'default',
          textAlignment: 'center',
          name: 'file.png',
          url: 'writellm-asset:019d0000-0000-4000-8000-000000000211',
          caption: '',
          figureId: 'figure:stable',
          altText: '',
          showPreview: true,
          previewWidth: 720
        },
        children: []
      }
    ])

    const result = runDraftChecks(
      { scope: { type: 'manuscript' }, checks: ['figure_metadata'] },
      { ...snapshot, sectionContents },
      new AbortController().signal
    )
    expect(result.findings).toHaveLength(2)
    expect(result.findings.map((finding) => finding.title)).toEqual([
      'Figure caption is missing',
      'Figure alt text is missing'
    ])
    expect(result.findings.every((finding) => finding.blockIds?.[0] === 'figure-block')).toBe(true)
    expect(result.findings.every((finding) => finding.evidence === 'figure:stable')).toBe(true)
    database.close()
  })

  it('uses one immutable snapshot and checks Latin whole words plus CJK substrings', async () => {
    const { database, manuscript } = await fixture()
    const brief = manuscript.getBrief()
    manuscript.updateBrief({
      baseVersion: brief.version,
      title: brief.title,
      description: brief.description,
      topic: brief.topic,
      targetAudience: brief.targetAudience,
      language: brief.language,
      styleTone: brief.styleTone,
      scopeExclusions: brief.scopeExclusions,
      targetLength: brief.targetLength,
      citationRequirements: brief.citationRequirements,
      additionalInstructions: brief.additionalInstructions,
      extensible: writeWritingRules(brief.extensible, {
        schemaVersion: 1,
        rules: [
          {
            ruleId: '019d0000-0000-7000-8000-000000000201',
            category: 'translation',
            instruction: 'Use the agreed LLM translation.',
            preferredForm: '大型语言模型',
            discouragedForms: ['LLM', '大语言模型'],
            rationale: null,
            active: true
          }
        ]
      })
    })
    const section = manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const initial = manuscript.getRevision(section.currentRevisionId)
    manuscript.appendRevision({
      sectionId: section.sectionId,
      baseRevisionId: initial.sectionRevisionId,
      baseContentHash: initial.contentHash,
      content: [paragraph('term-block', 'LLMfoo is separate. LLM 与大语言模型需要统一。')],
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    const snapshot = new AgentContextBuilder(manuscript).capture(
      '019d0000-0000-7000-8000-000000000202',
      { activeSectionId: section.sectionId, activeBlockId: null, selectedBlockIds: [] }
    )
    const capturedRevision = snapshot.workspace.sections[0]?.revision.sectionRevisionId
    if (capturedRevision === undefined) throw new Error('Missing captured revision')
    const captured = manuscript.getRevision(capturedRevision)
    manuscript.appendRevision({
      sectionId: section.sectionId,
      baseRevisionId: captured.sectionRevisionId,
      baseContentHash: captured.contentHash,
      content: [paragraph('term-block', 'The live revision no longer contains those terms.')],
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    const result = runDraftChecks(
      {
        scope: { type: 'manuscript' },
        checks: ['writing_rules', 'safe_links', 'references_availability']
      },
      snapshot,
      new AbortController().signal
    )
    expect(result.findings).toHaveLength(2)
    expect(result.findings.every((finding) => finding.revisionId === capturedRevision)).toBe(true)
    expect(result.summary.passedChecks).toContain('safe_links')
    expect(result.summary.unavailableChecks).toContain('references_availability')
    database.close()
  })

  it('caps findings at 200, reports truncation, and honors cancellation', async () => {
    const { database, manuscript } = await fixture()
    const section = manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const initial = manuscript.getRevision(section.currentRevisionId)
    manuscript.appendRevision({
      sectionId: section.sectionId,
      baseRevisionId: initial.sectionRevisionId,
      baseContentHash: initial.contentHash,
      content: Array.from({ length: 205 }, (_, index) => paragraph(`todo-${index}`, '[TODO]')),
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    const snapshot = new AgentContextBuilder(manuscript).capture(
      '019d0000-0000-7000-8000-000000000203',
      { activeSectionId: section.sectionId, activeBlockId: null, selectedBlockIds: [] }
    )
    const result = runDraftChecks(
      { scope: { type: 'manuscript' }, checks: ['unresolved_placeholders'] },
      snapshot,
      new AbortController().signal
    )
    expect(result.findings).toHaveLength(200)
    expect(result.summary.truncated).toBe(true)
    const controller = new AbortController()
    controller.abort()
    expect(() =>
      runDraftChecks(
        { scope: { type: 'manuscript' }, checks: ['unresolved_placeholders'] },
        snapshot,
        controller.signal
      )
    ).toThrow('aborted')
    database.close()
  })

  it('checks reference availability and unused resources from the captured inventory', async () => {
    const { database, manuscript } = await fixture()
    const section = manuscript.listSections()[0]
    if (section === undefined) throw new Error('Missing section')
    const initial = manuscript.getRevision(section.currentRevisionId)
    manuscript.appendRevision({
      sectionId: section.sectionId,
      baseRevisionId: initial.sectionRevisionId,
      baseContentHash: initial.contentHash,
      content: [paragraph('citations', '[Source: Available.pdf] [Source: Missing.pdf]')],
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    const snapshot = new AgentContextBuilder(manuscript).capture(
      '019d0000-0000-7000-8000-000000000204',
      { activeSectionId: section.sectionId, activeBlockId: null, selectedBlockIds: [] }
    )
    snapshot.reviewResources = {
      knowledgeItems: [
        { knowledgeItemId: 'knowledge-1', displayName: 'Available.pdf', state: 'stored' },
        { knowledgeItemId: 'knowledge-2', displayName: 'Unused.pdf', state: 'stored' }
      ],
      manuscriptAssets: [
        { assetId: 'asset-used', referencedByCurrentRevision: true },
        { assetId: 'asset-unused', referencedByCurrentRevision: false }
      ]
    }

    const result = runDraftChecks(
      {
        scope: { type: 'manuscript' },
        checks: ['references_availability', 'unused_resources']
      },
      snapshot,
      new AbortController().signal
    )
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'P1',
          check: 'references_availability',
          evidence: 'Missing.pdf'
        }),
        expect.objectContaining({
          priority: 'P3',
          check: 'unused_resources',
          evidence: 'Unused.pdf'
        }),
        expect.objectContaining({
          priority: 'P3',
          check: 'unused_resources',
          evidence: 'asset-unused'
        })
      ])
    )
    expect(result.summary.unavailableChecks).toEqual([])
    database.close()
  })
})

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-draft-check-'))
  roots.push(parent)
  const projectRoot = join(parent, 'DraftCheck.writellm')
  await mkdir(projectRoot)
  const projectId = '019d0000-0000-7000-8000-000000000200'
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId,
      createdAt: '2026-08-13T00:00:00.000Z'
    },
    applicationVersion: 'test',
    log
  })
  return { database, manuscript: new ManuscriptService({ database, projectId, log }) }
}

function paragraph(id: string, text: string) {
  return {
    id,
    type: 'paragraph' as const,
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
    content: [{ type: 'text' as const, text, styles: {} }],
    children: []
  }
}
