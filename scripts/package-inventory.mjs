import { createHash } from 'node:crypto'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, relative, resolve, sep } from 'node:path'
import { assertNativeBinaryArchitecture } from './native-binary.mjs'
import { resolvePackageTarget } from './package-targets.mjs'
import { resolveReleaseMetadata } from './release-version.mjs'

const require = createRequire(import.meta.url)
const rootPackage = require('../package.json')
const releaseMetadata = resolveReleaseMetadata(rootPackage)
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const { extractFile, listPackage } = builderRequire('@electron/asar')

export async function verifyPackageInventory(resources, target) {
  const absoluteResources = resolve(resources)
  const appAsar = join(absoluteResources, 'app.asar')
  await access(appAsar)
  const paths = listPackage(appAsar).map(normalizeAsarPath)
  const pathSet = new Set(paths)
  verifyInventoryPaths(pathSet)

  const workerEntries = [
    'out/main/agent-worker.js',
    'out/main/background-worker.js',
    'out/main/index-worker.js',
    'out/main/logging-fixture.js'
  ]
  for (const workerEntry of workerEntries) {
    verifyLocalImports(workerEntry, extractUtf8(appAsar, workerEntry), pathSet)
  }

  const rendererIndex = extractUtf8(appAsar, 'out/renderer/index.html')
  for (const directive of [
    'Content-Security-Policy',
    "default-src 'self'",
    "script-src 'self'",
    "font-src 'self' data:",
    "img-src 'self' data: writellm://bundle writellm-asset:",
    "object-src 'none'",
    "base-uri 'none'"
  ]) {
    if (!rendererIndex.includes(directive)) {
      throw new Error(`Packaged Renderer CSP is missing ${directive}`)
    }
  }
  for (const forbidden of ['img-src *', 'img-src http:', 'img-src https:']) {
    if (rendererIndex.includes(forbidden)) {
      throw new Error(`Packaged Renderer CSP includes forbidden directive ${forbidden}`)
    }
  }

  const rendererScripts = paths.filter(
    (path) => path.startsWith('out/renderer/assets/index-') && path.endsWith('.js')
  )
  if (rendererScripts.length !== 1) {
    throw new Error(`Expected one Renderer entry bundle, found ${rendererScripts.length}`)
  }
  const rendererBundle = extractUtf8(appAsar, rendererScripts[0])
  for (const signature of ['writellm-asset:', 'mermaid', 'katex', 'BlockNote']) {
    if (!rendererBundle.includes(signature)) {
      throw new Error(`Renderer bundle is missing the ${signature} runtime signature`)
    }
  }

  const addonPath = join(
    absoluteResources,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  )
  const addonInspection = assertNativeBinaryArchitecture(
    await readFile(addonPath),
    target.arch,
    'packaged better-sqlite3'
  )
  const sqliteVecDirectory = join(
    absoluteResources,
    'native',
    'sqlite-vec',
    `${target.platform}-${target.arch}`
  )
  const sqliteVecEntries = (await readdir(sqliteVecDirectory, { withFileTypes: true })).filter(
    (entry) => entry.isFile()
  )
  if (sqliteVecEntries.length !== 1) {
    throw new Error(`Expected one packaged sqlite-vec binary, found ${sqliteVecEntries.length}`)
  }
  const sqliteVecPath = join(sqliteVecDirectory, sqliteVecEntries[0].name)
  const sqliteVecInspection = assertNativeBinaryArchitecture(
    await readFile(sqliteVecPath),
    target.arch,
    'packaged sqlite-vec'
  )

  return {
    target: target.id,
    resources: basename(absoluteResources),
    asarSha256: await fileSha256(appAsar),
    asarEntries: paths.length,
    rendererEntry: rendererScripts[0],
    betterSqlite3: {
      format: addonInspection.format,
      arch: addonInspection.arch,
      sha256: await fileSha256(addonPath)
    },
    sqliteVec: {
      file: relative(absoluteResources, sqliteVecPath).split(sep).join('/'),
      format: sqliteVecInspection.format,
      arch: sqliteVecInspection.arch,
      sha256: await fileSha256(sqliteVecPath)
    }
  }
}

