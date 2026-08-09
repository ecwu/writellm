import axe from 'axe-core'
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

      await launched.page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(settings).toBeFocused()
    } finally {
      await launched.app.close()
    }
  }
)
