import { resolve } from 'node:path'
import { currentPackageTarget, resolvePackageTarget } from './package-targets.mjs'

export function packageOptions(args) {
  const targetArgs = args.filter((arg) => arg.startsWith('--target='))
  if (targetArgs.length > 1) throw new Error('Only one package target is allowed')
  const allowed = new Set([
    '--plan',
    '--release',
    '--build-only',
    '--smoke-only',
    '--unpacked-only',
    ...targetArgs
  ])
  for (const arg of args)
    if (!allowed.has(arg)) throw new Error(`Unknown package-gate argument: ${arg}`)
  const release = args.includes('--release')
  const buildOnly = args.includes('--build-only')
  const smokeOnly = args.includes('--smoke-only')
  if ((release && (buildOnly || smokeOnly)) || (buildOnly && smokeOnly)) {
    throw new Error('Release, build-only and smoke-only modes are mutually exclusive')
  }
  return {
    target: resolvePackageTarget(
      targetArgs[0]?.slice('--target='.length) ?? currentPackageTarget().id
    ),
    release,
    buildOnly,
    smokeOnly,
    unpackedOnly: smokeOnly || args.includes('--unpacked-only'),
    planOnly: args.includes('--plan')
  }
}

export function prepackagedPath(resources, target) {
  return target.platform === 'darwin' ? resolve(resources, '..', '..') : resolve(resources, '..')
}

export function installerArguments(base, resources, target) {
  return [...base, '--prepackaged', prepackagedPath(resources, target)]
}
