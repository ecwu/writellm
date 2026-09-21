import { expect, type BrowserContext, type ElectronApplication, type Page } from '@playwright/test'

const applications = new WeakMap<BrowserContext, ElectronApplication>()
export function registerMenuApplication(page: Page, app: ElectronApplication): void {
  applications.set(page.context(), app)
}
function application(page: Page): ElectronApplication {
  const app = applications.get(page.context())
  if (!app) throw new Error('Application menu fixture is not registered')
  return app
}
export function agentToggle(page: Page) {
  return page.getByTestId(
    process.platform === 'darwin' ? 'agent-rail-trigger' : 'agent-menubar-trigger'
  )
}
export async function openAppMenu(page: Page, name: string): Promise<void> {
  if (process.platform !== 'darwin') {
    await page.getByRole('menuitem', { name, exact: true }).click()
    return
  }
  await expect
    .poll(() =>
      application(page).evaluate(
        ({ Menu }, label) => Menu.getApplicationMenu()?.items.some((item) => item.label === label),
        name
      )
    )
    .toBe(true)
}
export async function appMenuItemState(page: Page, label: string, checkbox = false) {
  if (process.platform === 'darwin') {
    return application(page).evaluate(({ Menu }, name) => {
      const items =
        Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items ?? []) ?? []
      const item = items.find((item) => item.label === name)
      return { visible: !!item?.visible, enabled: !!item?.enabled, checked: !!item?.checked }
    }, label)
  }
  const locator = page.getByRole(checkbox ? 'menuitemcheckbox' : 'menuitem', {
    name: label,
    exact: true
  })
  const visible = await locator.isVisible()
  return {
    visible,
    enabled: visible && (await locator.isEnabled()),
    checked: checkbox && visible && (await locator.isChecked())
  }
}
export async function clickAppMenuItem(page: Page, label: string, checkbox = false): Promise<void> {
  if (process.platform !== 'darwin') {
    await page
      .getByRole(checkbox ? 'menuitemcheckbox' : 'menuitem', { name: label, exact: true })
      .click()
    return
  }
  await expect.poll(async () => (await appMenuItemState(page, label)).enabled).toBe(true)
  await application(page).evaluate(({ Menu, BrowserWindow }, name) => {
    const item = Menu.getApplicationMenu()
      ?.items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.label === name)
    if (!item?.enabled || !item.visible) throw new Error(`Menu item unavailable: ${name}`)
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined)
  }, label)
}
export async function expectAppMenuItem(
  page: Page,
  label: string,
  state: Partial<{ enabled: boolean; checked: boolean; visible: boolean }>,
  checkbox = false
): Promise<void> {
  await expect.poll(() => appMenuItemState(page, label, checkbox)).toMatchObject(state)
}
export async function expectAppMenu(page: Page): Promise<void> {
  if (process.platform !== 'darwin') {
    await expect(page.getByRole('menubar')).toBeVisible()
    return
  }
  await expect(page.getByRole('menubar')).toHaveCount(0)
  await openAppMenu(page, 'Project')
}

/** CDP key dispatch targets Chromium and bypasses macOS application accelerators. */
export async function pressAppShortcut(page: Page, shortcut: string): Promise<void> {
  if (process.platform !== 'darwin') {
    await page.keyboard.press(shortcut)
    return
  }
  await application(page).evaluate(({ BrowserWindow }, chord) => {
    const parts = chord.split('+')
    const keyCode = parts.pop() as string
    const modifiers = parts.map((part) =>
      part === 'ControlOrMeta' || part === 'Meta' ? 'meta' : part.toLowerCase()
    )
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }, shortcut)
}
