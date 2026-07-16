import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { KnowledgeImportService } from './knowledge-import-service'

const roots: string[] = []
const log = pino({ level: 'silent' })

async function fixture(
  faults: ConstructorParameters<typeof KnowledgeImportService>[0]['faults'] = {}
) {
  const root = await mkdtemp(join(tmpdir(), 'writellm-knowledge-'))
  roots.push(root)
  const projectRoot = join(root, 'project.writellm')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: crypto.randomUUID(),
    createdAt: '2026-07-16T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log
  })
  const service = new KnowledgeImportService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    log,
    faults
  })
  return { root, projectRoot, database, service }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('KnowledgeImportService', () => {
  it('publishes a Unicode original by content hash and deduplicates repeated bytes', async () => {
    const { root, projectRoot, database, service } = await fixture()
    const source = join(root, '研究 notes.pdf')
    const bytes = Buffer.from('%PDF-1.7\nUnicode source')
    await writeFile(source, bytes)

    const [stored] = await service.importPaths([source])
    expect(stored).toMatchObject({
      originalName: '研究 notes.pdf',
      displayName: '研究 notes.pdf',
      state: 'stored',
      byteSize: bytes.byteLength,
      mimeType: 'application/pdf'
    })
    expect(stored?.sha256).toMatch(/^[a-f0-9]{64}$/)
    if (!stored?.sha256) throw new Error('Stored source hash is missing')
    const [prefix, hash] = [stored.sha256.slice(0, 2), stored.sha256]
    await expect(
      readFile(
        join(
          projectRoot,
          'knowledge',
          'originals',
          'sha256',
          prefix as string,
          hash as string,
          '研究 notes.pdf'
        )
      )
    ).resolves.toEqual(bytes)

    const [duplicate] = await service.importPaths([source])
    expect(duplicate?.knowledgeItemId).toBe(stored?.knowledgeItemId)
    expect(service.list()).toHaveLength(1)
    expect(
      database.immediate((native) =>
        native.prepare('SELECT COUNT(*) FROM file_records').pluck().get()
      )
    ).toBe(1)
    database.close()
  })

  it('rejects MIME mismatches, legacy formats, and symbolic-link sources with explicit states', async () => {
    const { root, database, service } = await fixture()
    const mismatch = join(root, 'pretend.pdf')
    const legacy = join(root, 'legacy.doc')
    const linked = join(root, 'linked.pdf')
    await writeFile(mismatch, 'not a pdf')
    await writeFile(legacy, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
    await symlink(mismatch, linked)

    await service.importPaths([mismatch, legacy, linked])
    expect(service.list().map((item) => item.errorCode)).toEqual([
      'source_not_regular',
      'legacy_format_unsupported',
      'mime_mismatch'
    ])
    database.close()
  })

  it('cancels an in-flight copy and deletes its partial record without publishing bytes', async () => {
    const { root, projectRoot, database, service } = await fixture()
    const source = join(root, 'large.pdf')
    await writeFile(
      source,
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64 * 1024 * 1024)])
    )
    const importing = service.importPaths([source])
    await expect.poll(() => service.list()[0]?.state).toBe('importing')
    const item = service.list()[0]
    await service.cancelAll()
    await expect(importing).resolves.toEqual([
      expect.objectContaining({ state: 'cancelled', errorCode: 'cancelled' })
    ])
    expect(service.list()[0]).toMatchObject({ state: 'cancelled', errorCode: 'cancelled' })
    await service.delete(item?.knowledgeItemId as string)
    expect(service.list()).toEqual([])
    await expect(readdir(join(projectRoot, '.writellm', 'temp', 'imports'))).resolves.toEqual([])
    database.close()
  })

  it('records insufficient disk space without publishing a partial original', async () => {
    const diskError = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    const { root, projectRoot, database, service } = await fixture({
      beforeTempOpen: () => {
        throw diskError
      }
    })
    const longName = `${'source'.repeat(35)}.pdf`
    const source = join(root, longName)
    await writeFile(source, '%PDF-1.7\nsource')
    const result = await service.importPaths([source])
    expect(result[0]).toMatchObject({ state: 'failed', errorCode: 'insufficient_disk_space' })
    expect(result[0]?.displayName.length).toBeLessThanOrEqual(180)
    await expect(
      readdir(join(projectRoot, 'knowledge'), { recursive: true }).catch(() => [])
    ).resolves.not.toEqual(expect.arrayContaining([expect.stringMatching(/\.pdf$/)]))
    database.close()
  })
})