export function verifyInventoryPaths(paths) {
  const requiredExact = [
    'package.json',
    'out/main/index.js',
    'out/main/agent-worker.js',
    'out/main/background-worker.js',
    'out/main/index-worker.js',
    'out/main/logging-fixture.js',
    'out/preload/index.js',
    'out/renderer/index.html'
  ]
  for (const required of requiredExact) {
    if (!paths.has(required)) throw new Error(`Package inventory is missing ${required}`)
  }

  const requiredPrefixes = [
    'node_modules/better-sqlite3/',
    'node_modules/pino/',
    'node_modules/pino-roll/',
    'node_modules/thread-stream/',
    'node_modules/@earendil-works/pi-ai/',
    'node_modules/@ai-sdk/openai-compatible/',
    'node_modules/@ai-sdk/cohere/',
    'node_modules/@google/genai/'
  ]
  for (const prefix of requiredPrefixes) {
    if (![...paths].some((path) => path.startsWith(prefix))) {
      throw new Error(`Package inventory is missing ${prefix}`)
    }
  }

  if (
    ![...paths].some(
      (path) => path.startsWith('out/renderer/assets/pdf.worker.min-') && path.endsWith('.mjs')
    )
  ) {
    throw new Error('Package inventory is missing the PDF.js worker')
  }
  const forbidden = [...paths].find(
    (path) =>
      path.startsWith('src/') ||
      path.startsWith('e2e/') ||
      path.startsWith('scripts/') ||
      (!path.startsWith('node_modules/') && (path.endsWith('.ts') || path.endsWith('.tsx')))
  )
  if (forbidden !== undefined) {
    throw new Error(`Package inventory contains source-tree content: ${forbidden}`)
  }
}

function verifyLocalImports(entry, source, paths) {
  const imports = [...source.matchAll(/(?:from\s*|import\s*)["'](\.\/[^"']+\.js)["']/gu)].map(
    (match) => match[1].slice(2)
  )
  for (const imported of imports) {
    const target = `out/main/${imported}`
    if (!paths.has(target)) throw new Error(`${entry} references missing ASAR chunk ${target}`)
  }
}

function extractUtf8(appAsar, path) {
  return Buffer.from(extractFile(appAsar, path)).toString('utf8')
}

function normalizeAsarPath(path) {
  return path.replaceAll('\\', '/').replace(/^\/+/u, '')
}

async function fileSha256(path) {
  const file = await readFile(path)
  return createHash('sha256').update(file).digest('hex')
}

export async function inspectPackageArtifacts(directory, target, releaseVersion) {
  const entries = await readdir(directory)
  const artifactBase = `WriteLLM-${releaseVersion}-${target.arch}`
  const linuxArtifactBase = `WriteLLM-${releaseVersion}`
  const expected =
    target.id === 'windows-appx'
      ? [{ label: 'AppX', matches: (name) => name === `${artifactBase}.appx` }]
      : target.platform === 'darwin'
        ? [
            { label: 'DMG', matches: (name) => name === `${artifactBase}.dmg` },
            { label: 'ZIP', matches: (name) => name === `${artifactBase}.zip` }
          ]
        : target.platform === 'win32'
          ? [{ label: 'NSIS', matches: (name) => name === `${artifactBase}-setup.exe` }]
          : [
              {
                label: 'AppImage',
                matches: (name) => name === `${linuxArtifactBase}-x86_64.AppImage`
              },
              { label: 'deb', matches: (name) => name === `${linuxArtifactBase}-amd64.deb` }
            ]
  const artifacts = []
  for (const expectation of expected) {
    const candidates = entries.filter(expectation.matches)
    if (candidates.length !== 1) {
      throw new Error(
        `Expected one ${expectation.label} artifact for ${target.id}, found ${candidates.length}`
      )
    }
    const path = join(directory, candidates[0])
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error(`${expectation.label} artifact is empty`)
    }
    artifacts.push({
      format: expectation.label,
      file: candidates[0],
      bytes: metadata.size,
      sha256: await fileSha256(path)
    })
  }
  return artifacts
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [resources, targetId, artifactsDirectory] = process.argv.slice(2)
  if (resources === undefined || targetId === undefined) {
    throw new Error('Usage: package-inventory.mjs <resources> <target> [artifacts-directory]')
  }
  const target = resolvePackageTarget(targetId)
  const inventory = await verifyPackageInventory(resources, target)
  const artifacts =
    artifactsDirectory === undefined
      ? undefined
      : await inspectPackageArtifacts(artifactsDirectory, target, releaseMetadata.releaseVersion)
  process.stdout.write(`${JSON.stringify({ ...inventory, ...(artifacts ? { artifacts } : {}) })}\n`)
}
