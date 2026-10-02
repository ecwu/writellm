import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveBetterSqlite3Binary } from './better-sqlite3-binary.mjs'

const roots: string[] = []
async function fixture(paths: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-sqlite-binary-'))
  roots.push(root)
  for (const path of paths) {
    const file = join(root, path)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, '')
  }
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it.each(['darwin', 'win32', 'linux'])(
  'selects the %s prebuild before a source build',
  async (platform) => {
    const prebuild = `prebuilds/${platform}-arm64.node`
    const root = await fixture([prebuild, 'build/Release/better_sqlite3.node'])
    expect(resolveBetterSqlite3Binary(root, { platform, arch: 'arm64' })).toBe(join(root, prebuild))
  }
)
it('selects the musl build instead of the glibc build', async () => {
  const root = await fixture(['prebuilds/linux-x64.node', 'prebuilds/linuxmusl-x64.node'])
  expect(resolveBetterSqlite3Binary(root, { platform: 'linux', arch: 'x64' }, true)).toBe(
    join(root, 'prebuilds/linuxmusl-x64.node')
  )
})
it('uses Debug then Release when no target prebuild exists', async () => {
  const root = await fixture([
    'build/Debug/better_sqlite3.node',
    'build/Release/better_sqlite3.node'
  ])
  const target = { platform: 'darwin', arch: 'x64' }
  expect(resolveBetterSqlite3Binary(root, target)).toBe(
    join(root, 'build/Debug/better_sqlite3.node')
  )
  await rm(join(root, 'build/Debug/better_sqlite3.node'))
  expect(resolveBetterSqlite3Binary(root, target)).toBe(
    join(root, 'build/Release/better_sqlite3.node')
  )
})
it('rejects a package that only contains another architecture', async () => {
  const root = await fixture(['prebuilds/darwin-x64.node'])
  expect(() => resolveBetterSqlite3Binary(root, { platform: 'darwin', arch: 'arm64' })).toThrow(
    'no native binary'
  )
})
