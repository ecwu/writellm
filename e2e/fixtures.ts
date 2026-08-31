import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  expect,
  type Page,
  type TestInfo
} from '@playwright/test'

export const PROJECT_DIALOG_PATHS_ENV = 'WRITELLM_E2E_PROJECT_DIALOG_PATHS'
export const KNOWLEDGE_DIALOG_PATHS_ENV = 'WRITELLM_E2E_KNOWLEDGE_DIALOG_PATHS'
export const BIBLIOGRAPHY_DIALOG_PATH_ENV = 'WRITELLM_E2E_BIBLIOGRAPHY_DIALOG_PATH'
export const WINDOW_PRESENTATION_ENV = 'WRITELLM_E2E_WINDOW_MODE'
export const EXECUTABLE_PATH_ENV = 'WRITELLM_E2E_EXECUTABLE_PATH'

type WindowPresentation = 'interactive' | 'silent-e2e'

export interface AppLaunchOptions {
  userData: string
  dialogPaths?: string[]
  knowledgeDialogPaths?: string[]
  bibliographyDialogPath?: string
  windowPresentation?: WindowPresentation
  onboarding?: 'complete' | 'show'
  env?: Record<string, string>
}

export async function launchApp(options: AppLaunchOptions): Promise<{
  app: ElectronApplication
  page: Page
}> {
  const requestedPresentation = options.windowPresentation ?? process.env[WINDOW_PRESENTATION_ENV]
  const windowPresentation =
    requestedPresentation === undefined || requestedPresentation === 'silent'
      ? 'silent-e2e'
      : requestedPresentation === 'interactive'
        ? 'interactive'
        : (() => {
            throw new Error(
              `${WINDOW_PRESENTATION_ENV} must be either "interactive" or "silent", received ${JSON.stringify(requestedPresentation)}`
            )
          })()
  const executablePath = process.env[EXECUTABLE_PATH_ENV]
  const launchArguments = [
    `--user-data-dir=${options.userData}`,
    '--lang=en-IE',
    '--writellm-e2e-artifact-loopback'
  ]
  if (process.platform === 'linux') {
    const passwordStore = process.env['WRITELLM_E2E_PASSWORD_STORE']
    if (passwordStore !== 'gnome-libsecret') {
      throw new Error(
        'Linux Electron E2E requires WRITELLM_E2E_PASSWORD_STORE=gnome-libsecret and a running Secret Service'
      )
    }
    launchArguments.push(`--password-store=${passwordStore}`)
  }
  const app = await electron.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: executablePath === undefined ? [...launchArguments, '.'] : launchArguments,
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...options.env,
      ELECTRON_RUN_AS_NODE: undefined,
      TZ: 'Europe/Dublin',
      [WINDOW_PRESENTATION_ENV]: windowPresentation === 'interactive' ? 'interactive' : 'silent',
      [PROJECT_DIALOG_PATHS_ENV]: JSON.stringify(options.dialogPaths ?? []),
      [KNOWLEDGE_DIALOG_PATHS_ENV]: JSON.stringify(options.knowledgeDialogPaths ?? []),
      [BIBLIOGRAPHY_DIALOG_PATH_ENV]: options.bibliographyDialogPath
    }
  })
  if (process.platform === 'linux') {
    const backend = await app.evaluate(async ({ app, safeStorage }) => {
      await app.whenReady()
      const probe = 'writellm-playwright-safe-storage-probe'
      const available = safeStorage.isEncryptionAvailable()
      const encrypted = available ? safeStorage.encryptString(probe) : undefined
      return {
        requested: app.commandLine.getSwitchValue('password-store'),
        selected: safeStorage.getSelectedStorageBackend(),
        available,
        roundTrip: encrypted === undefined ? false : safeStorage.decryptString(encrypted) === probe
      }
    })
    if (
      backend.requested !== 'gnome-libsecret' ||
      backend.selected !== 'gnome_libsecret' ||
      !backend.available ||
      !backend.roundTrip
    ) {
      process.stderr.write(
        `[writellm-linux-safe-storage] invalid backend ${JSON.stringify(backend)}\n`
      )
      await closeInvalidLinuxApp(app)
      throw new Error(
        `Linux Electron E2E secure credential backend is invalid: ${JSON.stringify(backend)}`
      )
    }
  }
  const page = await app.firstWindow()
  const rendererErrors = rendererErrorsForCurrentTest()
  page.on('pageerror', (error) => {
    const details = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
      url: page.url(),
      pageClosed: page.isClosed()
    }
    rendererErrors.push(`pageerror: ${JSON.stringify(details)}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location()
      if (
        message.text() === 'Failed to load resource: net::ERR_UNKNOWN_URL_SCHEME' &&
        /^writellm-asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          location.url
        )
      ) {
        return
      }
      rendererErrors.push(`console.error: ${JSON.stringify({ text: message.text(), location })}`)
    }
  })
  await page.waitForLoadState('domcontentloaded')
  if (options.onboarding !== 'show') {
    const onboardingCompleted = await page.evaluate(async () => {
      const current = await window.desktop.app.getOnboardingState()
      if (current.status === 'completed') return true
      await window.desktop.app.setOnboardingState({
        state: { schemaVersion: 1, status: 'completed' }
      })
      return false
    })
    if (!onboardingCompleted) await page.reload({ waitUntil: 'domcontentloaded' })
  }
  if (windowPresentation === 'silent-e2e') {
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          return {
            visible: window?.isVisible() ?? false,
            focused: window?.isFocused() ?? false,
            backgroundThrottling: window?.webContents.getBackgroundThrottling() ?? true
          }
        })
      )
      .toEqual({ visible: false, focused: false, backgroundThrottling: false })
  }
  return { app, page }
}

async function closeInvalidLinuxApp(app: ElectronApplication): Promise<void> {
  const child = app.process()
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 5_000)
      })
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

/**
 * Asserts that a project is open by checking the workspace sidebar header, which
 * renders the project name as plain text next to an `Active` badge (not a heading).
 */
export async function expectActiveProject(page: Page, name: string): Promise<void> {
  const header = page.locator('[data-slot="sidebar-header"]').filter({ hasText: name })
  await expect(header.getByText(name, { exact: true })).toBeVisible()
  await expect(header.getByText('Active', { exact: true })).toBeVisible()
}

export function sectionEditor(page: Page) {
  return page.getByTestId('section-editor').locator('.bn-editor[role="textbox"]')
}

interface Fixtures {
  testRoot: string
  rendererErrorGuard: undefined
}

const rendererErrorsByTest = new Map<string, string[]>()

export function scenario(
  id: string,
  tags: readonly ('@critical' | '@packaged')[] = []
): {
  tag: string[]
  annotation: { type: string; description: string }
} {
  return {
    tag: [...tags],
    annotation: { type: 'scenario', description: id }
  }
}

export const test = base.extend<Fixtures>({
  rendererErrorGuard: [
    // Playwright requires fixture callbacks to use an object destructuring pattern.
    // biome-ignore lint/correctness/noEmptyPattern: required by the Playwright fixture API
    async ({}, use, testInfo) => {
      rendererErrorsByTest.set(testInfo.testId, [])
      await use(undefined)
      const errors = rendererErrorsByTest.get(testInfo.testId) ?? []
      rendererErrorsByTest.delete(testInfo.testId)
      expect(errors, 'unexpected Renderer pageerror/console.error events').toEqual([])
    },
    { auto: true }
  ],
  // Playwright requires fixture callbacks to use an object destructuring pattern.
  // biome-ignore lint/correctness/noEmptyPattern: required by the Playwright fixture API
  testRoot: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-e2e-'))
    await mkdir(join(root, 'user-data'))
    try {
      await use(root)
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: process.platform === 'win32' ? 20 : 0,
        retryDelay: 100
      })
    }
  }
})

function rendererErrorsForCurrentTest(): string[] {
  let testInfo: TestInfo
  try {
    testInfo = base.info()
  } catch {
    return []
  }
  const existing = rendererErrorsByTest.get(testInfo.testId)
  if (existing !== undefined) return existing
  const created: string[] = []
  rendererErrorsByTest.set(testInfo.testId, created)
  return created
}

export { expect } from '@playwright/test'
