import { pressAppShortcut } from './application-menu'
import { agentToggle, openAppMenu, clickAppMenuItem, expectAppMenuItem } from './application-menu'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'
import type { Page, Locator } from '@playwright/test'
import type { WorkbenchGridNode } from '../src/shared/contracts/workbench'

async function toolGroups(page: Page) {
  return page.evaluate(async () => {
    const lifecycle = await window.desktop.projects.lifecycle()
    if (lifecycle.state !== 'open') return []
    const layout = await window.desktop.workbench.read({
      projectSessionId: lifecycle.activeProject.projectSessionId
    })
    const collect = (node: WorkbenchGridNode): { views: string[]; activeView?: string }[] =>
      node.type === 'branch' ? node.data.flatMap(collect) : [node.data]
    return layout?.tools ? collect(layout.tools.root) : []
  })
}

test(
  'opens left tools as tabs, preserves widths and restores grouped tools',
  scenario('workbench.tool-tabs', ['@packaged']),
  async ({ testRoot }) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    const { page } = launched
    try {
      await page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Tool tabs')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Tool tabs')
      const outline = page.getByTestId('workbench-tool-outline')
      const agent = page.getByTestId('agent-panel')
      const width = async (locator: Locator) => {
        const bounds = await locator.boundingBox()
        if (!bounds) throw new Error('Tool geometry unavailable')
        return bounds.width
      }
      await expect(outline).toBeVisible()
      await expect(agent).toBeVisible()
      const outlineBox = await outline.boundingBox()
      if (!outlineBox) throw new Error('Outline geometry unavailable')
      await page.mouse.move(outlineBox.x + outlineBox.width, outlineBox.y + outlineBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(
        outlineBox.x + outlineBox.width + 50,
        outlineBox.y + outlineBox.height / 2,
        { steps: 8 }
      )
      await page.mouse.up()
      await expect.poll(() => width(outline)).toBeGreaterThan(outlineBox.width + 25)
      const leftWidth = await width(outline)
      const contentWidth = await width(sectionEditor(page))
      const agentWidth = await width(agent)
      for (const [id, title] of [
        ['find', 'Find'],
        ['references', 'References'],
        ['writing_rules', 'Writing rules'],
        ['comments', 'Comments']
      ]) {
        await page.getByRole('button', { name: title, exact: true }).click()
        const tool = page.getByTestId(`workbench-tool-${id}`)
        await expect(tool).toBeVisible()
        await expect(outline).toBeHidden()
        await expect.poll(async () => Math.abs((await width(tool)) - leftWidth)).toBeLessThan(2)
        await expect
          .poll(async () => Math.abs((await width(sectionEditor(page))) - contentWidth))
          .toBeLessThan(2)
        await expect.poll(async () => Math.abs((await width(agent)) - agentWidth)).toBeLessThan(2)
        await expect.poll(async () => (await toolGroups(page)).length).toBe(3)
      }
      await page.getByRole('button', { name: 'References', exact: true }).click()
      await page.getByRole('button', { name: 'References', exact: true }).click()
      await expect(page.getByTestId('workbench-tool-references')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Close References', exact: true })).toHaveCount(
        1
      )
      await page.getByRole('button', { name: 'Close Find', exact: true }).click()
      await expect(page.getByTestId('workbench-tool-find')).toHaveCount(0)
      await expect(page.getByTestId('workbench-tool-references')).toBeVisible()
      const savedViews = ['outline', 'references', 'writing_rules', 'comments']
      await expect
        .poll(async () => (await toolGroups(page)).find((group) => group.views.includes('outline')))
        .toEqual(expect.objectContaining({ views: savedViews, activeView: 'references' }))
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'Close project and return to chooser', false)
      await page.getByRole('button', { name: 'Open Tool tabs', exact: true }).click()
      await expect(page.getByTestId('workbench-tool-references')).toBeVisible()
      await expect(outline).toBeHidden()
      await expect
        .poll(async () => (await toolGroups(page)).find((group) => group.views.includes('outline')))
        .toEqual(expect.objectContaining({ views: savedViews, activeView: 'references' }))
      await expect
        .poll(async () =>
          Math.abs((await width(page.getByTestId('workbench-tool-references'))) - leftWidth)
        )
        .toBeLessThan(2)

      // A manually split left group nearest the content receives the next new tool.
      await page.getByRole('button', { name: 'Move Outline', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Move to left', exact: true }).click()
      await page.getByRole('button', { name: 'Find', exact: true }).click()
      await expect(page.getByTestId('workbench-tool-find')).toBeVisible()
      await expect
        .poll(
          async () =>
            (await toolGroups(page)).find((group) => group.views.includes('outline'))?.views
        )
        .toEqual(['outline', 'find'])
      await expect.poll(async () => (await toolGroups(page)).length).toBe(4)
      const splitGroups = await toolGroups(page)
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'Close project and return to chooser', false)
      await page.getByRole('button', { name: 'Open Tool tabs', exact: true }).click()
      await expect(page.getByTestId('workbench-tool-find')).toBeVisible()
      await expect.poll(() => toolGroups(page)).toEqual(splitGroups)

      // Right and bottom groups remain independent when no left tool group exists.
      for (const title of ['Outline', 'Find', 'References', 'Writing rules', 'Comments']) {
        await page.getByRole('button', { name: `Move ${title}`, exact: true }).click()
        await page
          .getByRole('menuitem', {
            name: title === 'Find' ? 'Move to bottom' : 'Move to right',
            exact: true
          })
          .click()
      }
      await page.getByRole('button', { name: 'Close Outline', exact: true }).click()
      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(outline).toBeVisible()
      await expect
        .poll(
          async () =>
            (await toolGroups(page)).find((group) => group.views.includes('outline'))?.views
        )
        .toEqual(['outline'])
      await page.getByRole('button', { name: 'Find', exact: true }).click()
      await expect(page.getByTestId('workbench-tool-find')).toBeVisible()
      await expect
        .poll(
          async () => (await toolGroups(page)).find((group) => group.views.includes('find'))?.views
        )
        .toEqual(['find'])

      await openAppMenu(page, 'Layout')
      await clickAppMenuItem(page, 'Reset layout', false)
      await expect(outline).toBeVisible()
      await expect(agent).toBeVisible()
      await expect
        .poll(async () => (await toolGroups(page)).map((group) => group.views))
        .toEqual([['outline'], ['content'], ['agent']])
      await page.getByRole('button', { name: 'References', exact: true }).click()
      await page.getByRole('button', { name: 'Close References', exact: true }).click()
      await expect(outline).toBeVisible()
      const beforeLastClose = await width(sectionEditor(page))
      const beforeAgent = await width(agent)
      await page.getByRole('button', { name: 'Close Outline', exact: true }).click()
      await expect(outline).toHaveCount(0)
      await expect.poll(() => width(sectionEditor(page))).toBeGreaterThan(beforeLastClose + 100)
      await expect.poll(async () => Math.abs((await width(agent)) - beforeAgent)).toBeLessThan(2)
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'retains section editors and independent Notebook tabs, docks tools and restores local layout',
  scenario('workbench.tabs-docking-restore', ['@packaged']),
  async ({ testRoot }, testInfo) => {
    const bibliographyPath = join(testRoot, 'workbench.bib')
    await writeFile(
      bibliographyPath,
      '@article{workbench2026, title={Workbench source}, author={Doe, Jane}, year={2026}}'
    )
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      bibliographyDialogPath: bibliographyPath
    })
    let relaunched: typeof launched | undefined
    const { page } = launched
    try {
      await openAppMenu(page, 'Layout')
      await expectAppMenuItem(page, 'Reset layout', { enabled: false }, false)
      await expectAppMenuItem(page, 'Knowledge', { enabled: false }, true)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Tabbed writing')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Tabbed writing')
      await expect(sectionEditor(page)).toBeVisible()
      const status = page.getByTestId('workbench-status-bar')
      await expect(status).toBeVisible()
      await expect(status).toHaveCSS('height', '28px')
      await expect(status.getByTestId('workbench-section-progress')).toHaveText(
        '0/1 sections completed'
      )
      await expect(page.getByText('Active', { exact: true })).toHaveCount(0)
      for (const [tool, title] of [
        ['find', 'Find'],
        ['comments', 'Comments'],
        ['writing_rules', 'Writing rules']
      ] as const) {
        await openAppMenu(page, 'Layout')
        await clickAppMenuItem(page, title, true)
        const panel = page.getByTestId(`workbench-tool-${tool}`)
        await expect(panel).toBeVisible()
        await expect(panel.getByText('Tabbed writing', { exact: true })).toHaveCount(0)
        await expect(panel.getByRole('button', { name: /^Close / })).toHaveCount(0)
        await expect(page.getByText('0/1 sections completed', { exact: true })).toHaveCount(1)
        await page.getByRole('button', { name: `Close ${title}`, exact: true }).click()
        await expect(panel).toHaveCount(0)
      }

      await expect(status.getByTestId('workbench-word-count')).toContainText(
        'Section 0 / Manuscript 0 words'
      )
      await expect(
        status.getByRole('button', { name: 'AI tasks: Idle', exact: true })
      ).toBeVisible()
      await status.getByRole('button', { name: /^Autocomplete:/ }).click()
      await expect(page.getByRole('menu')).toHaveAttribute('data-side', 'top')
      await page.getByRole('menuitemradio', { name: 'Paragraph · Continue this paragraph' }).click()
      await expect(status.getByRole('button', { name: /Autocomplete:.*Paragraph/ })).toBeVisible()

      await expect(page.getByRole('button', { name: 'Reset layout', exact: true })).toHaveCount(0)
      const layout = {
        click: () => openAppMenu(page, 'Layout'),
        focus: () => page.getByRole('menuitem', { name: 'Layout', exact: true }).focus()
      }
      if (process.platform === 'darwin') await layout.click()
      else {
        await layout.focus()
        await page.keyboard.press('ArrowDown')
      }
      await expectAppMenuItem(page, 'Outline', { checked: true }, true)
      await expectAppMenuItem(page, 'Agent', { checked: true }, true)
      await clickAppMenuItem(page, 'Agent', true)
      await expect(agentToggle(page)).toHaveAttribute('aria-pressed', 'false')
      await agentToggle(page).click()
      await layout.click()
      await expectAppMenuItem(page, 'Agent', { checked: true }, true)
      await clickAppMenuItem(page, 'References', true)
      await expect(page.getByRole('button', { name: 'Move References', exact: true })).toBeVisible()
      await layout.click()
      await expectAppMenuItem(page, 'References', { checked: true }, true)
      await clickAppMenuItem(page, 'References', true)
      await layout.click()
      await clickAppMenuItem(page, 'Knowledge', true)
      await expect(page.getByTestId('workspace-tab-knowledge')).toBeVisible()
      await layout.click()
      await expectAppMenuItem(page, 'Knowledge', { checked: true }, true)
      await clickAppMenuItem(page, 'Knowledge', true)
      await expect(page.getByTestId('workspace-tab-knowledge')).toHaveCount(0)
      await expect(sectionEditor(page)).toBeVisible()
      await page.getByLabel('Section title', { exact: true }).fill('Chapter One')
      await page.getByLabel('Section title', { exact: true }).press('Tab')
      await sectionEditor(page).click()
      await page.keyboard.type('Retained first chapter')
      for (let index = 0; index < 25; index++) {
        await page.keyboard.press('Enter')
        await page.keyboard.type(`Retained paragraph ${index}`)
      }
      await pressAppShortcut(page, 'ControlOrMeta+s')
      await expect(page.getByText('Saved', { exact: true }).last()).toBeVisible()
      const counts = await page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (!projectSessionId) throw new Error('No project session')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        return { section: workspace.sections[0].revision.wordCount, total: workspace.wordCount }
      })
      await expect(status.getByTestId('workbench-word-count')).toHaveText(
        `Section ${counts.section.toLocaleString()} / Manuscript ${counts.total.toLocaleString()} words`
      )
      const original = await sectionEditor(page).elementHandle()
      await page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const outline = page.getByRole('dialog', { name: 'Outline editor' })
      await outline.getByRole('button', { name: 'New section', exact: true }).click()
      const section = page.getByRole('dialog', { name: 'Create section' })
      await section.getByLabel('Section title').fill('Chapter Two')
      await section.getByRole('button', { name: 'Create', exact: true }).click()
      const row = outline.getByTestId(/^outline-editor-section-/).filter({ hasText: 'Chapter Two' })
      await row.getByRole('button').first().click()
      await outline.getByRole('button', { name: 'Open in editor', exact: true }).click()
      await expect(page.getByLabel('Section title', { exact: true })).toHaveValue('Chapter Two')
      await sectionEditor(page).click()
      await page.keyboard.type('Independent second chapter')
      const originalTwo = await sectionEditor(page).elementHandle()
      await page.keyboard.press('ControlOrMeta+z')
      await expect(sectionEditor(page)).not.toContainText('Independent second chapter')
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(sectionEditor(page)).toContainText('Independent second chapter')
      const chapterOne = page
        .getByTestId(/^workspace-tab-section:/)
        .filter({ hasText: 'Chapter One' })
      const chapterTwo = page
        .getByTestId(/^workspace-tab-section:/)
        .filter({ hasText: 'Chapter Two' })
      await chapterOne.getByText('Chapter One', { exact: true }).click()
      await expect(sectionEditor(page)).toContainText('Retained first chapter')
      expect(await original?.evaluate((element) => element.isConnected)).toBe(true)
      const scroll = page
        .locator('[data-slot="sidebar-inset"]')
        .filter({ has: sectionEditor(page) })
      await scroll.evaluate((element) => {
        element.scrollTop = 200
      })
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(200)
      await chapterTwo.getByText('Chapter Two', { exact: true }).click()
      await expect(sectionEditor(page)).toContainText('Independent second chapter')
      expect(await originalTwo?.evaluate((element) => element.isConnected)).toBe(true)
      await sectionEditor(page).click()
      await page.keyboard.press('ControlOrMeta+z')
      // BlockNote may add its trailing empty paragraph as a separate history event on blur.
      if (
        await sectionEditor(page)
          .innerText()
          .then((text) => text.includes('Independent second chapter'))
      )
        await page.keyboard.press('ControlOrMeta+z')
      await expect(sectionEditor(page)).not.toContainText('Independent second chapter')
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(sectionEditor(page)).toContainText('Independent second chapter')
      await chapterOne.getByText('Chapter One', { exact: true }).click()
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(200)
      await chapterTwo.getByText('Chapter Two', { exact: true }).click()
      await expect(page.getByLabel('Section title', { exact: true })).toHaveValue('Chapter Two')
      await expect(sectionEditor(page)).toContainText('Independent second chapter')
      await sectionEditor(page).focus()
      await page.keyboard.press('ControlOrMeta+a')
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toContain('Independent second chapter')
      await chapterOne.getByText('Chapter One', { exact: true }).click()
      await chapterTwo.getByText('Chapter Two', { exact: true }).click()
      await expect(page.getByLabel('Section title', { exact: true })).toHaveValue('Chapter Two')
      await expect(sectionEditor(page)).toContainText('Independent second chapter')
      await sectionEditor(page).focus()
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toContain('Independent second chapter')
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await expect(page.getByTestId('workspace-tab-knowledge')).toBeVisible()
      const knowledge = page.getByTestId('knowledge-workspace')
      await knowledge.getByRole('button', { name: 'Connect Zotero export…' }).click()
      const importReferences = page.getByRole('dialog', { name: 'Import references from Zotero' })
      await importReferences.getByRole('button', { name: 'Review references and PDFs' }).click()
      await page.getByRole('button', { name: 'Import 1 references', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'References imported' })).toBeVisible()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await knowledge.locator('[data-reference-id]').first().click()
      await knowledge.getByRole('button', { name: 'Insert in editor', exact: true }).click()
      await expect(page.getByLabel('Section title', { exact: true })).toHaveValue('Chapter Two')
      await pressAppShortcut(page, 'ControlOrMeta+s')
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const session = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (!session) return ''
            const workspace = await window.desktop.manuscript.workspace({
              projectSessionId: session
            })
            const section = workspace.sections.find((item) => item.section.title === 'Chapter Two')
            if (!section) return ''
            return JSON.stringify(
              (
                await window.desktop.editor.loadSection({
                  projectSessionId: session,
                  sectionId: section.section.sectionId
                })
              ).revision.content
            )
          })
        )
        .toContain('workbench2026')
      const formattedReferences = await page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (!projectSessionId) throw new Error('Project session missing')
        return window.desktop.knowledge.formatReferences({ projectSessionId })
      })
      expect(formattedReferences.citations).toHaveLength(1)
      expect(formattedReferences.citations[0]?.formatted).not.toContain('@workbench2026')
      expect(formattedReferences.bibliography).toEqual([
        expect.objectContaining({
          citationKey: 'workbench2026',
          formatted: expect.stringContaining('Workbench source')
        })
      ])
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await expect(page.getByTestId('workspace-tab-knowledge')).toHaveCount(1)
      await expect(status.getByTestId('workbench-word-count')).not.toContainText('Section')
      await status.getByRole('button', { name: /^Index:/ }).click()
      await expect(page.getByTestId('workspace-tab-knowledge')).toHaveCount(1)

      await openAppMenu(page, 'Layout')
      await clickAppMenuItem(page, 'New Notebook', false)
      await expect(page.getByTestId(/^workspace-tab-notebook:/)).toHaveCount(1)
      await page
        .getByRole('textbox', { name: 'Ask selected Knowledge sources' })
        .fill('Draft for Notebook one')
      await page.getByRole('button', { name: 'New Notebook', exact: true }).click()
      await expect(page.getByTestId(/^workspace-tab-notebook:/)).toHaveCount(2)
      await expect(page.getByText('Notebook 2', { exact: true })).toBeVisible()
      await expect(
        page.getByRole('textbox', { name: 'Ask selected Knowledge sources' })
      ).toHaveValue('')
      await status.getByRole('button', { name: /^AI tasks:/ }).click()
      await page.getByRole('menuitem', { name: 'Notebook 1 · Idle', exact: true }).click()
      await expect(
        page.getByRole('textbox', { name: 'Ask selected Knowledge sources' })
      ).toHaveValue('Draft for Notebook one')
      await page.getByRole('button', { name: 'Tab actions Notebook 1', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.getByRole('button', { name: 'Keep open', exact: true }).click()
      await expect(page.getByTestId(/^workspace-tab-notebook:/)).toHaveCount(2)
      await page.getByRole('button', { name: 'Move Agent', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Move to bottom', exact: true }).click()
      const barBounds = await status.boundingBox()
      const dockBounds = await page.getByTestId('agent-panel').boundingBox()
      if (!barBounds || !dockBounds) throw new Error('Workbench geometry unavailable')
      expect(barBounds.y).toBeGreaterThanOrEqual(dockBounds.y + dockBounds.height - 1)
      await page.getByRole('button', { name: 'Move Outline', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Move to right', exact: true }).click()
      await expect
        .poll(async () =>
          page.evaluate(async () => {
            const lifecycle = await window.desktop.projects.lifecycle()
            if (lifecycle.state !== 'open') return false
            return (
              (
                await window.desktop.workbench.read({
                  projectSessionId: lifecycle.activeProject.projectSessionId
                })
              )?.tools != null
            )
          })
        )
        .toBe(true)
      await openAppMenu(page, 'Layout')
      await clickAppMenuItem(page, 'Reset layout', false)
      await expect(page.getByTestId(/^workspace-tab-notebook:/)).toHaveCount(2)
      await layout.click()
      await expectAppMenuItem(page, 'Outline', { checked: true }, true)
      await expectAppMenuItem(page, 'Agent', { checked: true }, true)
      await page.keyboard.press('Escape')
      await chapterOne.getByText('Chapter One', { exact: true }).click()
      await expect(sectionEditor(page)).toContainText('Retained first chapter')
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'Close project and return to chooser', false)
      await expect
        .poll(async () => (await page.evaluate(() => window.desktop.projects.lifecycle())).state)
        .toBe('closed')
      await expect(status).toHaveCount(0)
      await page.getByRole('button', { name: 'Open Tabbed writing', exact: true }).click()
      await expect(page.getByTestId(/^workspace-tab-section:/)).toHaveCount(2)
      await expect(page.getByTestId('workspace-tab-knowledge')).toBeVisible()
      await expect(page.getByTestId(/^workspace-tab-notebook:/)).toHaveCount(0)
      await expect(sectionEditor(page)).toContainText('Retained first chapter')
      await mkdir('.cache/verification/workbench-preview', { recursive: true })
      await expect(scroll).toHaveCSS('color-scheme', 'light')
      await page.screenshot({ path: '.cache/verification/workbench-preview/workbench.png' })
      await openAppMenu(page, 'Tools')
      await clickAppMenuItem(page, 'Settings')
      const settings = page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('option', { name: 'General', exact: true }).click()
      await settings.getByRole('radio', { name: 'Dark', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe('dark')
      await page.screenshot({
        path: '.cache/verification/workbench-preview/workbench-dark.png',
        animations: 'disabled'
      })
      await openAppMenu(page, 'Tools')
      await clickAppMenuItem(page, 'Settings')
      await settings.getByRole('option', { name: 'General', exact: true }).click()
      await settings.getByRole('radio', { name: 'Light', exact: true }).click()
      await page.keyboard.press('Escape')

      await testInfo.attach('workbench', {
        body: await page.screenshot(),
        contentType: 'image/png'
      })
      await launched.app.close()
      relaunched = await launchApp({ userData: join(testRoot, 'user-data') })
      const reopened = relaunched.page
      await reopened.getByRole('button', { name: 'Open Tabbed writing', exact: true }).click()
      await expect(reopened.getByTestId(/^workspace-tab-section:/)).toHaveCount(2)
      await expect(reopened.getByTestId('workspace-tab-knowledge')).toBeVisible()
      await expect(reopened.getByTestId(/^workspace-tab-notebook:/)).toHaveCount(0)
      await expect(sectionEditor(reopened)).toContainText('Retained first chapter')
      await agentToggle(reopened).click()
      const firstTab = reopened
        .getByTestId(/^workspace-tab-section:/)
        .filter({ hasText: 'Chapter One' })
      const secondTab = reopened
        .getByTestId(/^workspace-tab-section:/)
        .filter({ hasText: 'Chapter Two' })
      await secondTab.dragTo(firstTab)
      await expect(reopened.getByTestId(/^workspace-tab-section:/).first()).toContainText(
        'Chapter Two'
      )
      await secondTab.getByRole('button', { name: 'Tab actions Chapter Two' }).click()
      await reopened.getByRole('menuitem', { name: 'Close other tabs', exact: true }).click()
      await expect(reopened.getByTestId(/^workspace-tab-section:/)).toHaveCount(1)
      await expect(reopened.getByTestId('workspace-tab-knowledge')).toHaveCount(0)
      await secondTab.getByRole('button', { name: 'Tab actions Chapter Two' }).click()
      await reopened.getByRole('menuitem', { name: 'Close', exact: true }).click()
      await expect(reopened.getByText('No open tabs', { exact: true })).toBeVisible()
      await openAppMenu(reopened, 'Layout')
      await clickAppMenuItem(reopened, 'Outline', true)
      await expect(reopened.getByTestId(/^outline-section-/)).toHaveCount(0)
      await reopened.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(reopened.getByText('No open tabs', { exact: true })).toBeVisible()
      await expect(reopened.getByTestId(/^outline-section-/)).toHaveCount(2)
      await expect(reopened.getByText('Action failed', { exact: true })).toHaveCount(0)

      // Insertion requires an open section; it must not linger until a later navigation.
      await reopened.getByRole('button', { name: 'Knowledge', exact: true }).click()
      const reopenedKnowledge = reopened.getByTestId('knowledge-workspace')
      await reopenedKnowledge.locator('[data-reference-id]').first().click()
      await reopenedKnowledge.getByRole('button', { name: 'Insert in editor', exact: true }).click()
      const missingSection = reopened.getByText(
        'Choose a section from Outline before inserting a reference.',
        { exact: true }
      )
      await expect(missingSection).toBeVisible()
      await expect(reopened.getByTestId(/^workspace-tab-section:/)).toHaveCount(0)
      await reopened
        .locator('[data-sonner-toast]')
        .filter({ has: missingSection })
        .getByRole('button')
        .click()
      await expect(missingSection).toHaveCount(0)
      await reopened
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Chapter One' })
        .click()
      await expect(sectionEditor(reopened)).toContainText('Retained first chapter')
      await expect(sectionEditor(reopened)).not.toContainText('workbench2026')
      await reopened
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Chapter Two' })
        .click()
      await expect(reopened.getByLabel('Section title', { exact: true })).toHaveValue('Chapter Two')
      await reopened
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Chapter One' })
        .click()
      await reopened
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Chapter Two' })
        .click()
      await expect(reopened.getByTestId(/^workspace-tab-section:/)).toHaveCount(2)
      // The earlier insertion replaces the retained selection in Chapter Two.
      await expect(sectionEditor(reopened)).toContainText('[@workbench2026]')
      await reopened.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await reopened.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(reopened.getByLabel('Section title', { exact: true })).toHaveValue('Chapter Two')
      await expect(reopened.getByText('Action failed', { exact: true })).toHaveCount(0)
      await reopened.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const edit = reopened.getByRole('dialog', { name: 'Outline editor' })
      await edit.getByRole('button', { name: 'Delete', exact: true }).click()
      await reopened
        .getByRole('alertdialog', { name: 'Delete section?' })
        .getByRole('button', { name: 'Delete section', exact: true })
        .click()
      await expect(
        reopened.getByTestId(/^workspace-tab-section:/).filter({ hasText: 'Chapter Two' })
      ).toHaveCount(0)
    } finally {
      if (relaunched) await relaunched.app.close()
      else await launched.app.close()
    }
  }
)
