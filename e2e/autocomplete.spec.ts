import { pressAppShortcut } from './application-menu'
import { openAppMenu, clickAppMenuItem } from './application-menu'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type { AutocompleteRequest } from '../src/shared/contracts/autocomplete'
import { IPC_CHANNELS } from '../src/shared/contracts/channels'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

// Main-only response fixture. Production settings, credential resolution, session toggle,
// preload validation and the real BlockNote editor remain active. Adapter/service tests
// separately exercise transport, cancellation, authorization and rate limits.
async function installCompletionFixture(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }, channel) => {
    const state = {
      calls: [] as Array<{ atBlockEnd: boolean; prefix: string; suffix: string }>,
      text: null as string | null,
      delay: 60
    }
    ;(globalThis as unknown as { autocompleteFixture: typeof state }).autocompleteFixture = state
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, input: AutocompleteRequest) => {
      state.calls.push({ atBlockEnd: input.atBlockEnd, prefix: input.prefix, suffix: input.suffix })
      await new Promise((resolve) => setTimeout(resolve, state.delay))
      return {
        requestId: input.requestId,
        generation: input.generation,
        status: 'suggestion',
        text: state.text ?? (input.atBlockEnd ? ' continuation' : ' bridge')
      }
    })
  }, IPC_CHANNELS.autocompleteComplete)
}
async function calls(app: ElectronApplication) {
  return app.evaluate(
    () =>
      (
        globalThis as unknown as {
          autocompleteFixture: {
            calls: Array<{ atBlockEnd: boolean; prefix: string; suffix: string }>
          }
        }
      ).autocompleteFixture.calls
  )
}
async function caret(block: Locator, offset: number) {
  await block.evaluate((element, position) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    let remaining = position
    while (node && remaining > (node.textContent?.length ?? 0)) {
      remaining -= node.textContent?.length ?? 0
      node = walker.nextNode()
    }
    if (!node) throw new Error('Text position missing')
    const range = document.createRange()
    range.setStart(node, remaining)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    ;(element.closest('[contenteditable=true]') as HTMLElement)?.focus()
    document.dispatchEvent(new Event('selectionchange'))
  }, offset)
}
async function revisionText(page: Page) {
  return page.evaluate(async () => {
    const { activeProject } = await window.desktop.projects.lifecycle()
    if (!activeProject) throw new Error('No project')
    const { projectSessionId } = activeProject
    const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
    return JSON.stringify(
      (
        await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: workspace.sections[0].section.sectionId
        })
      ).revision.content
    )
  })
}

