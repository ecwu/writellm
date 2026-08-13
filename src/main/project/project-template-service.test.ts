import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readWritingRules, writeWritingRules } from '../../shared/contracts/writing-rules'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { initializeProjectDatabase, type ProjectDatabase } from './project-database'
import { createProjectManifest } from './project-manifest'
import {
  applyProjectTemplate,
  extractProjectTemplate,
  previewProjectTemplateExtraction
} from './project-template-service'

const roots: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project template projection', () => {
  it('extracts only the approved skeleton and applies it with fresh project-local identities', async () => {
    const source = await fixture('Source')
    const sourceBrief = source.manuscript.getBrief()
    source.manuscript.updateBrief({
      baseVersion: sourceBrief.version,
      title: sourceBrief.title,
      description: sourceBrief.description,
      language: '简体中文',
      topic: 'Reusable topic',
      targetAudience: sourceBrief.targetAudience,
      styleTone: sourceBrief.styleTone,
      scopeExclusions: sourceBrief.scopeExclusions,
      targetLength: sourceBrief.targetLength,
      citationRequirements: sourceBrief.citationRequirements,
      additionalInstructions: sourceBrief.additionalInstructions,
      extensible: writeWritingRules(sourceBrief.extensible, {
        schemaVersion: 1,
        rules: [
          {
            ruleId: '019d0000-0000-7000-8000-000000000490',
            category: 'style',
            instruction: 'Use precise language.',
            preferredForm: null,
            discouragedForms: [],
            rationale: null,
            active: true
          }
        ]
      })
    })
    const first = source.manuscript.listSections()[0]
    if (first === undefined) throw new Error('Missing source section')
    source.manuscript.updateSection({
      baseOutlineVersion: source.manuscript.getWorkspace().outlineVersion,
      sectionId: first.sectionId,
      title: '研究背景'
    })
    const sourceRevision = source.manuscript.getRevision(first.currentRevisionId)
    source.manuscript.appendRevision({
      sectionId: first.sectionId,
      baseRevisionId: sourceRevision.sectionRevisionId,
      baseContentHash: sourceRevision.contentHash,
      content: [
        {
          id: 'private-body',
          type: 'paragraph',
          props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
          content: [{ type: 'text', text: 'PRIVATE MANUSCRIPT BODY', styles: {} }],
          children: []
        }
      ],
      source: 'manual',
      sourceClass: 'manual_checkpoint'
    })
    const template = extractProjectTemplate({
      manuscript: source.manuscript,
      templateId: '019d0000-0000-7000-8000-000000000491',
      name: '中文模板',
      description: '',
      publicationPresetId: 'builtin:missing-optional'
    })
    expect(JSON.stringify(template)).not.toContain('PRIVATE MANUSCRIPT BODY')
    expect(JSON.stringify(template)).not.toContain(source.manifest.projectId)
    expect(JSON.stringify(template)).not.toContain('019d0000-0000-7000-8000-000000000490')
    expect(
      previewProjectTemplateExtraction({ manuscript: source.manuscript, publicationPresetId: null })
        .excluded
    ).toContain('Version history, project identity, credentials, and private paths')

    const target = await fixture('Target')
    applyProjectTemplate({ manuscript: target.manuscript, template })
    expect(target.manuscript.listSections()[0]?.title).toBe('研究背景')
    expect(target.manuscript.getBrief().language).toBe('简体中文')
    const targetRule = readWritingRules(target.manuscript.getBrief().extensible).rules[0]
    expect(targetRule?.instruction).toBe('Use precise language.')
    expect(targetRule?.ruleId).not.toBe('019d0000-0000-7000-8000-000000000490')
    expect(target.manuscript.assemble().sections[0]?.revision.content).toEqual([])
    source.database.close()
    target.database.close()
  })

  it('logs extraction success and apply failures with the original error', async () => {
    const source = await fixture('Source')
    const stubLog = { info: vi.fn(), error: vi.fn() }
    const template = extractProjectTemplate({
      manuscript: source.manuscript,
      templateId: '019d0000-0000-7000-8000-000000000492',
      name: 'Logged template',
      description: '',
      publicationPresetId: null,
      log: stubLog
    })
    expect(stubLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'project_template.extracted',
        templateId: template.templateId,
        sectionCount: template.outline.length,
        writingRuleCount: template.writingRules.length
      }),
      'Project template extracted from manuscript skeleton'
    )

    const target = await fixture('Target')
    expect(() =>
      applyProjectTemplate({
        manuscript: target.manuscript,
        template: { ...template, outline: [] },
        log: stubLog
      })
    ).toThrow()
    expect(stubLog.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'project_template.apply_failed',
        err: expect.any(Error),
        templateId: template.templateId
      }),
      'Project template application failed'
    )
    source.database.close()
    target.database.close()
  })
})

async function fixture(name: string): Promise<{
  database: ProjectDatabase
  manuscript: ManuscriptService
  manifest: ReturnType<typeof createProjectManifest>
}> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-template-projection-'))
  roots.push(parent)
  const projectRoot = join(parent, `${name}.writellm`)
  await mkdir(projectRoot)
  const manifest = createProjectManifest()
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    initialTitle: name,
    log
  })
  return {
    database,
    manuscript: new ManuscriptService({ database, projectId: manifest.projectId, log }),
    manifest
  }
}
