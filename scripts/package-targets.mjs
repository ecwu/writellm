import { arch, platform } from 'node:process'

export const PACKAGE_TARGETS = Object.freeze({
  'windows-x64': Object.freeze({
    id: 'windows-x64',
    platform: 'win32',
    arch: 'x64',
    builderPlatform: '--win',
    builderArch: '--x64',
    builderTarget: 'nsis',
    formats: Object.freeze(['nsis'])
  }),
  'windows-appx': Object.freeze({
    id: 'windows-appx',
    platform: 'win32',
    arch: 'x64',
    builderPlatform: '--win',
    builderArch: '--x64',
    builderTarget: 'appx',
    formats: Object.freeze(['appx'])
  }),
  'macos-arm64': Object.freeze({
    id: 'macos-arm64',
    platform: 'darwin',
    arch: 'arm64',
    builderPlatform: '--mac',
    builderArch: '--arm64',
    formats: Object.freeze(['dmg', 'zip'])
  }),
  'macos-x64': Object.freeze({
    id: 'macos-x64',
    platform: 'darwin',
    arch: 'x64',
    builderPlatform: '--mac',
    builderArch: '--x64',
    formats: Object.freeze(['dmg', 'zip'])
  }),
  'linux-x64': Object.freeze({
    id: 'linux-x64',
    platform: 'linux',
    arch: 'x64',
    builderPlatform: '--linux',
    builderArch: '--x64',
    formats: Object.freeze(['AppImage', 'deb'])
  })
})

export function currentPackageTarget() {
  const target = Object.values(PACKAGE_TARGETS).find(
    (candidate) => candidate.platform === platform && candidate.arch === arch
  )
  if (target === undefined) {
    throw new Error(`Unsupported package host ${platform}-${arch}`)
  }
  return target
}

export function resolvePackageTarget(id = currentPackageTarget().id) {
  const target = PACKAGE_TARGETS[id]
  if (target === undefined) {
    throw new Error(`Unknown package target ${id}`)
  }
  return target
}

export function assertNativePackageHost(target) {
  if (target.platform !== platform || target.arch !== arch) {
    throw new Error(
      `Target ${target.id} must run on its native ${target.platform}-${target.arch} host; ` +
        `the current host is ${platform}-${arch}`
    )
  }
}
