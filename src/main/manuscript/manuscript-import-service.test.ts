import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import pino from 'pino'
import type { Logger } from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZipFile } from 'yazl'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { ProjectFilesystem } from '../project/project-filesystem'
import type { ProjectContext } from '../project/project-context'
import type { ProjectManifest } from '../project/project-manifest'
import { ManuscriptAssetService } from './asset-service'
import { EditorPersistenceService } from './editor-persistence-service'
import { parseLatexImport } from '../../workers/latex-import-parser'
import { ManuscriptImportService } from './manuscript-import-service'
import { ManuscriptService } from './manuscript-service'

const roots: string[] = []
const databases: ProjectDatabase[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ManuscriptImportService', () => {
  it('captures one hashed plan, deduplicates assets, and atomically creates Main-owned sections', async () => {
    const fixture = await createFixture()
    const sourceDirectory = await mkdtemp(join(tmpdir(), 'writellm-import-source-'))
    roots.push(sourceDirectory)
    await writeFile(join(sourceDirectory, '图.png'), png(32, 24))
    const sourcePath = join(sourceDirectory, '论文 café.md')
    await writeFile(
      sourcePath,
      '# 第一章\n\n你好 **world**.\n\n![图一](%E5%9B%BE.png)\n\n# Chapter 2\n\nAgain ![duplicate](%E5%9B%BE.png)\n'
    )

    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath,
      activeSectionId: fixture.active.section.sectionId
    })
    expect(plan.source.displayName).toBe('论文 café.md')
    expect(plan.source.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(plan.sections.map((section) => section.title)).toEqual(['第一章', 'Chapter 2'])
    expect(plan.assets).toHaveLength(1)
    expect(plan.noOp).toBe(false)

    const result = await fixture.imports.apply(fixture.context, {
      projectSessionId: fixture.context.projectSessionId,
      planId: plan.planId,
      mode: 'create_sections'
    })
    expect(result.sourceHash).toBe(plan.source.sha256)
    expect(result.createdSectionIds).toHaveLength(2)
    expect(result.createdSectionIds).not.toContain(plan.sections[0]?.proposedSectionId)
    expect(fixture.manuscript.assemble().sections).toHaveLength(3)
    await expect(
      access(join(fixture.projectRoot, '.writellm/temp/manuscript-import', plan.planId))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('revalidates active revision and leaves the reviewed plan cancellable after a stale apply', async () => {
    const fixture = await createFixture()
    const source = join(fixture.root, 'stale.md')
    await writeFile(source, '# Imported\n\nreviewed')
    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: source,
      activeSectionId: fixture.active.section.sectionId
    })
    await fixture.persistence.save({
      projectSessionId: fixture.context.projectSessionId,
      sectionId: fixture.active.section.sectionId,
      baseRevisionId: fixture.active.revision.sectionRevisionId,
      baseContentHash: fixture.active.revision.contentHash,
      document: [paragraph('concurrent', 'changed')]
    })
    await expect(
      fixture.imports.apply(fixture.context, {
        projectSessionId: fixture.context.projectSessionId,
        planId: plan.planId,
        mode: 'replace_active_section'
      })
    ).rejects.toThrow('changed')
    await expect(fixture.imports.cancel(fixture.context, plan.planId)).resolves.toEqual({
      status: 'cancelled'
    })
  })

  it('stages LaTeX through the bounded projection and creates editable hierarchical import revisions', async () => {
    const fixture = await createFixture()
    const source = join(fixture.root, '论文.tex')
    await writeFile(
      source,
      String.raw`\title{可编辑研究}
\begin{document}
\chapter{Opening}
Hello \textbf{world} with $x^2$.
\section{Evidence}
\begin{equation}E = mc^2\end{equation}
\cite{unresolved}
\end{document}`
    )

    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: source,
      activeSectionId: fixture.active.section.sectionId
    })
    expect(plan.source.format).toBe('latex')
    expect(plan.proposedBrief.title).toBe('可编辑研究')
    expect(plan.sections.map(({ title, outlineLevel }) => [title, outlineLevel])).toEqual([
      ['Opening', 1],
      ['Evidence', 2]
    ])
    expect(plan.unsupported).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'citation_unresolved' })])
    )

    const result = await fixture.imports.apply(fixture.context, {
      projectSessionId: fixture.context.projectSessionId,
      planId: plan.planId,
      mode: 'create_sections'
    })
    const imported = fixture.manuscript
      .assemble()
      .sections.filter((item) => result.createdSectionIds.includes(item.section.sectionId))
    expect(imported.map((item) => item.section.title)).toEqual(['Opening', 'Evidence'])
    expect(imported[1]?.section.parentSectionId).toBe(imported[0]?.section.sectionId)
    expect(imported.every((item) => item.revision.sourceClass === 'import')).toBe(true)
    expect(JSON.stringify(imported[1]?.revision.content)).toContain('E = mc^{2}')
  })

  it('captures a contained LaTeX project with includes, bibliography, table, and registered figure', async () => {
    const fixture = await createFixture()
    const project = join(fixture.root, 'latex-project')
    await mkdir(join(project, 'chapters'), { recursive: true })
    await mkdir(join(project, 'images'))
    await writeFile(
      join(project, 'main.tex'),
      String.raw`\title{Project study}
\begin{document}
\input{chapters/results}
\end{document}`
    )
    await writeFile(
      join(project, 'chapters/results.tex'),
      String.raw`\section{Results}
Evidence from \cite{garcia2025}.
\begin{table}\caption{Measurements}\begin{tabular}{lc}Name & Value \\ Alpha & 2\end{tabular}\end{table}
\begin{figure}\includegraphics{../images/plot.png}\caption{Observed result}\label{fig:plot}\end{figure}`
    )
    await writeFile(
      join(project, 'references.bib'),
      '@article{garcia2025,title={Result},author={García, Ana},year={2025}}'
    )
    await writeFile(join(project, 'images/plot.png'), png(48, 32))

    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: project,
      activeSectionId: fixture.active.section.sectionId
    })
    expect(plan.source.format).toBe('latex-project')
    expect(plan.proposedBrief.title).toBe('Project study')
    expect(plan.assets).toEqual([
      expect.objectContaining({ displayName: 'plot.png', mimeType: 'image/png' })
    ])
    expect(JSON.stringify(plan.sections)).toContain('(García, 2025)')
    expect(plan.sections[0]?.document.map((block) => block.type)).toEqual(
      expect.arrayContaining(['table', 'image'])
    )

    const result = await fixture.imports.apply(fixture.context, {
      projectSessionId: fixture.context.projectSessionId,
      planId: plan.planId,
      mode: 'create_sections'
    })
    const imported = fixture.manuscript
      .assemble()
      .sections.find((item) => result.createdSectionIds.includes(item.section.sectionId))
    expect(imported?.revision.sourceClass).toBe('import')
    expect(imported?.revision.content.map((block) => block.type)).toEqual(
      expect.arrayContaining(['table', 'image'])
    )
  })

  it('extracts a bounded LaTeX ZIP into the same deterministic project plan', async () => {
    const fixture = await createFixture()
    const archive = join(fixture.root, 'portable.zip')
    await createZip(archive, [
      ['main.tex', String.raw`\title{Portable}\begin{document}\input{body}\end{document}`],
      ['body.tex', String.raw`\section{Portable body}See \cite{portable}.`],
      ['references.bib', '@book{portable,title={Portable},author={Núñez, Mei},year={2026}}']
    ])
    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: archive,
      activeSectionId: fixture.active.section.sectionId
    })
    expect(plan.source).toMatchObject({ displayName: 'portable.zip', format: 'latex-project' })
    expect(plan.sections[0]?.title).toBe('Portable body')
    expect(JSON.stringify(plan.sections)).toContain('(Núñez, 2026)')
  })

  it('revalidates every captured LaTeX project dependency before applying', async () => {
    const fixture = await createFixture()
    const project = join(fixture.root, 'tamper-project')
    await mkdir(project)
    await writeFile(
      join(project, 'main.tex'),
      String.raw`\begin{document}\input{body}\end{document}`
    )
    await writeFile(join(project, 'body.tex'), String.raw`\section{Body}Reviewed source.`)
    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: join(project, 'main.tex'),
      activeSectionId: fixture.active.section.sectionId
    })
    await writeFile(
      join(
        fixture.projectRoot,
        '.writellm/temp/manuscript-import',
        plan.planId,
        'project/body.tex'
      ),
      'changed after review'
    )
    await expect(
      fixture.imports.apply(fixture.context, {
        projectSessionId: fixture.context.projectSessionId,
        planId: plan.planId,
        mode: 'create_sections'
      })
    ).rejects.toThrow('no longer matches')
  })

  it('rejects links and oversized sources, reports traversal as a loss, and cleans crash staging', async () => {
    const fixture = await createFixture()
    const staleDirectory = join(fixture.projectRoot, '.writellm/temp/manuscript-import/stale')
    await mkdir(staleDirectory, { recursive: true })
    await writeFile(join(staleDirectory, 'source.md'), 'stale')

    const target = join(fixture.root, 'target.md')
    const link = join(fixture.root, 'linked.md')
    await writeFile(target, '# linked')
    await symlink(target, link)
    await expect(
      fixture.imports.createPlan({
        context: fixture.context,
        sourcePath: link,
        activeSectionId: fixture.active.section.sectionId
      })
    ).rejects.toThrow('symbolic link')

    const oversized = join(fixture.root, 'large.md')
    await writeFile(oversized, Buffer.alloc(8 * 1024 * 1024 + 1, 0x61))
    await expect(
      fixture.imports.createPlan({
        context: fixture.context,
        sourcePath: oversized,
        activeSectionId: fixture.active.section.sectionId
      })
    ).rejects.toThrow('8 MiB')

    const traversal = join(fixture.root, 'traversal.md')
    await writeFile(traversal, '![escape](../secret.png)')
    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: traversal,
      activeSectionId: fixture.active.section.sectionId
    })
    expect(plan.losses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'image_not_imported' })])
    )
    expect(plan.assets).toHaveLength(0)
    await expect(access(staleDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps published resources orphaned when later mapping fails and revokes plans on switch', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.root, 'figure.png'), png(16, 16))
    const failing = join(fixture.root, 'partial.md')
    await writeFile(failing, `![figure](figure.png)\n\n${'x'.repeat(2_200_000)}`)
    await expect(
      fixture.imports.createPlan({
        context: fixture.context,
        sourcePath: failing,
        activeSectionId: fixture.active.section.sectionId
      })
    ).rejects.toThrow(/too large/iu)
    expect(
      fixture.database.immediate((database) =>
        database.prepare('SELECT COUNT(*) FROM manuscript_assets').pluck().get()
      )
    ).toBe(1)

    const valid = join(fixture.root, 'valid.md')
    await writeFile(valid, '# Valid\n\nbody')
    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: valid,
      activeSectionId: fixture.active.section.sectionId
    })
    fixture.imports.revokeSession(fixture.context.projectSessionId)
    await expect(
      fixture.imports.apply(fixture.context, {
        projectSessionId: fixture.context.projectSessionId,
        planId: plan.planId,
        mode: 'create_sections'
      })
    ).rejects.toThrow('does not exist')
  })

  it('logs staging and apply-failure lifecycle events with safe fields', async () => {
    const importLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const fixture = await createFixture(importLog)
    const source = join(fixture.root, 'logged.md')
    await writeFile(source, '# Logged\n\nbody')
    const plan = await fixture.imports.createPlan({
      context: fixture.context,
      sourcePath: source,
      activeSectionId: fixture.active.section.sectionId
    })
    expect(importLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.import.staged',
        planId: plan.planId,
        format: 'markdown',
        fileCount: 1
      }),
      expect.any(String)
    )
    expect(importLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'manuscript.import.plan_created', planId: plan.planId }),
      expect.any(String)
    )

    await expect(
      fixture.imports.apply(fixture.context, {
        projectSessionId: fixture.context.projectSessionId,
        planId: crypto.randomUUID(),
        mode: 'create_sections'
      })
    ).rejects.toThrow('does not exist')
    expect(importLog.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'manuscript.import.apply_failed',
        err: expect.any(Error),
        mode: 'create_sections'
      }),
      expect.any(String)
    )
    expect(JSON.stringify(importLog.info.mock.calls)).not.toContain(fixture.projectRoot)
  })
})

