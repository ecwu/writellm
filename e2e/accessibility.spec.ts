import axe from 'axe-core'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, scenario, test } from './fixtures'

test(
  'keyboard user can open and close Settings in an accessible application shell',
  scenario('accessibility.shell-settings', ['@critical', '@packaged']),
  async ({ testRoot }, testInfo) => {
    const launched = await launchApp({ userData: join(testRoot, 'user-data') })
    try {
      const settings = launched.page.getByRole('button', { name: 'Settings', exact: true })
      await settings.focus()
      await expect(settings).toBeFocused()
      await settings.press('Enter')

      const dialog = launched.page.getByRole('dialog', { name: 'Settings' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible()

      const expectedSections = [
        'general',
        'agent',
        'skills',
        'embedding',
        'rerank',
        'mineru',
        'image',
        'publication',
        'shortcuts',
        'about'
      ]
      expect(
        await dialog
          .locator('[data-settings-section]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-settings-section'))
          )
      ).toEqual(expectedSections)
      const screenshotDirectory = process.env.WRITELLM_CP62_SCREENSHOT_DIR
      if (screenshotDirectory !== undefined) {
        await mkdir(screenshotDirectory, { recursive: true })
      }

      await dialog.getByRole('radio', { name: 'Light', exact: true }).click()
      await dialog.getByRole('radio', { name: 'Blue', exact: true }).click()
      await dialog.getByRole('radio', { name: '[1]', exact: true }).click()
      await dialog.getByRole('radio', { name: 'Write Auto', exact: true }).click()
      await expect
        .poll(() =>
          launched.page.evaluate(async () => ({
            theme: await window.desktop.app.getThemePreference(),
            accent: await window.desktop.app.getAccentPreference(),
            citation: await window.desktop.app.getCitationDisplayMode(),
            approval: await window.desktop.app.getDefaultAgentApprovalMode()
          }))
        )
        .toEqual({
          theme: 'light',
          accent: 'blue',
          citation: 'numbered',
          approval: 'section_auto'
        })

      await dialog.locator('[data-settings-section="shortcuts"]').click()
      await expect(
        dialog.getByRole('heading', { name: 'Keyboard Shortcuts', exact: true })
      ).toBeVisible()
      await expect(dialog.getByRole('table')).toBeVisible()
      await expect(dialog.getByRole('row')).toHaveCount(11)
      await expect(dialog.getByText('⌘ / Ctrl + N', { exact: true })).toBeVisible()
      await expect(dialog.getByText('⇧ + ⌘ / Ctrl + K', { exact: true })).toBeVisible()
      await expect(dialog.getByText('⌘ / Ctrl + ⌥ / Alt + ↓', { exact: true })).toBeVisible()
      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp62-settings-shortcuts-desktop.png'),
          animations: 'disabled'
        })
      }

      await dialog.locator('[data-settings-section="about"]').click()
      await expect(
        dialog.getByRole('heading', { name: 'About & Diagnostics', exact: true })
      ).toBeVisible()
      await expect(dialog.getByText('Credential security', { exact: true })).toBeVisible()
      await expect(dialog.getByText(/^Version /u)).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Open logs' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Export diagnostics' })).toBeVisible()

      await launched.page.evaluate(axe.source)
      const results = await launched.page.evaluate(async () => {
        const axeRuntime = (globalThis as typeof globalThis & { axe: typeof axe }).axe
        return axeRuntime.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
          }
        })
      })
      if (results.violations.length > 0) {
        await testInfo.attach('axe-violations.json', {
          body: Buffer.from(JSON.stringify(results.violations, null, 2)),
          contentType: 'application/json'
        })
      }
      expect(results.violations).toEqual([])

      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp62-settings-desktop.png'),
          animations: 'disabled'
        })
      }

      await dialog.locator('[data-settings-section="general"]').click()
      await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible()

      await launched.page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(settings).toBeFocused()
    } finally {
      await launched.app.close()
    }
  }
)
