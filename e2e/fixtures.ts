import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  expect,
  type Page
} from '@playwright/test'

export const PROJECT_DIALOG_PATHS_ENV = 'WRITELLM_E2E_PROJECT_DIALOG_PATHS'
export const KNOWLEDGE_DIALOG_PATHS_ENV = 'WRITELLM_E2E_KNOWLEDGE_DIALOG_PATHS'

export interface AppLaunchOptions {
  userData: string
  dialogPaths?: string[]
  knowledgeDialogPaths?: string[]
  env?: Record<string, string>
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
      ...options.env,
      ELECTRON_RUN_AS_NODE: undefined,
      [PROJECT_DIALOG_PATHS_ENV]: JSON.stringify(options.dialogPaths ?? []),
      [KNOWLEDGE_DIALOG_PATHS_ENV]: JSON.stringify(options.knowledgeDialogPaths ?? [])
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
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
