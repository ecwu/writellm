import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyInventoryPaths } from './package-inventory.mjs'

const rootRequire = createRequire(import.meta.url)
const builderRequire = createRequire(rootRequire.resolve('electron-builder/package.json'))
const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher.js') as {
  FileMatcher: new (
    from: string,
    to: string,
    macroExpander: (pattern: string) => string,
    patterns?: string | string[] | null
  ) => { createFilter: () => (path: string, stats: { isDirectory: () => boolean }) => boolean }
}
const temporaryRoots: string[] = []

const completeInventory = new Set([
  'package.json',
  'out/main/index.js',
  'out/main/agent-worker.js',
  'out/main/background-worker.js',
  'out/main/index-worker.js',
  'out/main/logging-fixture.js',
  'out/preload/index.js',
  'out/renderer/index.html',
  'out/renderer/assets/index-fixture.js',
  'out/renderer/assets/pdf.worker.min-fixture.mjs',
  'node_modules/better-sqlite3/package.json',
  'node_modules/pino/package.json',
  'node_modules/pino-roll/package.json',
  'node_modules/thread-stream/package.json',
  'node_modules/@earendil-works/pi-ai/package.json',
  'node_modules/@ai-sdk/openai-compatible/package.json',
  'node_modules/@ai-sdk/cohere/package.json',
  'node_modules/@google/genai/package.json'
])

describe('package inventory', () => {
  it('accepts the complete runtime inventory', () => {
    expect(() => verifyInventoryPaths(completeInventory)).not.toThrow()
  })

  it('fails closed for missing workers, lazy dependencies, and source content', () => {
    const missingWorker = new Set(completeInventory)
    missingWorker.delete('out/main/agent-worker.js')
    expect(() => verifyInventoryPaths(missingWorker)).toThrow('agent-worker.js')

    const missingProvider = new Set(completeInventory)
    missingProvider.delete('node_modules/@google/genai/package.json')
    expect(() => verifyInventoryPaths(missingProvider)).toThrow('@google/genai')

    const sourceContent = new Set(completeInventory)
    sourceContent.add('src/main/index.ts')
    expect(() => verifyInventoryPaths(sourceContent)).toThrow('source-tree content')
  })

  it('applies the electron-builder node-module exclusions while retaining runtime files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-package-filter-'))
    temporaryRoots.push(root)
    const paths = [
      'node_modules/better-sqlite3/deps/sqlite3/sqlite3.c',
      'node_modules/better-sqlite3/src/better_sqlite3.cpp',
      'node_modules/better-sqlite3/build/Release/obj/gen/sqlite3/sqlite3.c',
      'node_modules/better-sqlite3/build/Release/.deps/addon.d',
      'node_modules/better-sqlite3/build/Release/test_extension.node',
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'node_modules/better-sqlite3/lib/index.js',
      'node_modules/better-sqlite3/package.json',
      'node_modules/example/dist/index.js.map',
      'node_modules/example/dist/index.d.ts',
      'node_modules/example/dist/index.d.mts',
      'node_modules/example/dist/index.d.cts'
    ]
    for (const path of paths) {
      const file = join(root, path)
      await mkdir(resolve(file, '..'), { recursive: true })
      await writeFile(file, '')
    }

    const config = parse(await readFile(resolve('electron-builder.yml'), 'utf8')) as {
      files?: unknown[]
    }
    const exclusions = (config.files ?? []).filter(
      (pattern): pattern is string => typeof pattern === 'string' && pattern.startsWith('!')
    )
    const matcher = new FileMatcher(root, 'app', (pattern) => pattern, ['**/*', ...exclusions])
    const filter = matcher.createFilter()
    const matches = (path: string) => {
      const file = join(root, path)
      return filter(file, statSync(file))
    }

    expect(matches('node_modules/better-sqlite3/deps/sqlite3/sqlite3.c')).toBe(false)
    expect(matches('node_modules/better-sqlite3/src/better_sqlite3.cpp')).toBe(false)
    expect(matches('node_modules/better-sqlite3/build/Release/obj/gen/sqlite3/sqlite3.c')).toBe(
      false
    )
    expect(matches('node_modules/better-sqlite3/build/Release/.deps/addon.d')).toBe(false)
    expect(matches('node_modules/better-sqlite3/build/Release/test_extension.node')).toBe(false)
    expect(matches('node_modules/better-sqlite3/build/Release/better_sqlite3.node')).toBe(true)
    expect(matches('node_modules/better-sqlite3/lib/index.js')).toBe(true)
    expect(matches('node_modules/better-sqlite3/package.json')).toBe(true)
    expect(matches('node_modules/example/dist/index.js.map')).toBe(false)
    expect(matches('node_modules/example/dist/index.d.ts')).toBe(false)
    expect(matches('node_modules/example/dist/index.d.mts')).toBe(false)
    expect(matches('node_modules/example/dist/index.d.cts')).toBe(false)
  })
})

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})