async function createFixture(importLog: Pick<Logger, 'info' | 'warn' | 'error'> = log) {
  const root = await mkdtemp(join(tmpdir(), 'writellm-import-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: crypto.randomUUID(),
    createdAt: '2026-08-13T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'import-test',
    log
  })
  databases.push(database)
  const manuscript = new ManuscriptService({ database, projectId: manifest.projectId, log })
  const persistence = new EditorPersistenceService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    manuscript,
    log
  })
  const assets = new ManuscriptAssetService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    log
  })
  const filesystem = new ProjectFilesystem(projectRoot, log)
  const active = persistence.openEditor().activeSection
  if (active === null) throw new Error('Missing initial section')
  const context = {
    projectRoot,
    filesystem,
    manifest,
    projectSessionId: crypto.randomUUID(),
    displayName: 'Import test',
    indexRebuildRequired: false,
    database,
    manuscript,
    editorPersistence: persistence,
    manuscriptAssets: assets
  } as unknown as ProjectContext
  return {
    root,
    projectRoot,
    database,
    manuscript,
    persistence,
    active,
    context,
    imports: new ManuscriptImportService({
      log: importLog,
      parseLatex: async ({ source, sourceHash, project }) =>
        parseLatexImport({
          type: 'latex-import-parse',
          requestId: crypto.randomUUID(),
          sourceHash,
          source,
          project
        })
    })
  }
}

function paragraph(id: string, value: string) {
  return {
    id,
    type: 'paragraph' as const,
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
    content: [{ type: 'text' as const, text: value, styles: {} }],
    children: []
  }
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

async function createZip(
  path: string,
  entries: Array<[name: string, content: string]>
): Promise<void> {
  const zip = new ZipFile()
  for (const [name, content] of entries) zip.addBuffer(Buffer.from(content), name)
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
}
