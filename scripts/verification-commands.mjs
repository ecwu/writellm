import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)

export function packageCli(name, binary) {
  const metadataPath = require.resolve(`${name}/package.json`)
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  const entry = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin[binary]
  return resolve(dirname(metadataPath), entry)
}

export function checkCommands(mode, args = []) {
  const script = (name, file, extra = []) => ({ name, args: [resolve('scripts', file), ...extra] })
  const staticCommands = [
    { name: 'format-lint', args: [packageCli('@biomejs/biome', 'biome'), 'check', '.'] },
    {
      name: 'typecheck-main',
      args: [
        packageCli('typescript', 'tsc'),
        '--noEmit',
        '-p',
        'tsconfig.node.json',
        '--composite',
        'false'
      ]
    },
    {
      name: 'typecheck-renderer',
      args: [
        packageCli('typescript', 'tsc'),
        '--noEmit',
        '-p',
        'tsconfig.web.json',
        '--composite',
        'false'
      ]
    }
  ]
  const buildCommands = [
    script('native-prepare', 'prepare-native-target.mjs'),
    { name: 'production-compile', args: [packageCli('electron-vite', 'electron-vite'), 'build'] }
  ]
  if (mode === 'build' || mode === 'fast' || mode === 'full' || mode === 'fixtures') {
    if (args.length) throw new Error(`${mode} does not accept test filters`)
  }
  switch (mode) {
    case 'fixtures':
      return [script('recovery-inventory', 'verify-recovery-fixtures.mjs')]
    case 'build':
      return buildCommands
    case 'fast':
      return staticCommands
    case 'electron':
      return [...staticCommands, script('electron-tests', 'run-tests.mjs', args), ...buildCommands]
    case 'e2e':
      return [...staticCommands, ...buildCommands, script('electron-e2e', 'run-e2e.mjs', args)]
    case 'full':
      return [
        ...staticCommands,
        script('electron-tests', 'run-tests.mjs'),
        ...buildCommands,
        script('electron-e2e', 'run-e2e.mjs', ['--suite=full'])
      ]
    default:
      throw new Error(`Unknown verification mode ${mode}`)
  }
}
