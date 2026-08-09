const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

export function resolveReleaseMetadata(packageMetadata) {
  const packageVersion = packageMetadata?.version
  const releaseVersion = packageMetadata?.release?.version
  if (typeof packageVersion !== 'string' || typeof releaseVersion !== 'string') {
    throw new Error('Package metadata must define version and release.version')
  }
  const releaseParts = releaseVersion.match(RELEASE_VERSION_PATTERN)?.slice(1)
  if (releaseParts === undefined) {
    throw new Error(`Release version ${releaseVersion} must contain four numeric components`)
  }
  const expectedPackageVersion = releaseParts.slice(0, 3).join('.')
  if (packageVersion !== expectedPackageVersion) {
    throw new Error(
      `Package version ${packageVersion} must match release base ${expectedPackageVersion}`
    )
  }
  return {
    packageVersion,
    releaseVersion,
    buildNumber: releaseParts[3],
    macBuildVersion: releaseParts.slice(1).join('.')
  }
}

export function releaseBuilderArguments(target, metadata) {
  if (target.platform === 'darwin') {
    return [`--config.buildVersion=${metadata.macBuildVersion}`]
  }
  if (target.platform === 'win32') {
    return [`--config.buildVersion=${metadata.releaseVersion}`]
  }
  return [`--config.buildNumber=${metadata.buildNumber}`]
}
