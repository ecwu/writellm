import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { openAppDatabase } from '../app-db/connection'
import { parseSkillDocument, SkillService } from './skill-service'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('SkillService', () => {
  it('installs the silent-E2E text fixture through the same bounded atomic publisher', async () => {
    const fixture = await createFixture()
    const service = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch)
    await service.initialize()
    await service.installE2eFixture({
      repository: 'writellm/e2e-writing',
      directory: 'e2e-writing',
      commit: 'e'.repeat(40),
      license: 'MIT',
      files: [
        {
          path: 'SKILL.md',
          bytes: Buffer.from(
            '---\r\nname: e2e-writing\r\ndescription: Deterministic fixture.\r\n---\r\nFixture body.'
          )
        }
      ]
    })

    const installed = service.snapshot().installed[0]
    expect(installed).toMatchObject({ name: 'e2e-writing', displayStatus: 'ready' })
    await expect(
      service.loadVersion(installed?.skillId ?? '', 'e'.repeat(40))
    ).resolves.toMatchObject({ name: 'e2e-writing', content: 'Fixture body.' })
    fixture.database.close()
  })

  it('inspects, pins, installs, loads, and revalidates a GitHub skill without exposing bodies', async () => {
    const fixture = await createFixture()
    const service = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch)
    await service.initialize()

    const inspected = await service.inspectGithub({
      repository: fixture.repository,
      directory: fixture.directory,
      operationId: crypto.randomUUID()
    })
    expect(inspected).toMatchObject({
      commit: fixture.commit,
      name: fixture.directory,
      fileCount: 2,
      license: 'MIT'
    })
    expect(JSON.stringify(inspected)).not.toContain('Use this skill')

    const installed = await service.installInspected(inspected.inspectionId)
    expect(installed.installed[0]).toMatchObject({
      enabled: true,
      displayStatus: 'ready',
      commit: fixture.commit
    })
    const loaded = await service.loadEnabled()
    expect(loaded[0]).toMatchObject({
      name: fixture.directory,
      content: '# Demo\n\nUse this skill.',
      filePath: `writellm://skills/${encodeURIComponent(installed.installed[0]?.skillId ?? '')}/${fixture.commit}/SKILL.md`
    })
    expect(loaded[0]?.filePath).not.toContain(fixture.skillRoot)

    const entry = loaded[0]?.files.find((file) => file.path === 'SKILL.md')
    if (entry === undefined || loaded[0] === undefined) throw new Error('Expected installed skill')
    const storedPath = join(
      fixture.skillRoot,
      encodeURIComponent(loaded[0].skillId),
      fixture.commit,
      'SKILL.md'
    )
    await writeFile(
      storedPath,
      Buffer.from((await readFile(storedPath)).toString().replace('Demo', 'Dome'))
    )
    await service.revalidateInstalled()
    expect(service.snapshot().installed[0]?.displayStatus).toBe('unavailable_integrity_failed')
    await expect(service.loadById(loaded[0].skillId)).rejects.toMatchObject({
      code: 'skill_unavailable'
    })
    fixture.database.close()
  })

  it('uses the full YAML parser and Pi-compatible frontmatter rules', () => {
    expect(
      parseSkillDocument(
        `---\nname: demo-skill\ndescription: >-\n  Draft evidence-backed prose\n  and revise citations.\ndisable-model-invocation: true\n---\nBody`,
        'demo-skill'
      )
    ).toEqual({
      name: 'demo-skill',
      description: 'Draft evidence-backed prose and revise citations.',
      body: 'Body',
      disableModelInvocation: true
    })
    expect(() => parseSkillDocument('---\nname: Demo\ndescription: x\n---\nBody', 'Demo')).toThrow()
    expect(() =>
      parseSkillDocument('---\nname: other\ndescription: x\n---\nBody', 'demo-skill')
    ).toThrowError('Skill name must match its directory name')
  })

  it('rejects references above 8 KiB before download', async () => {
    const reference = Buffer.alloc(8 * 1_024 + 1, 97)
    const fixture = await createFixture({ reference })
    const service = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch)
    await service.initialize()
    await expect(
      service.inspectGithub({
        repository: fixture.repository,
        directory: fixture.directory,
        operationId: crypto.randomUUID()
      })
    ).rejects.toMatchObject({ code: 'skill_reference_limit' })
    fixture.database.close()
  })

  it('rejects a raw entrypoint that fits 24 KiB when Pi formatting exceeds the limit', async () => {
    const header = `---\nname: demo-skill\ndescription: Demo skill.\n---\n`
    const skill = Buffer.from(`${header}${'x'.repeat(24 * 1_024 - Buffer.byteLength(header))}`)
    const fixture = await createFixture({ skill })
    const service = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch)
    await service.initialize()
    await expect(
      service.inspectGithub({
        repository: fixture.repository,
        directory: fixture.directory,
        operationId: crypto.randomUUID()
      })
    ).rejects.toMatchObject({ code: 'skill_entrypoint_limit' })
    fixture.database.close()
  })

  it('keeps a disabled skill disabled across a reinstall', async () => {
    const fixture = await createFixture()
    const service = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch)
    await service.initialize()

    const inspected = await service.inspectGithub({
      repository: fixture.repository,
      directory: fixture.directory,
      operationId: crypto.randomUUID()
    })
    const installed = await service.installInspected(inspected.inspectionId)
    const skillId = installed.installed[0]?.skillId ?? ''
    service.setEnabled(skillId, false, false)
    expect(service.snapshot().installed[0]?.enabled).toBe(false)

    await service.reinstall(skillId)
    expect(service.snapshot().installed[0]?.enabled).toBe(false)
    fixture.database.close()
  })

  it('restores the prior skill generation when publication fails after moving it aside', async () => {
    const fixture = await createFixture()
    const service = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch)
    await service.initialize()
    await service.installE2eFixture({
      repository: fixture.repository,
      directory: fixture.directory,
      commit: fixture.commit,
      license: 'MIT',
      files: [
        {
          path: 'SKILL.md',
          bytes: Buffer.from(
            '---\nname: demo-skill\ndescription: Original skill.\n---\nOriginal body.'
          )
        }
      ]
    })
    const installed = service.snapshot().installed[0]
    if (installed === undefined) throw new Error('Expected installed skill')
    const parent = join(fixture.skillRoot, encodeURIComponent(installed.skillId))
    const entrypoint = join(parent, fixture.commit, 'SKILL.md')
    const original = await readFile(entrypoint)
    const failing = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch, {
      beforePublishRename: () => {
        throw new Error('injected publication failure')
      }
    })

    await expect(
      failing.installE2eFixture({
        repository: fixture.repository,
        directory: fixture.directory,
        commit: fixture.commit,
        license: 'MIT',
        files: [
          {
            path: 'SKILL.md',
            bytes: Buffer.from(
              '---\nname: demo-skill\ndescription: Replacement skill.\n---\nReplacement body.'
            )
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'skill_install_failed' })

    expect(await readFile(entrypoint)).toEqual(original)
    expect(await readdir(parent)).toEqual([fixture.commit])
    fixture.database.close()
  })

  it('demotes a tampered skill during loadEnabled instead of rejecting every run', async () => {
    const fixture = await createFixture()
    const service = new SkillService(fixture.database, fixture.skillRoot, log, fixture.fetch)
    await service.initialize()
    const inspected = await service.inspectGithub({
      repository: fixture.repository,
      directory: fixture.directory,
      operationId: crypto.randomUUID()
    })
    const installed = await service.installInspected(inspected.inspectionId)
    const skillId = installed.installed[0]?.skillId ?? ''
    const revisions: number[] = []
    const unsubscribe = service.subscribe((revision) => revisions.push(revision))

    const storedPath = join(
      fixture.skillRoot,
      encodeURIComponent(skillId),
      fixture.commit,
      'SKILL.md'
    )
    await writeFile(
      storedPath,
      Buffer.from((await readFile(storedPath)).toString().replace('Demo', 'Dome'))
    )

    await expect(service.loadEnabled()).resolves.toEqual([])
    expect(service.snapshot().installed[0]?.displayStatus).toBe('unavailable_integrity_failed')
    expect(revisions).not.toHaveLength(0)
    await expect(service.loadById(skillId)).rejects.toMatchObject({ code: 'skill_unavailable' })
    unsubscribe()
    fixture.database.close()
  })
})

