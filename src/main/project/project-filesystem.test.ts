import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectFilesystem } from './project-filesystem'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('ProjectFilesystem', () => {
  it('rejects a symbolic-link parent before deleting an external tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-project-filesystem-'))
    const outside = await mkdtemp(join(tmpdir(), 'writellm-project-filesystem-outside-'))
    directories.push(root, outside)
    await mkdir(join(root, '.writellm'))
    await writeFile(join(outside, 'sentinel.txt'), 'outside')
    await symlink(outside, join(root, '.writellm', 'temp'))
    const log = { warn: vi.fn() }
    const filesystem = new ProjectFilesystem(root, log)

    await expect(filesystem.removeTree('.writellm/temp/artifacts')).rejects.toMatchObject({
      code: 'path_symbolic_link'
    })
    expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('outside')
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.project_path_rejected',
        code: 'path_symbolic_link'
      }),
      expect.any(String)
    )
  })

  it('creates managed ancestors one segment at a time and removes nested links without following them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-project-filesystem-'))
    const outside = await mkdtemp(join(tmpdir(), 'writellm-project-filesystem-outside-'))
    directories.push(root, outside)
    await writeFile(join(outside, 'sentinel.txt'), 'outside')
    const filesystem = new ProjectFilesystem(root)
    const staging = await filesystem.ensureDirectory('.writellm/temp/staging')
    await writeFile(join(staging, 'inside.txt'), 'inside')
    await symlink(join(outside, 'sentinel.txt'), join(staging, 'external-link'))

    await filesystem.removeTree('.writellm/temp/staging')

    expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('outside')
    await expect(
      filesystem.assertExistingDirectory('.writellm/temp/staging')
    ).rejects.toMatchObject({
      code: 'path_missing'
    })
  })

  it.each([
    ['project metadata root', '.writellm', '.writellm/temp', 'ensure'],
    ['knowledge revision', 'knowledge/parsed/revision-1', 'knowledge/parsed/revision-1', 'remove'],
    [
      'archive extraction root',
      'knowledge/parsed/revision-1/raw/extracted',
      'knowledge/parsed/revision-1/raw/extracted',
      'fresh'
    ]
  ] as const)('rejects a linked %s boundary', async (_label, linkedPath, operationPath, operation) => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-project-filesystem-'))
    const outside = await mkdtemp(join(tmpdir(), 'writellm-project-filesystem-outside-'))
    directories.push(root, outside)
    await writeFile(join(outside, 'sentinel.txt'), 'outside')
    const parentSegments = linkedPath.split('/').slice(0, -1)
    if (parentSegments.length > 0) {
      await mkdir(join(root, ...parentSegments), { recursive: true })
    }
    await symlink(outside, join(root, ...linkedPath.split('/')))
    const filesystem = new ProjectFilesystem(root)

    const action =
      operation === 'ensure'
        ? filesystem.ensureDirectory(operationPath)
        : operation === 'remove'
          ? filesystem.removeTree(operationPath)
          : filesystem.createFreshDirectory(operationPath)
    await expect(action).rejects.toMatchObject({ code: 'path_symbolic_link' })
    expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('outside')
  })
})
