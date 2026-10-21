import type { Page } from '@playwright/test'
import { clickAppMenuItem, openAppMenu } from '../application-menu'
import { expect, expectActiveProject } from '../fixtures'

export interface AgentProviderOptions {
  providerName?: string
  apiKey?: string
  addModel?: {
    id: string
    displayName: string
    contextWindow?: string
    maximumOutput?: string
    setAsDefault?: boolean
  }
}

export async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

export async function closeProject(page: Page, waitForClosed = false): Promise<void> {
  await openAppMenu(page, 'Project')
  await clickAppMenuItem(page, 'Close project and return to chooser', false)
  if (waitForClosed) {
    await expect
      .poll(async () => (await page.evaluate(() => window.desktop.projects.lifecycle())).state)
      .toBe('closed')
  }
}

export async function configureAgentProvider(
  page: Page,
  baseUrl: string,
  options: AgentProviderOptions = {}
): Promise<void> {
  const providerName = options.providerName ?? 'E2E Agent'
  const apiKey = options.apiKey ?? 'e2e-secret'
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill(providerName)
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill(apiKey)
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: `Fetch ${providerName} models` }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  const addModel = options.addModel
  if (addModel !== undefined) {
    await settings.getByRole('button', { name: 'Add model' }).click()
    const modelDialog = page.getByRole('dialog', { name: 'Add model' })
    await modelDialog.getByLabel('Model ID').fill(addModel.id)
    await modelDialog.getByLabel('Display name').fill(addModel.displayName)
    if (addModel.contextWindow !== undefined || addModel.maximumOutput !== undefined) {
      await modelDialog.getByRole('button', { name: 'Advanced model metadata' }).click()
      if (addModel.contextWindow !== undefined)
        await modelDialog.getByLabel('Context window').fill(addModel.contextWindow)
      if (addModel.maximumOutput !== undefined)
        await modelDialog.getByLabel('Maximum output').fill(addModel.maximumOutput)
    }
    await modelDialog.getByRole('button', { name: 'Save model' }).click()
    if (addModel.setAsDefault !== false) {
      await settings.getByRole('button', { name: `Set ${addModel.displayName} as default` }).click()
    }
  }
  await page.keyboard.press('Escape')
}
