import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { currentPackageTarget } from './package-targets.mjs'

const argumentsSet = new Set(process.argv.slice(2))
for (const argument of argumentsSet) {
  if (argument !== '--plan' && argument !== '--dry-run') {
    throw new Error(`Unknown release-gate argument ${argument}`)
  }
}
const dryRun = argumentsSet.has('--dry-run')
const target = currentPackageTarget()
const revision = command('git', ['rev-parse', 'HEAD']).trim()
const tag =
  process.env.WRITELLM_RELEASE_TAG ??
  command('git', ['describe', '--tags', '--exact-match', revision], true).trim()
const packageMetadata = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const expectedTag = `v${packageMetadata.version}`
const plan = {
  gate: dryRun ? 'release-dry-run' : 'production-release',
  target: target.id,
  expectedTag,
  revision,
  signing: dryRun
    ? 'unsigned test-only'
    : target.platform === 'linux'
      ? 'not applicable'
      : 'required',
  notarization: target.platform === 'darwin' ? 'required for production' : 'not applicable',
  promotion: 'complete four-row evidence is verified by the protected release-candidate workflow'
}
if (argumentsSet.has('--plan')) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  process.exit(0)
}

if (tag !== expectedTag) throw new Error(`Release tag ${tag || '(none)'} must be ${expectedTag}`)
if (command('git', ['rev-list', '-n', '1', tag]).trim() !== revision) {
  throw new Error(`Release tag ${tag} does not resolve to HEAD`)
}
if (command('git', ['status', '--porcelain']).trim() !== '') {
  throw new Error('Release worktree must be clean')
}
command('git', ['diff', '--exit-code', revision, '--', 'package.json', 'pnpm-lock.yaml'])

if (!dryRun) {
  if (
    target.platform === 'darwin' &&
    [
      process.env.CSC_LINK,
      process.env.APPLE_ID,
      process.env.APPLE_APP_SPECIFIC_PASSWORD,
      process.env.APPLE_TEAM_ID
    ].some((value) => value === undefined || value === '')
  ) {
    throw new Error('Production release requires CSC_LINK and Apple notarization credentials')
  }
  if (target.platform === 'win32' && process.env.CSC_LINK === undefined) {
    throw new Error('Production release is disabled until Authenticode credentials are configured')
  }
}

const packageGate = new URL('./run-package-gate.mjs', import.meta.url)
run(process.execPath, [
  packageGate.pathname,
  `--target=${target.id}`,
  ...(dryRun ? [] : ['--release'])
])
process.stdout.write(`${JSON.stringify({ ...plan, tag })}\n`)

function command(executable, args, allowFailure = false) {
  const result = spawnSync(executable, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${executable} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout ?? ''
}

function run(executable, args) {
  const result = spawnSync(executable, args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${executable} exited with status ${result.status ?? 'unknown'}`)
  }
}
