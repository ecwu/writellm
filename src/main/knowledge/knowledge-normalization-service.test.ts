import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizedKnowledgeBlockSchema } from '../../shared/contracts/knowledge'
import { mineruRawManifestSchema } from '../../shared/contracts/mineru'
import { initializeProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { JobStore } from '../jobs/job-store'
import { runKnowledgeNormalizer } from '../../workers/knowledge-normalizer'
import type { MineruGateway } from './mineru-gateway'
import { KnowledgeNormalizationService } from './knowledge-normalization-service'

const roots: string[] = []
const log = pino({ level: 'silent' })
const knowledgeItemId = '11111111-1111-4111-8111-111111111111'
const parseTaskId = '22222222-2222-4222-8222-222222222222'
const parseRevisionId = '33333333-3333-4333-8333-333333333333'
const sourceHash = 'a'.repeat(64)
const providerFingerprint = 'b'.repeat(64)
const normalizeInUtility: MineruGateway['normalize'] = async (input) => {
  const {
    type: _,
    requestId: __,
    ...result
  } = await runKnowledgeNormalizer({
    operation: 'normalize',
    requestId: crypto.randomUUID(),
    ...input
  })
  return result
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('KnowledgeNormalizationService', () => {
  it('normalizes headings, tables, formulas, images, captions, lists, and provenance', async () => {
    const fixture = await createFixture()
    const image = tinyPng()
    const contentList = Buffer.from(
      JSON.stringify([
        { type: 'text', text: 'Introduction', text_level: 1, page_idx: 0, bbox: [1, 2, 3, 4] },
        { type: 'text', text: 'Body paragraph', page_idx: 0, bbox: [5, 6, 7, 8] },
        {
          type: 'image',
          img_path: 'images/figure.png',
          image_caption: ['Figure 1'],
          page_idx: 1,
          bbox: [10, 20, 30, 40]
        },
        { type: 'table', table_body: '<table><tr><td>A</td></tr></table>', page_idx: 2 },
        { type: 'equation', text: '$$x^2$$', page_idx: 2 },
        { type: 'list', list_items: ['First', 'Second'], page_idx: 3 }
      ])
    )
    await publishRaw(fixture, { contentList, image })
    const service = new KnowledgeNormalizationService({
      ...fixture,
      log,
      createId: () => '44444444-4444-4444-8444-444444444444'
    })

    await service.normalize(parseRevisionId, new AbortController().signal)
    const run = fixture.database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM normalization_runs WHERE parse_revision_id = ?')
          .get(parseRevisionId) as Record<string, unknown>
    )
    expect(run).toMatchObject({
      state: 'published',
      normalizer_version: 1,
      block_count: 7,
      asset_count: 1
    })
    const active = fixture.database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM active_parse_revisions WHERE knowledge_item_id = ?')
          .get(knowledgeItemId) as Record<string, unknown>
    )
    expect(active).toMatchObject({ parse_revision_id: parseRevisionId })
    const relativePath = run.relative_path as string
    const blockLines = (
      await readFile(join(fixture.projectRoot, relativePath, 'blocks.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => normalizedKnowledgeBlockSchema.parse(JSON.parse(line)))
    expect(blockLines.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'image',
      'caption',
      'table',
      'formula',
      'list'
    ])
    expect(blockLines[1]?.headingPath).toEqual(['Introduction'])
    expect(blockLines[2]?.assetRefs[0]).toMatch(/^images\/[a-f0-9]{64}\.png$/)
    expect(blockLines.every((block, index) => block.ordinal === index)).toBe(true)
    expect(new Set(blockLines.map((block) => block.id)).size).toBe(blockLines.length)
    expect(fixture.jobs.list({ limit: 10 }).some((job) => job.type === 'rebuild_index')).toBe(true)
    fixture.database.close()
  })

  it('re-normalizes the same raw revision with a new version without re-upload', async () => {
    const fixture = await createFixture()
    await publishRaw(fixture, {
      contentList: Buffer.from(JSON.stringify([{ type: 'text', text: 'Versioned' }]))
    })
    const first = new KnowledgeNormalizationService({
      ...fixture,
      log,
      normalizerVersion: 1,
      createId: () => '44444444-4444-4444-8444-444444444444'
    })
    await first.normalize(parseRevisionId, new AbortController().signal)
    const second = new KnowledgeNormalizationService({
      ...fixture,
      log,
      normalizerVersion: 2,
      createId: () => '55555555-5555-4555-8555-555555555555'
    })
    await second.normalize(parseRevisionId, new AbortController().signal)

    const runs = fixture.database.immediate(
      (database) =>
        database
          .prepare(
            'SELECT normalizer_version, state FROM normalization_runs ORDER BY normalizer_version'
          )
          .all() as Array<Record<string, unknown>>
    )
    expect(runs).toEqual([
      { normalizer_version: 1, state: 'published' },
      { normalizer_version: 2, state: 'published' }
    ])
    const active = fixture.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT normalization_runs.normalizer_version FROM active_parse_revisions
             JOIN normalization_runs USING (normalization_run_id)`
          )
          .pluck()
          .get() as number
    )
    expect(active).toBe(2)
    fixture.database.close()
  })

  it('rejects escaped or missing assets and leaves the prior active revision unchanged', async () => {
    const fixture = await createFixture()
    await publishRaw(fixture, {
      contentList: Buffer.from(JSON.stringify([{ type: 'text', text: 'Valid active' }]))
    })
    const first = new KnowledgeNormalizationService({
      ...fixture,
      log,
      createId: () => '44444444-4444-4444-8444-444444444444'
    })
    await first.normalize(parseRevisionId, new AbortController().signal)

    const nextTask = '66666666-6666-4666-8666-666666666666'
    const nextRevision = '77777777-7777-4777-8777-777777777777'
    await publishRaw(
      fixture,
      {
        contentList: Buffer.from(
          JSON.stringify([{ type: 'image', img_path: '../../outside.png', page_idx: 0 }])
        )
      },
      nextTask,
      nextRevision,
      2
    )
    const invalid = new KnowledgeNormalizationService({
      ...fixture,
      log,
      createId: () => '88888888-8888-4888-8888-888888888888'
    })
    await expect(invalid.normalize(nextRevision, new AbortController().signal)).rejects.toThrow(
      'normalization failed'
    )
    const active = fixture.database.immediate(
      (database) =>
        database
          .prepare(
            'SELECT parse_revision_id FROM active_parse_revisions WHERE knowledge_item_id = ?'
          )
          .pluck()
          .get(knowledgeItemId) as string
    )
    expect(active).toBe(parseRevisionId)
    fixture.database.close()
  })

  it('rejects incomplete utility output before atomic publication and activation', async () => {
    const fixture = await createFixture()
    await publishRaw(fixture, {
      contentList: Buffer.from(JSON.stringify([{ type: 'text', text: 'Valid active' }]))
    })
    await new KnowledgeNormalizationService({
      ...fixture,
      log,
      createId: () => '44444444-4444-4444-8444-444444444444'
    }).normalize(parseRevisionId, new AbortController().signal)

    const nextTask = '66666666-6666-4666-8666-666666666666'
    const nextRevision = '77777777-7777-4777-8777-777777777777'
    await publishRaw(
      fixture,
      { contentList: Buffer.from(JSON.stringify([{ type: 'text', text: 'Candidate' }])) },
      nextTask,
      nextRevision,
      2
    )
    const incomplete = new KnowledgeNormalizationService({
      ...fixture,
      log,
      normalizeInUtility: async () => ({
        blocksSha256: 'e'.repeat(64),
        documentSha256: 'f'.repeat(64),
        blockCount: 1,
        assets: []
      }),
      createId: () => '88888888-8888-4888-8888-888888888888'
    })
    await expect(incomplete.normalize(nextRevision, new AbortController().signal)).rejects.toThrow(
      'normalization failed'
    )
    const active = fixture.database.immediate(
      (database) =>
        database
          .prepare(
            'SELECT parse_revision_id FROM active_parse_revisions WHERE knowledge_item_id = ?'
          )
          .pluck()
          .get(knowledgeItemId) as string
    )
    expect(active).toBe(parseRevisionId)
    fixture.database.close()
  })

  it.each([
    {
      label: 'multi-column PDF',
      source: { extension: 'pdf', mimeType: 'application/pdf' },
      blocks: [
        { type: 'text', text: 'Left column', page_idx: 0, bbox: [0, 0, 450, 900] },
        { type: 'text', text: 'Right column', page_idx: 0, bbox: [550, 0, 1000, 900] }
      ],
      expected: ['Left column', 'Right column']
    },
    {
      label: 'DOCX with a table',
      source: {
        extension: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      },
      blocks: [{ type: 'table', table_body: '<table><tr><td>DOCX</td></tr></table>' }],
      expected: ['<table><tr><td>DOCX</td></tr></table>']
    },
    {
      label: 'PPTX with a formula',
      source: {
        extension: 'pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      },
      blocks: [{ type: 'equation', text: '$$E=mc^2$$', page_idx: 2 }],
      expected: ['$$E=mc^2$$']
    },
    {
      label: 'scanned image OCR',
      source: { extension: 'png', mimeType: 'image/png' },
      blocks: [{ type: 'text', text: 'Scanned OCR text', page_idx: 0, bbox: [5, 10, 995, 990] }],
      expected: ['Scanned OCR text']
    }
  ])('normalizes representative $label output', async ({ source, blocks, expected }) => {
    const fixture = await createFixture(source)
    await publishRaw(fixture, { contentList: Buffer.from(JSON.stringify(blocks)) })
    const service = new KnowledgeNormalizationService({
      ...fixture,
      log,
      createId: () => '44444444-4444-4444-8444-444444444444'
    })

    await service.normalize(parseRevisionId, new AbortController().signal)
    const detail = await service.detail(knowledgeItemId)
    expect(detail.active?.blocks.map((block) => block.text)).toEqual(expected)
    expect(detail.active?.blocks.map((block) => block.ordinal)).toEqual(
      expected.map((_, index) => index)
    )
    fixture.database.close()
  })

  it('keeps the newer revision active when an older normalization finishes last', async () => {
    const fixture = await createFixture()
    await publishRaw(fixture, {
      contentList: Buffer.from(JSON.stringify([{ type: 'text', text: 'Original' }]))
    })
    const nextTask = '66666666-6666-4666-8666-666666666666'
    const nextRevision = '77777777-7777-4777-8777-777777777777'
    await publishRaw(
      fixture,
      { contentList: Buffer.from(JSON.stringify([{ type: 'text', text: 'Revised' }])) },
      nextTask,
      nextRevision,
      2
    )
    const started = deferred()
    const release = deferred()
    const older = new KnowledgeNormalizationService({
      ...fixture,
      log,
      normalizeInUtility: async (input, signal) => {
        started.resolve()
        await release.promise
        return fixture.normalizeInUtility(input, signal)
      }
    })
    const newer = new KnowledgeNormalizationService({ ...fixture, log })

    // The older revision's normalization is submitted first but completes after
    // the newer one; activation must remain monotonic in revision number.
    const pendingOlder = older.normalize(parseRevisionId, new AbortController().signal)
    await started.promise
    await newer.normalize(nextRevision, new AbortController().signal)
    release.resolve()
    await pendingOlder

    const active = fixture.database.immediate(
      (database) =>
        database
          .prepare(
            'SELECT parse_revision_id, normalization_run_id FROM active_parse_revisions WHERE knowledge_item_id = ?'
          )
          .get(knowledgeItemId) as Record<string, unknown>
    )
    expect(active.parse_revision_id).toBe(nextRevision)
    const runState = (revisionId: string) =>
      fixture.database.immediate((database) =>
        database
          .prepare('SELECT state FROM normalization_runs WHERE parse_revision_id = ?')
          .pluck()
          .get(revisionId)
      )
    expect(runState(parseRevisionId)).toBe('published')
    expect(runState(nextRevision)).toBe('published')
    fixture.database.close()
  })

  it('keeps a concurrent duplicate normalization of one revision consistent', async () => {
    const fixture = await createFixture()
    await publishRaw(fixture, {
      contentList: Buffer.from(JSON.stringify([{ type: 'text', text: 'Shared run' }]))
    })
    const started = deferred()
    const release = deferred()
    const blocked = new KnowledgeNormalizationService({
      ...fixture,
      log,
      normalizeInUtility: async (input, signal) => {
        started.resolve()
        await release.promise
        return fixture.normalizeInUtility(input, signal)
      }
    })
    const plain = new KnowledgeNormalizationService({ ...fixture, log })

    // Both normalizations share one normalization_runs row and one staging
    // directory; the loser must fail without downgrading the published run.
    const pendingBlocked = blocked.normalize(parseRevisionId, new AbortController().signal)
    await started.promise
    const runId = await plain.normalize(parseRevisionId, new AbortController().signal)
    release.resolve()
    await expect(pendingBlocked).rejects.toThrow('normalization failed')

    const runs = fixture.database.immediate(
      (database) =>
        database
          .prepare(
            'SELECT normalization_run_id, state, published_at FROM normalization_runs WHERE parse_revision_id = ?'
          )
          .all(parseRevisionId) as Array<Record<string, unknown>>
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ normalization_run_id: runId, state: 'published' })
    const activeRows = () =>
      fixture.database.immediate(
        (database) =>
          database
            .prepare(
              'SELECT parse_revision_id, normalization_run_id FROM active_parse_revisions WHERE knowledge_item_id = ?'
            )
            .all(knowledgeItemId) as Array<Record<string, unknown>>
      )
    expect(activeRows()).toEqual([
      { parse_revision_id: parseRevisionId, normalization_run_id: runId }
    ])

    // A retry reconciles the published output instead of activating twice.
    const again = await plain.normalize(parseRevisionId, new AbortController().signal)
    expect(again).toBe(runId)
    expect(activeRows()).toEqual([
      { parse_revision_id: parseRevisionId, normalization_run_id: runId }
    ])
    const runsAfter = fixture.database.immediate(
      (database) =>
        database
          .prepare(
            'SELECT normalization_run_id, state, published_at FROM normalization_runs WHERE parse_revision_id = ?'
          )
          .all(parseRevisionId) as Array<Record<string, unknown>>
    )
    expect(runsAfter).toEqual(runs)
    fixture.database.close()
  })
})

async function createFixture(
  source: { extension: string; mimeType: string } = {
    extension: 'pdf',
    mimeType: 'application/pdf'
  }
) {
  const root = await mkdtemp(join(tmpdir(), 'writellm-normalization-'))
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
  const now = new Date().toISOString()
  database.immediate((native) => {
    native
      .prepare(
        `INSERT INTO file_records (
           file_record_id, sha256, byte_size, mime_type, extension, relative_path, created_at
         ) VALUES ('source-file', ?, 100, ?, ?, ?, ?)`
      )
      .run(
        sourceHash,
        source.mimeType,
        source.extension,
        `knowledge/originals/source.${source.extension}`,
        now
      )
    native
      .prepare(
        `INSERT INTO knowledge_items (
           knowledge_item_id, file_record_id, original_name, display_name, state,
           error_code, created_at, updated_at
         ) VALUES (?, 'source-file', ?, ?, 'stored', NULL, ?, ?)`
      )
      .run(knowledgeItemId, `source.${source.extension}`, `source.${source.extension}`, now, now)
  })
  const jobs = new JobStore({ database, projectId: manifest.projectId, log })
  return { root, projectRoot, projectId: manifest.projectId, database, jobs, normalizeInUtility }
}

async function publishRaw(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: { contentList: Buffer; image?: Buffer },
  taskId = parseTaskId,
  revisionId = parseRevisionId,
  revisionNumber = 1
): Promise<void> {
  const relativePath = `knowledge/parsed/${knowledgeItemId}/${revisionId}`
  const rawPath = join(fixture.projectRoot, relativePath, 'raw', 'extracted')
  await mkdir(join(rawPath, 'images'), { recursive: true })
  const contentPath = 'raw/extracted/content_list.json'
  await writeFile(join(fixture.projectRoot, relativePath, contentPath), input.contentList)
  const files = [
    {
      relativePath: contentPath,
      sha256: hash(input.contentList),
      byteSize: input.contentList.byteLength
    }
  ]
  if (input.image !== undefined) {
    await writeFile(join(rawPath, 'images', 'figure.png'), input.image)
    files.push({
      relativePath: 'raw/extracted/images/figure.png',
      sha256: hash(input.image),
      byteSize: input.image.byteLength
    })
  }
  const rawManifest = mineruRawManifestSchema.parse({
    schemaVersion: 1,
    parseRevisionId: revisionId,
    knowledgeItemId,
    sourceSha256: sourceHash,
    providerId: 'mineru',
    providerApiVersion: 'v4',
    providerFingerprint,
    modelVersion: 'pipeline',
    remoteTaskId: `remote-${revisionNumber}`,
    archive: {
      relativePath: 'raw/provider-result.zip',
      sha256: 'c'.repeat(64),
      byteSize: 100
    },
    files,
    createdAt: new Date().toISOString()
  })
  const manifestBytes = Buffer.from(`${JSON.stringify(rawManifest)}\n`)
  await writeFile(join(fixture.projectRoot, relativePath, 'manifest.json'), manifestBytes)
  const now = new Date().toISOString()
  fixture.database.immediate((database) => {
    database
      .prepare(
        `INSERT INTO parse_tasks (
           parse_task_id, knowledge_item_id, source_file_record_id, provider_id,
           provider_fingerprint, model_version, state, remote_task_id, remote_state,
           created_at, updated_at, completed_at
         ) VALUES (?, ?, 'source-file', 'mineru', ?, 'pipeline', 'succeeded', ?, 'done', ?, ?, ?)`
      )
      .run(taskId, knowledgeItemId, providerFingerprint, `remote-${revisionNumber}`, now, now, now)
    database
      .prepare(
        `INSERT INTO parse_revisions (
           parse_revision_id, parse_task_id, knowledge_item_id, revision_number, state,
           source_sha256, provider_id, provider_api_version, provider_fingerprint,
           model_version, remote_task_id, relative_path, archive_sha256, archive_byte_size,
           expanded_byte_size, file_count, manifest_sha256, created_at, published_at, updated_at
         ) VALUES (?, ?, ?, ?, 'raw_published', ?, 'mineru', 'v4', ?, 'pipeline', ?, ?,
                   ?, 100, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        revisionId,
        taskId,
        knowledgeItemId,
        revisionNumber,
        sourceHash,
        providerFingerprint,
        `remote-${revisionNumber}`,
        relativePath,
        'c'.repeat(64),
        files.reduce((sum, file) => sum + file.byteSize, 0),
        files.length,
        hash(manifestBytes),
        now,
        now,
        now
      )
  })
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
}
