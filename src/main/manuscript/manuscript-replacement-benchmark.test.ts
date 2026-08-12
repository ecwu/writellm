import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { initializeProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { ManuscriptService } from './manuscript-service'

const enabled = process.env.WRITELLM_MANUSCRIPT_REPLACEMENT_BENCHMARK === '1'
const silentLog = pino({ level: 'silent' })

describe('manuscript replacement transaction benchmark', () => {
  it.runIf(enabled)('keeps 500 replacements across 100 sections within the p95 gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-replacement-benchmark-'))
    try {
      await mkdir(join(root, 'project'))
      const manifest: ProjectManifest = {
        format: 'writellm-project',
        formatVersion: 1,
        projectId: crypto.randomUUID(),
        createdAt: '2026-08-12T00:00:00.000Z'
      }
      const database = await initializeProjectDatabase({
        projectRoot: join(root, 'project'),
        manifest,
        applicationVersion: 'benchmark',
        initialTitle: 'Replacement benchmark',
        log: silentLog
      })
      const manuscript = new ManuscriptService({
        database,
        projectId: manifest.projectId,
        log: silentLog
      })
      let workspace = manuscript.getWorkspace()
      for (let index = 1; index < 100; index += 1) {
        manuscript.createSection({
          baseOutlineVersion: manuscript.getWorkspace().outlineVersion,
          title: `Section ${index}`,
          position: index
        })
      }
      workspace = manuscript.getWorkspace()
      for (const entry of workspace.sections) {
        manuscript.appendRevision({
          sectionId: entry.section.sectionId,
          baseRevisionId: entry.revision.sectionRevisionId,
          baseContentHash: entry.revision.contentHash,
          content: [paragraph(entry.section.sectionId, 'alpha')]
        })
      }

      const samples: number[] = []
      for (let iteration = 0; iteration < 35; iteration += 1) {
        const source = iteration % 2 === 0 ? 'alpha' : 'bravo'
        const replacement = source === 'alpha' ? 'bravo' : 'alpha'
        const assembly = manuscript.assemble()
        const result = manuscript.applyReplacementBatch({
          outlineVersion: assembly.outlineVersion,
          replacement,
          sections: assembly.sections.map((entry) => ({
            sectionId: entry.section.sectionId,
            baseRevisionId: entry.revision.sectionRevisionId,
            baseContentHash: entry.revision.contentHash,
            operations: [0, 6, 12, 18, 24].map((from) => ({
              target: {
                kind: 'block_inline' as const,
                sectionId: entry.section.sectionId,
                revisionId: entry.revision.sectionRevisionId,
                blockId: `paragraph-${entry.section.sectionId}`,
                segments: [{ inlineIndex: 0, range: { from, to: from + 5 } }],
                flatRange: { from, to: from + 5 }
              },
              sourceSliceHash: createHash('sha256').update(source).digest('hex')
            }))
          }))
        })
        expect(result.revisions).toHaveLength(100)
        if (iteration >= 5) samples.push(result.transactionDurationMs)
      }
      database.close()
      const ordered = [...samples].sort((left, right) => left - right)
      const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
      process.stdout.write(
        `MANUSCRIPT_REPLACEMENT_BENCHMARK ${JSON.stringify({
          runtime: process.version,
          architecture: process.arch,
          sections: 100,
          replacements: 500,
          warmups: 5,
          samples: samples.length,
          p50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
          p95Ms: p95,
          maxMs: ordered.at(-1)
        })}\n`
      )
      expect(samples).toHaveLength(30)
      expect(p95).toBeLessThanOrEqual(100)
    } finally {
      await rm(root, { recursive: true })
    }
  })
})

function paragraph(sectionId: string, token: string) {
  return {
    id: `paragraph-${sectionId}`,
    type: 'paragraph' as const,
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
    content: [
      { type: 'text' as const, text: `${token} ${token} ${token} ${token} ${token}`, styles: {} }
    ],
    children: []
  }
}
