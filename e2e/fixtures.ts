import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'

export const PROJECT_DIALOG_PATHS_ENV = 'WRITELLM_E2E_PROJECT_DIALOG_PATHS'

export interface AppLaunchOptions {
  userData: string
  dialogPaths?: string[]
}

export async function launchApp(options: AppLaunchOptions): Promise<{
  app: ElectronApplication
  page: Page
}> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${options.userData}`],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      [PROJECT_DIALOG_PATHS_ENV]: JSON.stringify(options.dialogPaths ?? [])
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

interface Fixtures {
  testRoot: string
}

export const test = base.extend<Fixtures>({
  // Playwright requires fixture callbacks to use an object destructuring pattern.
  // biome-ignore lint/correctness/noEmptyPattern: required by the Playwright fixture API
  testRoot: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-e2e-'))
    await mkdir(join(root, 'user-data'))
    try {
      await use(root)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

export { expect } from '@playwright/test'