test(
  'autocomplete routes by block, stays ephemeral and accepts with one undo',
  scenario('manuscript.autocomplete', ['@packaged']),
  async ({ testRoot }, testInfo) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, testRoot]
    })
    let { page, app } = launched
    try {
      await page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Autocomplete proof')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Autocomplete proof')
      const toggle = page.getByRole('button', { name: /^Autocomplete:/ })
      const toggleEnabled = async () => {
        await toggle.click()
        await page
          .getByRole('menuitemcheckbox', { name: 'Enable autocomplete', exact: true })
          .click()
      }
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: Off · Words')
      await toggleEnabled()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await expect(settings.getByText('Default Models', { exact: true }).last()).toBeVisible()
      await expect(settings.getByRole('combobox')).toHaveText('Not selected')
      await settings.getByRole('combobox').click()
      await page.getByRole('option', { name: 'DeepSeek · deepseek-v4-pro', exact: true }).click()
      await expect(
        settings.getByText('Configure and enable DeepSeek in Agent API to use autocomplete.')
      ).toBeVisible()
      const autoEnable = settings.getByRole('switch', { name: 'Automatically enable autocomplete' })
      const offColor = await autoEnable.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
      await autoEnable.click()
      await settings.getByRole('radio', { name: 'Sentence', exact: true }).click()
      await expect
        .poll(() => page.evaluate(() => window.desktop.autocomplete.settings()))
        .toMatchObject({ defaultEnabled: true, style: 'sentence' })
      await expect(
        settings.getByRole('switch', { name: 'Automatically enable autocomplete' })
      ).toBeChecked()
      await expect
        .poll(() => autoEnable.evaluate((element) => getComputedStyle(element).backgroundColor))
        .not.toBe(offColor)
      await page.screenshot({
        path: testInfo.outputPath('autocomplete-settings.png'),
        animations: 'disabled'
      })
      await settings.getByRole('button', { name: 'Close settings', exact: true }).first().click()
      await page.evaluate(async () => {
        await window.desktop.providers.setAgentCredential({
          presetId: 'builtin:deepseek',
          apiKey: 'fixture-autocomplete-key'
        })
        await window.desktop.providers.setAgentProviderEnabled({
          presetId: 'builtin:deepseek',
          enabled: true
        })
      })
      await installCompletionFixture(app)
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: On · Sentence')
      await toggleEnabled()
      // The closed trigger reflects the temporary style; keyboard selection never enables it.
      await toggle.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('p')
      await expect(
        page.getByRole('menuitemradio', {
          name: 'Paragraph · Continue this paragraph',
          exact: true
        })
      ).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: Off · Paragraph')
      expect((await calls(app)).length).toBe(0)
      expect(await page.evaluate(() => window.desktop.autocomplete.settings())).toMatchObject({
        defaultEnabled: true,
        style: 'sentence'
      })
      await toggle.click()
      await expect(
        page.getByRole('menuitemradio', {
          name: 'Paragraph · Continue this paragraph',
          exact: true
        })
      ).toBeChecked()
      await page.screenshot({ path: testInfo.outputPath('autocomplete-style-menu.png') })
      await page.keyboard.press('Escape')
      const editor = sectionEditor(page)
      await editor.click()
      await page.keyboard.type('First block.')
      await page.keyboard.press('Enter')
      await page.keyboard.type('Later block.')
      await pressAppShortcut(page, 'ControlOrMeta+s')
      await expect(page.getByText('Saved', { exact: true }).last()).toBeVisible()
      await toggleEnabled()
      await expect(toggle).toHaveAttribute('aria-label', /^Autocomplete: On/)
      const first = editor.locator('.bn-inline-content').first()
      const ghost = editor.locator('[data-autocomplete-suggestion]')
      await caret(first, 12)
      await page.keyboard.type('!')
      await expect(ghost).toHaveText(' continuation')
      await page.screenshot({ path: testInfo.outputPath('autocomplete-suggestion.png') })
      expect((await calls(app)).at(-1)).toMatchObject({
        atBlockEnd: true,
        prefix: 'First block.!',
        suffix: ''
      })
      await expect(page.getByText('Saved', { exact: true }).last()).toBeVisible()
      expect(await revisionText(page)).not.toContain('continuation')
      await expect(ghost).toHaveText(' continuation')
      await page.keyboard.press('Tab')
      await expect(ghost).toHaveCount(0)
      await expect(first).toHaveText('First block.! continuation')
      // No additional typing: accepting automatically generates the next suggestion.
      await expect(ghost).toHaveText(' continuation')
      await page.keyboard.press('Tab')
      await expect(first).toHaveText('First block.! continuation continuation')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(first).toHaveText('First block.! continuation')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(first).toHaveText('First block.!')
      await page.keyboard.press('Escape')

      await caret(first, 5)
      await page.keyboard.type('X')
      await expect(ghost).toHaveText(' bridge')
      expect((await calls(app)).at(-1)).toMatchObject({
        atBlockEnd: false,
        prefix: 'FirstX',
        suffix: ' block.!'
      })
      const beforeMatching = (await calls(app)).length
      await page.keyboard.type(' br')
      await expect(ghost).toHaveText('idge')
      await page.waitForTimeout(750)
      expect((await calls(app)).length).toBe(beforeMatching)
      await page.keyboard.press('Tab')
      await expect(first).toHaveText('FirstX bridge block.!')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(first).toHaveText('FirstX br block.!')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(first).toHaveText('FirstX block.!')
      await page.keyboard.press('Escape')
      await caret(first, 14)
      await page.keyboard.type('Z')
      await expect(ghost).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(ghost).toHaveCount(0)
      await page.waitForTimeout(750)
      await expect(ghost).toHaveCount(0)

      const beforeRefocus = (await calls(app)).length
      await toggle.click()
      await page.keyboard.press('Escape')
      await editor.focus()
      await page.waitForTimeout(750)
      expect((await calls(app)).length).toBe(beforeRefocus)
      await expect(ghost).toHaveCount(0)
      await app.evaluate(() => {
        ;(
          globalThis as unknown as { autocompleteFixture: { text: string | null } }
        ).autocompleteFixture.text = '推荐内容'
      })
      await page.keyboard.type('。')
      await expect(ghost).toHaveText('推荐内容')
      const beforeComposition = (await calls(app)).length
      await editor.dispatchEvent('compositionstart', { data: '' })
      await page.keyboard.insertText('tuijian')
      await expect(ghost).toHaveCount(0)
      await page.waitForTimeout(750)
      expect((await calls(app)).length).toBe(beforeComposition)
      for (let index = 0; index < 7; index++) await page.keyboard.press('Shift+ArrowLeft')
      await page.keyboard.insertText('推荐')
      await editor.dispatchEvent('compositionend', { data: '推荐' })
      await expect(ghost).toHaveText('内容')
      expect((await calls(app)).length).toBe(beforeComposition)
      await page.keyboard.press('Tab')
      await expect(first).toContainText('推荐内容')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(first).not.toContainText('内容')
      await expect(first).toContainText('推荐')
      await page.keyboard.type('?')
      await expect(ghost).toHaveText('推荐内容')
      await editor.dispatchEvent('compositionstart', { data: '' })
      await page.keyboard.insertText('tuijian')
      for (let index = 0; index < 7; index++) await page.keyboard.press('Shift+ArrowLeft')
      await page.keyboard.press('Backspace')
      await editor.dispatchEvent('compositionend', { data: '' })
      await expect(ghost).toHaveText('推荐内容')
      await app.evaluate(() => {
        ;(
          globalThis as unknown as { autocompleteFixture: { text: string | null } }
        ).autocompleteFixture.text = null
      })
      await page.evaluate(async () => {
        await window.desktop.providers.setAgentProviderEnabled({
          presetId: 'builtin:deepseek',
          enabled: false
        })
      })
      await expect(ghost).toHaveCount(0)
      await toggle.click()
      await expect(
        page.getByRole('menuitem', { name: 'Set up autocomplete…', exact: true })
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await page.evaluate(async () => {
        await window.desktop.providers.setAgentProviderEnabled({
          presetId: 'builtin:deepseek',
          enabled: true
        })
      })
      await app.evaluate(() => {
        ;(
          globalThis as unknown as { autocompleteFixture: { delay: number } }
        ).autocompleteFixture.delay = 900
      })
      await editor.click()
      const beforeLate = (await calls(app)).length
      await page.keyboard.type('Late')
      await expect.poll(async () => (await calls(app)).length).toBeGreaterThan(beforeLate)
      await toggle.click()
      const beforeMenu = (await calls(app)).length
      await page.waitForTimeout(1_000)
      expect((await calls(app)).length).toBe(beforeMenu)
      await expect(ghost).toHaveCount(0)
      await page
        .getByRole('menuitemradio', { name: 'Sentence · Finish this sentence', exact: true })
        .click()
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: On · Sentence')
      await expect(ghost).toHaveCount(0)
      await toggleEnabled()
      await page.waitForTimeout(1_000)
      await expect(ghost).toHaveCount(0)
      await expect(toggle).toHaveAttribute('aria-label', /^Autocomplete: Off/)

      await toggleEnabled()
      await page.getByRole('button', { name: 'Notebook', exact: true }).click()
      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(toggle).toHaveAttribute('aria-label', /^Autocomplete: On/)
      await page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const outline = page.getByRole('dialog', { name: 'Outline editor' })
      await outline.getByRole('button', { name: 'New section', exact: true }).click()
      const sectionDialog = page.getByRole('dialog', { name: 'Create section' })
      await sectionDialog.getByLabel('Section title').fill('Second section')
      await sectionDialog.getByRole('button', { name: 'Create', exact: true }).click()
      const item = outline
        .getByTestId(/^outline-editor-section-/)
        .filter({ hasText: 'Second section' })
      await item.getByRole('button').first().click()
      await outline.getByRole('button', { name: 'Open in editor', exact: true }).click()
      await expect(page.getByLabel('Section title')).toHaveValue('Second section')
      await expect(toggle).toHaveAttribute('aria-label', /^Autocomplete: On/)
      await editor.click()
      await page.keyboard.type('/')
      await expect(page.getByText('Heading 1', { exact: true }).last()).toBeVisible()
      await expect(ghost).toHaveCount(0)
      await page.keyboard.press('Escape')
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'Close project and return to chooser', false)
      await expect(page.getByRole('button', { name: 'Create project', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Open Autocomplete proof', exact: true }).click()
      await expectActiveProject(page, 'Autocomplete proof')
      await expect(toggle).toHaveAttribute('aria-label', /^Autocomplete: On/)
      expect(await page.evaluate(() => window.desktop.autocomplete.settings())).toMatchObject({
        selection: { modelId: 'deepseek-v4-pro' },
        style: 'sentence'
      })
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: On · Sentence')
      await page.screenshot({ path: testInfo.outputPath('autocomplete-editor.png') })
      await openAppMenu(page, 'Project')
      await clickAppMenuItem(page, 'Close project and return to chooser', false)
      await page.getByRole('button', { name: 'Create project', exact: true }).click()
      await create.getByLabel('Project name').fill('Another autocomplete project')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Another autocomplete project')
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: On · Sentence')
      await toggle.click()
      await page
        .getByRole('menuitemradio', { name: 'Paragraph · Continue this paragraph', exact: true })
        .click()
      await page.evaluate(async () => {
        await window.desktop.autocomplete.setStyle('word')
        await window.desktop.autocomplete.setDefaultEnabled(false)
      })
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: On · Paragraph')
      await toggle.click()
      await page.getByRole('menuitem', { name: 'Restore defaults', exact: true }).click()
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: Off · Words')
      await page.evaluate(async () => {
        await window.desktop.autocomplete.setStyle('sentence')
        await window.desktop.autocomplete.setDefaultEnabled(true)
      })
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: On · Sentence')
      await toggleEnabled()
      await toggle.click()
      await page
        .getByRole('menuitemradio', { name: 'Paragraph · Continue this paragraph', exact: true })
        .click()
      await expect(toggle).toHaveAttribute('aria-label', 'Autocomplete: Off · Paragraph')
      await app.close()
      ;({ page, app } = await launchApp({ userData: join(testRoot, 'user-data') }))
      await page
        .getByRole('button', { name: 'Open Another autocomplete project', exact: true })
        .click()
      await expectActiveProject(page, 'Another autocomplete project')
      await expect(page.getByRole('button', { name: /^Autocomplete:/ })).toHaveAttribute(
        'aria-label',
        'Autocomplete: On · Sentence'
      )
      expect(
        await page.evaluate(async () => {
          const { activeProject } = await window.desktop.projects.lifecycle()
          if (!activeProject) throw new Error('No project')
          return window.desktop.autocomplete.session({
            projectSessionId: activeProject.projectSessionId
          })
        })
      ).toMatchObject({ overrides: { enabled: false, style: false } })
    } finally {
      await app.close()
    }
  }
)
