import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installerArguments, packageOptions } from './package-plan.mjs'
import { PACKAGE_TARGETS } from './package-targets.mjs'
import { checkCommands } from './verification-commands.mjs'

describe('verification and packaging selection', () => {
  it('builds without tests and performs each full verification stage once', () => {
    expect(checkCommands('build').map((command) => command.name)).toEqual([
      'native-prepare',
      'production-compile'
    ])
    const names = checkCommands('full').map((command) => command.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual([
      'format-lint',
      'typecheck-main',
      'typecheck-renderer',
      'electron-tests',
      'native-prepare',
      'production-compile',
      'electron-e2e'
    ])
    expect(
      checkCommands('e2e', ['e2e/project-lifecycle.spec.ts', '--grep', 'restart'])
        .at(-1)
        .args.slice(1)
    ).toEqual(['e2e/project-lifecycle.spec.ts', '--grep', 'restart'])
    expect(() => checkCommands('build', ['--grep=x'])).toThrow()
  })

  it('keeps ordinary packaging test-free and explicit gates verified', () => {
    const scripts = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ).scripts
    for (const [name, command] of Object.entries(scripts)) {
      if (name === 'package' || name.startsWith('package:')) {
        expect(String(command), name).toContain('--build-only')
      }
    }
    expect(scripts['check:package']).not.toContain('--build-only')
    expect(scripts['check:package:smoke']).toContain('--smoke-only')
  })

  it('keeps static and focused E2E gates scoped without introducing Vitest or repeated builds', () => {
    const staticNames = ['format-lint', 'typecheck-main', 'typecheck-renderer']
    expect(checkCommands('fast').map((command) => command.name)).toEqual(staticNames)
    const filters = ['e2e/project-lifecycle.spec.ts', '--grep', 'restart']
    const commands = checkCommands('e2e', filters)
    expect(commands.map((command) => command.name)).toEqual([
      ...staticNames,
      'native-prepare',
      'production-compile',
      'electron-e2e'
    ])
    expect(commands.at(-1).args.slice(1)).toEqual(filters)
    expect(() => checkCommands('electron')).toThrow('Unknown verification mode')
  })

  it.each(Object.keys(PACKAGE_TARGETS))(
    'forwards the generic package command target for %s',
    (id) => {
      const scripts = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8')
      ).scripts
      for (const name of ['package', 'package:unpack']) {
        const args = scripts[name].split(' ').slice(2)
        expect(packageOptions([...args, `--target=${id}`])).toMatchObject({
          target: { id },
          buildOnly: true,
          unpackedOnly: name === 'package:unpack'
        })
      }
    }
  )

  it.each(Object.keys(PACKAGE_TARGETS))('reuses the correct prepackaged path for %s', (id) => {
    const options = packageOptions([`--target=${id}`, '--build-only'])
    expect(options.buildOnly).toBe(true)
    const mac = options.target.platform === 'darwin'
    const resources = resolve(
      mac ? 'dist/test/WriteLLM.app/Contents/Resources' : 'dist/test/unpacked/resources'
    )
    const args = installerArguments(['--publish=never'], resources, options.target)
    expect(args).toEqual([
      '--publish=never',
      '--prepackaged',
      resolve(mac ? 'dist/test/WriteLLM.app' : 'dist/test/unpacked')
    ])
    expect(args).not.toContain('--dir')
  })

  it('bounds smoke to unpacked and rejects conflicting verification modes', () => {
    expect(packageOptions(['--smoke-only'])).toMatchObject({
      smokeOnly: true,
      unpackedOnly: true,
      buildOnly: false
    })
    expect(() => packageOptions(['--release', '--build-only'])).toThrow()
    expect(() => packageOptions(['--build-only', '--smoke-only'])).toThrow()
    expect(() => packageOptions(['--target=linux-x64', '--target=windows-x64'])).toThrow()
  })
})
