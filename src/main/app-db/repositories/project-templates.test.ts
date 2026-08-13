import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectTemplate } from '../../../shared/contracts/project-templates'
import { openAppDatabase } from '../connection'
import { ProjectTemplateRepository } from './project-templates'

const roots: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ProjectTemplateRepository', () => {
  it('stores hash-verified user files, rejects duplicate names, and survives source deletion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-project-templates-'))
    roots.push(root)
    const database = await openAppDatabase({
      path: join(root, 'app.sqlite'),
      applicationVersion: 'test',
      log
    })
    const files = join(root, 'template-files')
    const repository = new ProjectTemplateRepository(database, files, log, {
      builtIns: [],
      createId: () => '019d0000-0000-7000-8000-000000000480'
    })
    const template = fixtureTemplate()
    await repository.create(template)
    expect(await repository.resolve(template.templateId)).toEqual(template)
    await expect(
      repository.create({ ...template, templateId: crypto.randomUUID() })
    ).rejects.toThrow()

    const path = join(files, `${template.templateId}.json`)
    expect(await readFile(path, 'utf8')).not.toContain('/Users/')
    await writeFile(path, `${await readFile(path, 'utf8')}tampered`)
    expect(await repository.list()).toEqual([
      expect.objectContaining({ templateId: template.templateId, integrity: 'integrity_failed' })
    ])
    await repository.delete(template.templateId)
    expect(await repository.list()).toEqual([])
    database.close()
  })

  it('loads reviewed CJK built-ins and rejects malformed or future resource fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-project-templates-'))
    roots.push(root)
    const database = await openAppDatabase({
      path: join(root, 'app.sqlite'),
      applicationVersion: 'test',
      log
    })
    const repository = new ProjectTemplateRepository(database, join(root, 'files'), log)
    expect(await repository.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '中文研究报告', origin: 'application' })
      ])
    )
    expect(
      () =>
        new ProjectTemplateRepository(database, join(root, 'invalid'), log, {
          builtIns: [{ ...fixtureTemplate(), unknownFutureField: true }]
        })
    ).toThrow()
    database.close()
  })
})

function fixtureTemplate(): ProjectTemplate {
  return {
    format: 'writellm-project-template',
    formatVersion: 1,
    templateId: '019d0000-0000-7000-8000-000000000479',
    name: 'Reusable structure',
    description: 'No project content',
    brief: {
      description: 'Brief skeleton',
      topic: '',
      targetAudience: '',
      language: 'English',
      styleTone: '',
      scopeExclusions: '',
      targetLength: '',
      citationRequirements: '',
      additionalInstructions: ''
    },
    outline: [
      {
        templateKey: 'opening',
        parentTemplateKey: null,
        title: 'Opening',
        objective: null,
        status: 'planned'
      }
    ],
    writingRules: [],
    publicationPresetId: 'builtin:missing-optional'
  }
}
