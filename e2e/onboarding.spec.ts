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
      await expect(first.page.getByText('Agent providers', { exact: true })).toBeVisible()
      if (screenshotDirectory !== undefined) {
        await first.page.screenshot({
          path: join(screenshotDirectory, 'cp67-onboarding-agent-desktop.png'),
          animations: 'disabled'
        })
      }
      await first.page.getByRole('button', { name: /Continue|Skip for now/ }).click()
      await expect(
        first.page.getByRole('heading', { name: 'Embedding API', exact: true })
      ).toBeVisible()
    } finally {
      await closeApp(first.app)
    }

    const resumed = await launchApp({
      userData,
      dialogPaths: [testRoot],
      onboarding: 'show'
    })
    try {
      await expect(
        resumed.page.getByRole('heading', { name: 'Embedding API', exact: true })
      ).toBeVisible()
      for (const nextHeading of [
        'Reranking API',
        'MinerU API',
        'Create your first writing project'
      ]) {
        await resumed.page.getByRole('button', { name: /Continue|Skip for now/ }).click()
        await expect(
          resumed.page.getByRole('heading', { name: nextHeading, exact: true })
        ).toBeVisible()
      }
      if (screenshotDirectory !== undefined) {
        const browserWindow = await resumed.app.browserWindow(resumed.page)
        await browserWindow.evaluate((window) => window.setContentSize(620, 800))
        await expect.poll(() => resumed.page.evaluate(() => window.innerWidth)).toBe(620)
        const onboarding = resumed.page.getByTestId('onboarding-flow')
        const dimensions = await onboarding.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
        await resumed.page.screenshot({
          path: join(screenshotDirectory, 'cp67-onboarding-project-narrow.png'),
          animations: 'disabled'
        })
      }
      await resumed.page.getByLabel('Project name').fill(projectName)
      await resumed.page.getByRole('button', { name: /Choose location & create/ }).click()
      if (screenshotDirectory !== undefined) {
        const browserWindow = await resumed.app.browserWindow(resumed.page)
        await browserWindow.evaluate((window) => window.setContentSize(1440, 900))
        await expect.poll(() => resumed.page.evaluate(() => window.innerWidth)).toBe(1440)
      }
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
