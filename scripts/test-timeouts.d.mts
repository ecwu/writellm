export declare const e2eExpectTimeoutMs: number
export declare const e2eLocalTestTimeoutMs: number
export declare const e2eHostedTestTimeoutMs: number
export declare const e2ePackagedTestTimeoutMs: number
export declare const vitestLocalTestTimeoutMs: number
export declare const vitestHostedWindowsTestTimeoutMs: number
export declare const traceBenchmarkTestTimeoutMs: number
export declare const smokePollMs: number
export declare const pollIntervalMs: number

export interface TestEnvironmentOptions {
  env?: Record<string, string | undefined>
  platform?: string
}

export interface E2eSettings {
  usesPackagedValidation: boolean
  usesHostedRunner: boolean
  usesLinuxHeadlessRunner: boolean
  requiresSerialWorkers: boolean
  workers: number
  testTimeoutMs: number
  expectTimeoutMs: number
  retries: number
  failOnFlakyTests: boolean
}

export declare function resolveE2eSettings(options?: TestEnvironmentOptions): E2eSettings
export declare function resolveVitestTestTimeout(options?: TestEnvironmentOptions): number