async function createFixture(options?: { skill?: Buffer; reference?: Buffer }): Promise<{
  database: Awaited<ReturnType<typeof openAppDatabase>>
  skillRoot: string
  repository: string
  directory: string
  commit: string
  fetch: typeof fetch
}> {
  const userData = await mkdtemp(join(tmpdir(), 'writellm-skills-'))
  temporaryDirectories.push(userData)
  const database = await openAppDatabase({
    path: join(userData, 'app.sqlite'),
    applicationVersion: 'test',
    log
  })
  const repository = 'owner/demo-repo'
  const directory = 'demo-skill'
  const commit = 'a'.repeat(40)
  const skill =
    options?.skill ??
    Buffer.from(
      '---\nname: demo-skill\ndescription: Demo writing skill.\n---\n# Demo\n\nUse this skill.'
    )
  const reference = options?.reference ?? Buffer.from('# Evidence\n\nPrefer direct evidence.')
  const files = new Map([
    [`${directory}/SKILL.md`, skill],
    [`${directory}/references/evidence.md`, reference]
  ])
  const fetchFixture = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.pathname === `/repos/${repository}`) {
      return Response.json({ default_branch: 'main', license: { spdx_id: 'MIT' } })
    }
    if (url.pathname === `/repos/${repository}/commits/main`) {
      return Response.json({ sha: commit })
    }
    if (url.pathname === `/repos/${repository}/git/trees/${commit}`) {
      return Response.json({
        truncated: false,
        tree: [...files].map(([path, bytes]) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: gitBlobSha(bytes),
          size: bytes.byteLength
        }))
      })
    }
    const rawPrefix = `/${repository}/${commit}/`
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith(rawPrefix)) {
      const path = decodeURIComponent(url.pathname.slice(rawPrefix.length))
      const bytes = files.get(path)
      if (bytes !== undefined) {
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: { 'content-length': String(bytes.length) }
        })
      }
    }
    return new Response('not found', { status: 404 })
  }
  return {
    database,
    skillRoot: join(userData, 'agent-skills'),
    repository,
    directory,
    commit,
    fetch: fetchFixture as typeof fetch
  }
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}
