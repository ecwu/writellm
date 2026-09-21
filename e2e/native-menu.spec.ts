import { pressAppShortcut } from './application-menu'
import { openAppMenu, clickAppMenuItem, expectAppMenuItem, expectAppMenu } from './application-menu'
import { join } from 'node:path'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

test(
  'application menu follows project, modal, reload and window lifecycle',
  scenario('app.native-menu', ['@packaged']),
  async ({ testRoot }, testInfo) => {
    const { app, page } = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    const child = app.process()
    try {
      await expectAppMenu(page)
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'New project')
      const create = page.getByRole('dialog', { name: 'Create project' })
      await expect(create).toBeVisible()
      if (process.platform === 'darwin')
        await expectAppMenuItem(page, 'New project', { enabled: false })
      await create.getByLabel('Project name').fill('Native menu proof')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Native menu proof')
      const editor = sectionEditor(page)
      await expect(editor).toBeVisible()
      if (process.platform === 'darwin') {
        await expect
          .poll(() =>
            app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())
          )
          .toBe('Native menu proof')
        await expect(page.getByTestId('agent-menubar-trigger')).toHaveCount(0)
      }
      await page.evaluate(() => {
        const counts = { save: 0, find: 0 }
        Object.assign(window, { menuTestCounts: counts })
        window.addEventListener('writellm:save', () => counts.save++)
        window.addEventListener('writellm:find', () => counts.find++)
      })
      await editor.fill('Menu save proof')
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'Save')
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { menuTestCounts: { save: number } }).menuTestCounts.save
          )
        )
        .toBe(1)
      await editor.focus()
      await pressAppShortcut(page, 'ControlOrMeta+s')
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { menuTestCounts: { save: number } }).menuTestCounts.save
          )
        )
        .toBe(2)
      await openAppMenu(page, 'Edit')
      await clickAppMenuItem(page, 'Find in manuscript')
      await expect(page.getByTestId('workbench-tool-find')).toBeVisible()
      await openAppMenu(page, 'Layout')
      await clickAppMenuItem(page, 'Agent', true)
      await openAppMenu(page, 'Layout')
      await expectAppMenuItem(page, 'Agent', { checked: false }, true)
      await clickAppMenuItem(page, 'Agent', true)
      await openAppMenu(page, 'Tools')
      await clickAppMenuItem(page, 'Settings')
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
      if (process.platform === 'darwin') await expectAppMenuItem(page, 'Save', { enabled: false })
      await page.keyboard.press('Escape')
      await page.reload()
      await expectActiveProject(page, 'Native menu proof')
      await expect(sectionEditor(page)).toContainText('Menu save proof')
      await expectAppMenu(page)
      await page.screenshot({ path: testInfo.outputPath('native-menu-workspace.png') })
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'Close project and return to chooser')
      await expect(page.getByRole('button', { name: 'Create project', exact: true })).toBeVisible()
      if (process.platform === 'darwin') {
        await expect
          .poll(() =>
            app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())
          )
          .toBe('WriteLLM')
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
        await expect
          .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
          .toBe(0)
        const next = app.waitForEvent('window')
        await app.evaluate(({ Menu }) =>
          Menu.getApplicationMenu()?.getMenuItemById('onOpenSettings')?.click()
        )
        const reopened = await next
        await expect(reopened.getByRole('dialog', { name: 'Settings' })).toBeVisible()
        await reopened.keyboard.press('Escape')
        const closed = app.waitForEvent('close')
        await app.evaluate(({ Menu }) =>
          Menu.getApplicationMenu()?.getMenuItemById('onQuit')?.click()
        )
        await closed
      }
    } finally {
      if (child.exitCode === null) await app.close()
    }
  }
)
