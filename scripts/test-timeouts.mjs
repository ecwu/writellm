/**
 * Shared test and packaged-smoke timing policy.
 *
 * Keep timeout values separate from verification timing reports. These values
 * only bound a stalled operation; the reporters record the observed duration.
 */

export const e2eExpectTimeoutMs = 10_000
export const e2eLocalTestTimeoutMs = 45_000
export const e2eHostedTestTimeoutMs = 90_000
export const e2ePackagedTestTimeoutMs = 180_000
export const vitestLocalTestTimeoutMs = 5_000
export const vitestHostedWindowsTestTimeoutMs = 30_000
export const traceBenchmarkTestTimeoutMs = 20_000
export const smokePollMs = 180_000
export const pollIntervalMs = 1_000

/**
 * Resolve the existing Electron E2E platform policy from an explicit
 * environment/platform pair so config consumers and focused tests share one
 * decision.
 */
export function resolveE2eSettings({ env = process.env, platform = process.platform } = {}) {
  const usesPackagedSuite = env.WRITELLM_E2E_SUITE === 'packaged'
  const usesPackagedExecutable = Boolean(env.WRITELLM_E2E_EXECUTABLE_PATH)
  const usesPackagedValidation = usesPackagedSuite || usesPackagedExecutable
  const usesHostedRunner = Boolean(env.CI)
  const usesLinuxHeadlessRunner =
    platform === 'linux' && (usesHostedRunner || env.WRITELLM_E2E_WINDOW_MODE === 'silent')
  const usesWindowsPackagedRunner = platform === 'win32' && usesPackagedValidation
  const requiresSerialWorkers =
    env.WRITELLM_E2E_WINDOW_MODE === 'interactive' ||
    usesWindowsPackagedRunner ||
    (platform === 'linux' && (usesHostedRunner || env.WRITELLM_E2E_WINDOW_MODE === 'silent'))
  const testTimeoutMs =
    usesPackagedValidation || (platform === 'win32' && usesHostedRunner)
      ? e2ePackagedTestTimeoutMs
      : usesHostedRunner || usesLinuxHeadlessRunner
        ? e2eHostedTestTimeoutMs
        : e2eLocalTestTimeoutMs

  return {
    usesPackagedValidation,
    usesHostedRunner,
    usesLinuxHeadlessRunner,
    requiresSerialWorkers,
    workers: requiresSerialWorkers ? 1 : 2,
    testTimeoutMs,
    expectTimeoutMs: e2eExpectTimeoutMs,
    retries: usesHostedRunner ? 1 : 0,
    failOnFlakyTests: usesHostedRunner
  }
}

/** Resolve the existing Vitest test timeout policy. */
export function resolveVitestTestTimeout({ env = process.env, platform = process.platform } = {}) {
  return platform === 'win32' && env.CI
    ? vitestHostedWindowsTestTimeoutMs
    : vitestLocalTestTimeoutMs
}
