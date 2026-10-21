import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { prepareSectionContent } from './content'
import { SectionRepository } from './section-repository'

const directories: string[] = []
const log = pino({ level: 'silent' })

const paragraph = (id: string, text: string) => ({
  id,
  type: 'paragraph' as const,
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
  content: [{ type: 'text' as const, text, styles: {} }],
  children: []
})

async function fixture(): Promise<{ database: ProjectDatabase; manifest: ProjectManifest }> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-section-repository-'))
  directories.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: randomUUID(),
    createdAt: '2026-10-21T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log,
    initialTitle: 'Section repository test'
  })
  return { database, manifest }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('SectionRepository', () => {
  it('inserts a prepared revision and performs a compare-and-set current-head update', async () => {
    const { database } = await fixture()
    try {
      const current = database.read(
        (native) =>
          native.prepare('SELECT section_id, current_revision_id FROM sections LIMIT 1').get() as {
            section_id: string
            current_revision_id: string
          }
      )
      const nextRevisionId = randomUUID()
      const content = [paragraph('repository-block', 'repository write')]
      const prepared = prepareSectionContent(content, current.section_id)

      database.immediate((native) => {
        expect(
          SectionRepository.insertRevision(native, {
            revisionId: nextRevisionId,
            sectionId: current.section_id,
            revisionNumber: 2,
            source: 'manual',
            sourceClass: 'manual_autosave',
            prepared,
            priorRevisionId: current.current_revision_id,
            agentRunId: null,
            agentToolCallId: null,
            agentProposalId: null,
            createdAt: '2026-10-21T01:00:00.000Z'
          }).contentHash
        ).toBe(prepared.contentHash)
        expect(
          SectionRepository.updateCurrentRevision(native, {
            sectionId: current.section_id,
            expectedRevisionId: current.current_revision_id,
            revisionId: nextRevisionId,
            updatedAt: '2026-10-21T01:00:00.000Z'
          })
        ).toBe(true)
        expect(
          SectionRepository.updateCurrentRevision(native, {
            sectionId: current.section_id,
            expectedRevisionId: current.current_revision_id,
            revisionId: randomUUID(),
            updatedAt: '2026-10-21T01:00:00.000Z'
          })
        ).toBe(false)
      })

      expect(
        database.read((native) =>
          native
            .prepare('SELECT current_revision_id FROM sections WHERE section_id = ?')
            .pluck()
            .get(current.section_id)
        )
      ).toBe(nextRevisionId)
    } finally {
      database.close()
    }
  })
})
