import { spawnSync } from 'node:child_process'
import { readFile, rm, mkdir, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { getLoadablePath } from 'sqlite-vec'
import { assertNativeBinaryArchitecture } from './native-binary.mjs'
import { isLinuxMusl, resolveBetterSqlite3Binary } from './better-sqlite3-binary.mjs'
import {
  assertNativePackageHost,
  currentPackageTarget,
  resolvePackageTarget
} from './package-targets.mjs'
import { VerificationRun } from './verification-run.mjs'

const require = createRequire(import.meta.url)
const rootPackage = require('../package.json')
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const { rebuild } = builderRequire('@electron/rebuild')
const electronBinary = require('electron')
const electronBuilderCli = require.resolve('electron-builder/cli.js')
const targetArgument = process.argv.find((argument) => argument.startsWith('--target='))
const target = resolvePackageTarget(
  targetArgument?.slice('--target='.length) ?? currentPackageTarget().id
)

const workspaceRoot = resolve('.')
const writableCacheRoot = join(workspaceRoot, '.cache', 'native')
const writableTempRoot = join(writableCacheRoot, 'tmp')
const writableNodeGypRoot = join(writableCacheRoot, 'node-gyp')
await mkdir(writableTempRoot, { recursive: true })
await mkdir(writableNodeGypRoot, { recursive: true })

// Codex and some WSL integrations expose a Windows TEMP path to Linux Node.
// Electron's native rebuild must use a Linux-writable temporary directory.
if (
  process.platform === 'linux' &&
  (process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP)?.startsWith('/mnt/')
) {
  process.env.TMPDIR = writableTempRoot
  process.env.TMP = writableTempRoot
  process.env.TEMP = writableTempRoot
}
process.env.npm_config_devdir ??= writableNodeGypRoot

const force = process.argv.includes('--force')
const allowedArguments = new Set([
  '--install',
  '--force',
  ...(targetArgument === undefined ? [] : [targetArgument])
])
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument))
    throw new Error(`Unknown native-preparation argument ${argument}`)
}
assertNativePackageHost(target)

const verification = new VerificationRun('native-prepare')
let failure
try {
  const addonRoot = resolve('node_modules/better-sqlite3')
  let addonProbe = probeAddon(addonRoot)
  if (!addonProbe.ok && !force) {
    await verification.command('native-install', process.execPath, [
      electronBuilderCli,
      'install-app-deps',
      '--arch',
      target.arch
    ])
    addonProbe = probeAddon(addonRoot)
  }
  if (!addonProbe.ok || force) {
    process.env.npm_config_force_build = '1'
    await verification.stage('native-rebuild', () =>
      rebuild({
        buildPath: resolve('.'),
        electronVersion: rootPackage.devDependencies.electron,
        platform: target.platform,
        arch: target.arch,
        onlyModules: ['better-sqlite3'],
        force: true
      })
    )
    addonProbe = probeAddon(addonRoot)
  }
  if (!addonProbe.ok) {
    throw new Error(
      `better-sqlite3 is not loadable in Electron ${rootPackage.devDependencies.electron}: ${addonProbe.message}`
    )
  }
  const addon = resolveBetterSqlite3Binary(addonRoot, target, isLinuxMusl())
  const addonInspection = assertNativeBinaryArchitecture(
    await readFile(addon),
    target.arch,
    'better-sqlite3'
  )

  const sqliteVecSource = getLoadablePath()
  const sqliteVecBytes = await readFile(sqliteVecSource)
  const sqliteVecInspection = assertNativeBinaryArchitecture(
    sqliteVecBytes,
    target.arch,
    'sqlite-vec'
  )
  const sqliteVecRoot = resolve('resources/native/sqlite-vec')
  const sqliteVecDirectory = join(sqliteVecRoot, `${target.platform}-${target.arch}`)
  await rm(sqliteVecDirectory, { recursive: true, force: true })
  await mkdir(sqliteVecDirectory, { recursive: true })
  const sqliteVecDestination = join(sqliteVecDirectory, basename(sqliteVecSource))
  await copyFile(sqliteVecSource, sqliteVecDestination)
  await verification.command(
    'native-load-check',
    electronBinary,
    [
      '-e',
      `const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.loadExtension(${JSON.stringify(sqliteVecDestination)}); db.prepare('SELECT vec_version()').get(); db.close()`
    ],
    { env: { ELECTRON_RUN_AS_NODE: '1' } }
  )

  process.stdout.write(
    `${JSON.stringify({
      target: target.id,
      electron: rootPackage.devDependencies.electron,
      electronAbi: electronProbe('process.versions.modules'),
      betterSqlite3: rootPackage.dependencies['better-sqlite3'],
      betterSqlite3Format: addonInspection.format,
      betterSqlite3Binary: addon.slice(addonRoot.length + 1),
      nodeApi: electronProbe('process.versions.napi'),
      sqliteVec: rootPackage.dependencies['sqlite-vec'],
      sqliteVecFormat: sqliteVecInspection.format,
      sqliteVecResource: `native/sqlite-vec/${target.platform}-${target.arch}/${basename(sqliteVecSource)}`
    })}\n`
  )
} catch (error) {
  failure = error
} finally {
  await verification.finish(failure)
}

function probeAddon(path) {
  const expression = `const Database = require(${JSON.stringify(path)}); const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close(); process.stdout.write(process.versions.napi)`
  const result = spawnElectron(['-e', expression], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  return result.status === 0
    ? { ok: true, message: result.stdout.trim() }
    : { ok: false, message: `${result.stderr ?? result.stdout}`.trim() }
}

function electronProbe(expression) {
  const result = spawnElectron(['-p', expression], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Electron probe failed: ${`${result.stderr ?? result.stdout}`.trim()}`)
  }
  return result.stdout.trim()
}

function spawnElectron(args, options) {
  return spawnSync(electronBinary, args, options)
}
