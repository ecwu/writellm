import type { Locator, Page } from '@playwright/test'
import { expect } from '../fixtures'

export async function addPurposeSource(
  settings: Locator,
  input: { name: string; baseUrl: string; apiKey: string; mineru?: boolean }
): Promise<void> {
  await settings.getByRole('button', { name: 'Add source', exact: true }).click()
  await settings.getByLabel('Source name', { exact: true }).fill(input.name)
  await settings.getByLabel('Base URL', { exact: true }).fill(input.baseUrl)
  await settings
    .getByLabel(input.mineru ? 'API token' : 'API key', { exact: true })
    .fill(input.apiKey)
  await settings.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(settings.getByRole('button', { name: 'Add model', exact: true })).toBeEnabled()
}

export async function addParsingMode(page: Page, settings: Locator, label: string): Promise<void> {
  await settings.getByRole('button', { name: 'Add model', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add model', exact: true })
  await form.getByLabel('Parsing mode', { exact: true }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await form.getByRole('button', { name: 'Save model', exact: true }).click()
  await expect(form).toHaveCount(0)
}

export async function configureMineru(page: Page, baseUrl: string, apiKey: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('option', { name: /^Document Parsing/ }).click()
  await addPurposeSource(settings, { name: 'Test MinerU', baseUrl, apiKey, mineru: true })
  await addParsingMode(page, settings, 'Pipeline')
  await settings.getByRole('button', { name: 'Set Pipeline as default', exact: true }).click()
  await expect(settings.getByLabel('Default model', { exact: true })).toContainText('Test MinerU')
  await page.keyboard.press('Escape')
}
