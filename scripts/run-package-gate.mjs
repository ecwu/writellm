import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electronBuilderCli = require.resolve('electron-builder/cli.js')
const packagedSmoke = new URL('./run-packaged-hybrid-smoke.mjs', import.meta.url)
const args = new Set(process.argv.slice(2))
const allowedArgs = new Set(['--plan', '--release'])

for (const argument of args) {
  if (!allowedArgs.has(argument)) {
    throw new Error(`Unknown package-gate argument: ${argument}`)
  }
}

const release = args.has('--release')
const plan = {
  gate: release ? 'release' : 'package',
  signing: release ? 'configured macOS signing identity' : 'Apple identity discovery disabled',
  notarization: 'disabled by electron-builder.yml',
  steps: [
    'production build',
    release ? 'signed unpacked package' : 'no-identity unpacked package',
    release ? 'strict deep signature verification' : 'no-Apple-Team-signature verification',
    'packaged hybrid smoke'
  ]
}

if (args.has('--plan')) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  process.exit(0)
}

if (release && process.platform !== 'darwin') {
  throw new Error('The signed release gate is currently supported only on macOS.')
}

process.stdout.write(
  release
    ? 'Running the opt-in signed macOS release gate.\n'
    : 'Running the no-identity package gate; Apple signing identity discovery is disabled.\n'
)

run('npm', ['run', 'build'])

const packageEnvironment = {
  ...process.env,
  ...(release ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
}
run(process.execPath, [electronBuilderCli, '--dir'], packageEnvironment)

const resources = resolvePackagedResources()
if (process.platform === 'darwin') {
  const app = resolve(resources, '..', '..')
  if (release) verifySignedApp(app)
  else verifyNoIdentitySignature(app)
}

run(process.execPath, [packagedSmoke.pathname, resources])

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.signal !== null) {
    throw new Error(`${command} terminated by signal ${result.signal}`)
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
  }
}

function resolvePackagedResources() {
  const candidates =
    process.platform === 'darwin'
      ? [
          join('dist', `mac-${process.arch}`, 'writellm.app', 'Contents', 'Resources'),
          join('dist', 'mac', 'writellm.app', 'Contents', 'Resources')
        ]
      : process.platform === 'win32'
        ? [join('dist', 'win-unpacked', 'resources')]
        : [join('dist', 'linux-unpacked', 'resources')]

  const directMatch = candidates.find((candidate) => existsSync(candidate))
  if (directMatch !== undefined) return resolve(directMatch)

  if (process.platform === 'darwin' && existsSync('dist')) {
    for (const directory of readdirSync('dist', { withFileTypes: true })) {
      if (!directory.isDirectory() || !directory.name.startsWith('mac')) continue
      const platformDirectory = join('dist', directory.name)
      const app = readdirSync(platformDirectory, { withFileTypes: true }).find(
        (entry) => entry.isDirectory() && entry.name.endsWith('.app')
      )
      if (app !== undefined) {
        return resolve(platformDirectory, app.name, 'Contents', 'Resources')
      }
    }
  }

  throw new Error(`Unable to locate packaged resources under ${resolve('dist')}`)
}

function verifyNoIdentitySignature(app) {
  const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=2', app], {
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0) {
    if (!diagnostics.includes('code object is not signed at all')) {
      throw new Error(`Unable to inspect the package signature: ${diagnostics.trim()}`)
    }
    process.stdout.write('Verified that the packaged macOS app has no code signature.\n')
    return
  }

  const isAdHoc = diagnostics.includes('Signature=adhoc') || /\bflags=.*\badhoc\b/.test(diagnostics)
  const hasNoTeam = diagnostics.includes('TeamIdentifier=not set')
  if (!isAdHoc || !hasNoTeam) {
    throw new Error(
      'Package gate produced an Apple Team-signed app. Signing identity discovery must remain disabled.'
    )
  }
  process.stdout.write(
    'Verified that the packaged macOS app has only its no-Team-ID ad-hoc/linker signature.\n'
  )
}

function verifySignedApp(app) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  process.stdout.write('Verified the packaged macOS app with strict deep signature validation.\n')
}
