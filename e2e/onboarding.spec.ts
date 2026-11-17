import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}

test(
  'resumes optional provider setup and completes through real project creation',
  scenario('onboarding.optional-provider-to-project', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const userData = join(testRoot, 'onboarding-user-data')
    const projectName = 'First field notes'
    const screenshotDirectory = process.env.WRITELLM_CP67_SCREENSHOT_DIR

    const first = await launchApp({ userData, onboarding: 'show' })
    try {
      await expect(
        first.page.getByRole('heading', {
          name: 'Set up WriteLLM around the way you write',
          exact: true
        })
      ).toBeVisible()
      if (screenshotDirectory !== undefined) {
        await mkdir(screenshotDirectory, { recursive: true })
        const browserWindow = await first.app.browserWindow(first.page)
        await browserWindow.evaluate((window) => window.setContentSize(1440, 900))
        await expect.poll(() => first.page.evaluate(() => window.innerWidth)).toBe(1440)
        await first.page.screenshot({
          path: join(screenshotDirectory, 'cp67-onboarding-welcome-desktop.png'),
          animations: 'disabled'
        })
      }
      await first.page.getByRole('button', { name: /Start setup/ }).click()
      await expect(first.page.getByTestId('agent-provider-list')).toBeVisible()
      if (screenshotDirectory !== undefined) {
        await first.page.screenshot({
          path: join(screenshotDirectory, 'cp67-onboarding-agent-desktop.png'),
          animations: 'disabled'
        })
      }
      await first.page.getByRole('button', { name: 'Add source', exact: true }).click()
      const addSource = first.page.getByRole('dialog', { name: 'Add source' })
      await addSource.getByLabel('Source name').fill('Onboarding draft')
      await addSource.getByRole('button', { name: 'Continue', exact: true }).click()
      const leavePrompt = first.page.getByRole('alertdialog', {
        name: 'Save changes before leaving?'
      })
      await first.page.getByTestId('agent-provider-list').getByRole('button').first().click()
      await leavePrompt.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(first.page.getByLabel('Source name')).toHaveValue('Onboarding draft')
      const next = first.page.getByRole('button', { name: /Continue|Skip for now/ })
      await next.click()
      await leavePrompt.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(
        first.page.getByText('Enter a source name and base URL before saving.')
      ).toBeVisible()
      await expect(first.page.getByLabel('Source name')).toHaveValue('Onboarding draft')
      await next.click()
      await leavePrompt.getByRole('button', { name: 'Discard', exact: true }).click()
      await expect(first.page.getByTestId('embedding-source-list')).toBeVisible()
    } finally {
      await closeApp(first.app)
    }

    const resumed = await launchApp({
      userData,
      dialogPaths: [testRoot],
      onboarding: 'show'
    })
    try {
      await expect(resumed.page.getByTestId('embedding-source-list')).toBeVisible()
      await resumed.page.getByRole('button', { name: 'Add source', exact: true }).click()
      await resumed.page.getByLabel('Source name').fill('Unsaved embedding')
      await resumed.page.getByRole('button', { name: 'Back', exact: true }).click()
      const leavePrompt = resumed.page.getByRole('alertdialog', {
        name: 'Save changes before leaving?'
      })
      await leavePrompt.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(resumed.page.getByLabel('Source name')).toHaveValue('Unsaved embedding')
      await resumed.page.getByRole('button', { name: /Continue|Skip for now/ }).click()
      await leavePrompt.getByRole('button', { name: 'Discard', exact: true }).click()
      await expect(resumed.page.getByTestId('rerank-source-list')).toBeVisible()
      await resumed.page.getByRole('button', { name: /Continue|Skip for now/ }).click()
      await expect(resumed.page.getByTestId('mineru-source-list')).toBeVisible()
      await resumed.page.getByRole('button', { name: /Continue|Skip for now/ }).click()
      await expect(
        resumed.page.getByRole('heading', {
          name: 'Create your first writing project',
          exact: true
        })
      ).toBeVisible()
      await resumed.page.getByLabel('Project name').fill(projectName)
      await resumed.page.getByRole('button', { name: /Choose location & create/ }).click()
      await expectActiveProject(resumed.page, projectName)
      await expect
        .poll(() => resumed.page.evaluate(() => window.desktop.app.getOnboardingState()))
        .toEqual({ schemaVersion: 1, status: 'completed' })
    } finally {
      await closeApp(resumed.app)
    }

    const restarted = await launchApp({ userData, onboarding: 'show' })
    try {
      await expect(
        restarted.page.getByRole('heading', { name: 'Open a workspace', exact: true })
      ).toBeVisible()
      await expect(restarted.page.getByTestId('onboarding-flow')).toHaveCount(0)
    } finally {
      await closeApp(restarted.app)
    }
  }
)
