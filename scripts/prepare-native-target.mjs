import { spawnSync } from 'node:child_process'
import { readFile, rm, mkdir, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { getLoadablePath } from 'sqlite-vec'
import { assertNativeBinaryArchitecture } from './native-binary.mjs'
import {
  assertNativePackageHost,
  currentPackageTarget,
  resolvePackageTarget
} from './package-targets.mjs'

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

// Electron 43's GCC build path is incompatible with its V8 deprecation
// attribute ordering. Removing only that warning define keeps the ABI and
// source unchanged while allowing better-sqlite3 to compile on Debian/WSL.
if (process.platform === 'linux' && !process.env.CXXFLAGS?.includes('-UV8_DEPRECATION_WARNINGS')) {
  process.env.CXXFLAGS = `${process.env.CXXFLAGS ?? ''} -UV8_DEPRECATION_WARNINGS`.trim()
}
const install = process.argv.includes('--install')
const allowedArguments = new Set([
  '--install',
  ...(targetArgument === undefined ? [] : [targetArgument])
])
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument))
    throw new Error(`Unknown native-preparation argument ${argument}`)
}
assertNativePackageHost(target)

if (install) {
  run(process.execPath, [electronBuilderCli, 'install-app-deps', '--arch', target.arch])
}

const addon = resolve('node_modules/better-sqlite3/build/Release/better_sqlite3.node')
let addonProbe = probeAddon(addon)
if (!addonProbe.ok && install) {
  await rebuild({
    buildPath: resolve('.'),
    electronVersion: rootPackage.devDependencies.electron,
    platform: target.platform,
    arch: target.arch,
    onlyModules: ['better-sqlite3'],
    force: true
  })
  addonProbe = probeAddon(addon)
}
if (!addonProbe.ok) {
  throw new Error(
    `better-sqlite3 is not loadable in Electron ${process.versions.electron ?? '43'}: ${addonProbe.message}`
  )
}
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

process.stdout.write(
  `${JSON.stringify({
    target: target.id,
    electron: rootPackage.devDependencies.electron,
    electronAbi: electronProbe('process.versions.modules'),
    betterSqlite3: rootPackage.dependencies['better-sqlite3'],
    betterSqlite3Format: addonInspection.format,
    sqliteVec: rootPackage.dependencies['sqlite-vec'],
    sqliteVecFormat: sqliteVecInspection.format,
    sqliteVecResource: `native/sqlite-vec/${target.platform}-${target.arch}/${basename(sqliteVecSource)}`
  })}\n`
)

function probeAddon(path) {
  const expression = `require(${JSON.stringify(path)}); process.stdout.write(process.versions.modules)`
  const result = spawnElectron(['-e', expression], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
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

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
  }
}
