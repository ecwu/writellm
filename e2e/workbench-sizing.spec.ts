import { join } from 'node:path'
import { agentToggle, clickAppMenuItem, openAppMenu } from './application-menu'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

test(
  'keeps sidebar widths when closing tools and retains an empty content area',
  scenario('workbench.close-sizing', ['@packaged']),
  async ({ testRoot }, testInfo) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    const { page } = launched
    try {
      await page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Stable sidebars')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Stable sidebars')
      await expect(sectionEditor(page)).toBeVisible()
      const outline = page.getByTestId('workbench-tool-outline')
      const agent = page.getByTestId('agent-panel')
      const width = async (locator: typeof outline): Promise<number> => {
        const box = await locator.boundingBox()
        if (!box) throw new Error('Panel geometry unavailable')
        return box.width
      }
      const initialAgent = await width(agent)
      await page.getByRole('button', { name: 'Close Outline', exact: true }).click()
      await expect(outline).toHaveCount(0)
      await expect.poll(async () => Math.abs((await width(agent)) - initialAgent)).toBeLessThan(2)
      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(outline).toBeVisible()

      // A pointer resize becomes the width to preserve, not the default width.
      const box = await outline.boundingBox()
      if (!box) throw new Error('Outline geometry unavailable')
      await page.mouse.move(box.x + box.width, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
      await expect.poll(() => width(outline)).toBeGreaterThan(box.width + 30)
      const resizedOutline = await width(outline)
      await page.getByRole('button', { name: 'Close writing agent', exact: true }).click()
      await expect(agent).toHaveCount(0)
      await expect
        .poll(async () => Math.abs((await width(outline)) - resizedOutline))
        .toBeLessThan(2)

      await openAppMenu(page, 'Layout')
      await clickAppMenuItem(page, 'References', true)
      await expect(page.getByTestId('workbench-tool-references')).toBeVisible()
      const beforeClose = await width(outline)
      await page.getByRole('button', { name: 'Close References', exact: true }).click()
      await expect(page.getByTestId('workbench-tool-references')).toHaveCount(0)
      await expect.poll(async () => Math.abs((await width(outline)) - beforeClose)).toBeLessThan(2)

      await page.getByRole('button', { name: /^Tab actions / }).click()
      await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
      await expect(page.getByText('No open tabs', { exact: true })).toBeVisible()
      await expect.poll(async () => Math.abs((await width(outline)) - beforeClose)).toBeLessThan(2)
      await agentToggle(page).click()
      await expect(agent).toBeVisible()
      const emptyAgent = await width(agent)
      await openAppMenu(page, 'Layout')
      await clickAppMenuItem(page, 'Outline', true)
      await expect(outline).toHaveCount(0)
      await expect.poll(async () => Math.abs((await width(agent)) - emptyAgent)).toBeLessThan(2)
      await expect(page.getByText('No open tabs', { exact: true })).toBeVisible()

      // Closing a neighbour must not leave a maximum-width constraint behind.
      const moveAgent = page.getByRole('button', { name: 'Move Agent', exact: true })
      await moveAgent.focus()
      await moveAgent.press('Enter')
      await page.getByRole('menuitem', { name: 'Increase panel width' }).focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => width(agent)).toBeGreaterThan(emptyAgent + 30)

      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(outline).toBeVisible()
      await moveAgent.click()
      await page.getByRole('menuitem', { name: 'Move to bottom', exact: true }).click()
      const bottomWidth = await width(agent)
      const outlineWidth = await width(outline)
      await page.getByRole('button', { name: 'Close Outline', exact: true }).click()
      await expect(outline).toHaveCount(0)
      await expect.poll(() => width(agent)).toBeGreaterThan(bottomWidth + outlineWidth - 2)
      await expect(page.getByText('No open tabs', { exact: true })).toBeVisible()

      // Reordered siblings must follow the same rule as the default layout.
      await moveAgent.click()
      await page.getByRole('menuitem', { name: 'Move to left', exact: true }).click()
      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(outline).toBeVisible()
      const reorderedWidth = await width(outline)
      await agentToggle(page).click()
      await expect(agent).toHaveCount(0)
      await expect
        .poll(async () => Math.abs((await width(outline)) - reorderedWidth))
        .toBeLessThan(2)
      await testInfo.attach('empty-content-stable-sidebar', {
        body: await page.screenshot(),
        contentType: 'image/png'
      })
    } finally {
      await launched.app.close()
    }
  }
)
