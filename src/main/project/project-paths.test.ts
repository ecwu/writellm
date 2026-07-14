import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeProjectRelativePath,
  resolveExistingProjectPath,
  resolveProjectPath
} from './project-paths'

const temporaryDirectories: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-paths-'))
  temporaryDirectories.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('project paths', () => {
  it('supports normalized Unicode relative paths and Unicode roots', async () => {
    const parent = await temporaryRoot()
    const root = join(parent, '中文 项目')
    await mkdir(root)
    const relativePath = 'manuscript/sections/第一章.json'
    expect(normalizeProjectRelativePath(relativePath)).toBe(relativePath)
    expect(resolveProjectPath(root, relativePath)).toBe(join(root, ...relativePath.split('/')))
  })

  it.each([
    '',
    '/etc/passwd',
    'C:\\Windows\\system32',
    '\\\\server\\share\\file',
    '../outside',
    'folder/../outside',
    './file',
    'folder//file',
    'folder\\file',
    `folder/\0file`
  ])('rejects unsafe stored path %j', (value) => {
    expect(() => normalizeProjectRelativePath(value)).toThrow()
  })

  it('rejects an existing symbolic-link escape', async () => {
    const parent = await temporaryRoot()
    const root = join(parent, 'project')
    const outside = join(parent, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(root, 'linked'))

    await expect(resolveExistingProjectPath(root, 'linked/secret.txt')).rejects.toThrow(
      'symbolic link'
    )
  })
})
