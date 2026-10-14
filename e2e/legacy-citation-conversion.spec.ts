import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { IPC_CHANNELS } from '../src/shared/contracts/channels'
import { pressAppShortcut } from './application-menu'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

async function prepare(page: Page) {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create project' })
  await create.getByLabel('Project name').fill('Legacy conversion')
  await create.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, 'Legacy conversion')
  await expect(page.getByLabel('Section title')).toHaveValue('Untitled Section')
  await page.evaluate(async () => {
    const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
      ?.projectSessionId
    if (!projectSessionId) throw new Error('Project missing')
    const snapshot = await window.desktop.knowledge.chooseBibliography({ projectSessionId })
    if (!snapshot) throw new Error('Bibliography missing')
    const plan = await window.desktop.knowledge.prepareReferenceImport({
      projectSessionId,
      connectorId: snapshot.connector.connectorId,
      candidateIds: snapshot.candidates.map((item) => item.candidateId),
      includePdf: false
    })
    await window.desktop.knowledge.confirmReferenceImport({
      projectSessionId,
      previewId: plan.previewId,
      selections: plan.items.map((item) => ({
        candidateId: item.candidateId,
        targetReferenceId: null,
        primaryAttachmentId: null,
        supplementAttachmentIds: []
      }))
    })
  })
  const editor = sectionEditor(page)
  await editor.click()
  await page.keyboard.type('Legacy [Source: Fixture, p. 2]')
  await pressAppShortcut(page, 'ControlOrMeta+s')
  await expect(page.getByText('Saved', { exact: true }).last()).toBeVisible()
  return current(page)
}

async function current(page: Page) {
  return page.evaluate(async () => {
    const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
      ?.projectSessionId
    if (!projectSessionId) throw new Error('Project missing')
    const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
    const section = workspace.sections[0]
    if (!section) throw new Error('Section missing')
    return {
      projectSessionId,
      ...(
        await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: section.section.sectionId
        })
      ).revision
    }
  })
}

async function review(page: Page) {
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
  await page
    .getByTestId('knowledge-workspace')
    .getByRole('button', { name: 'Knowledge actions' })
    .click()
  await page.getByRole('menuitem', { name: 'Convert legacy title citations…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Convert legacy citations' })
  await expect(dialog.getByText('@fixture2026', { exact: true })).toBeVisible()
  return dialog
}

async function gateConversion(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }, channel) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
    )._invokeHandlers
    const original = handlers.get(channel)
    if (!original) throw new Error('Conversion handler missing')
    let release = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const gate = { started: false, release }
    ;(globalThis as unknown as { conversionGate: typeof gate }).conversionGate = gate
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args) => {
      gate.started = true
      await pending
      return original(...args)
    })
  }, IPC_CHANNELS.referenceApplyLegacyConversion)
}

async function releaseConversion(app: ElectronApplication) {
  await app.evaluate(() => {
    ;(globalThis as unknown as { conversionGate?: { release(): void } }).conversionGate?.release()
  })
}

test(
  'distinguishes an expired conversion review from a database failure',
  scenario('manuscript.legacy-conversion-errors'),
  async ({ testRoot }) => {
    const bibliography = join(testRoot, 'library.bib')
    await writeFile(
      bibliography,
      '@article{fixture2026, title={Fixture}, author={Doe, Jane}, year={2026}}'
    )
    const { page, app } = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      bibliographyDialogPath: bibliography
    })
    try {
      const base = await prepare(page)
      const stale = await review(page)
      await page.evaluate(async ({ projectSessionId }) => {
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        await window.desktop.manuscript.createSection({
          projectSessionId,
          create: {
            baseOutlineVersion: workspace.outlineVersion,
            parentSectionId: null,
            position: 1,
            title: 'Second',
            objective: null,
            status: 'drafting'
          }
        })
      }, base)
      await stale.getByRole('button', { name: 'Convert confirmed matches' }).click()
      await expect(
        page.getByText(
          'The manuscript changed or the plan expired. Create and review a new conversion plan.',
          { exact: true }
        )
      ).toBeVisible()
      const failed = await review(page)
      await app.evaluate(
        (_electron, databasePath) => {
          const { createRequire } = process.getBuiltinModule('module')
          const Database = createRequire(`${process.cwd()}/package.json`)('better-sqlite3')
          const database = new Database(databasePath)
          try {
            database.exec(
              "CREATE TRIGGER reject_conversion BEFORE INSERT ON section_revisions BEGIN SELECT RAISE(FAIL, 'fixture conversion failure'); END"
            )
          } finally {
            database.close()
          }
        },
        join(testRoot, 'Legacy conversion.writellm', '.writellm', 'project.sqlite')
      )
      await failed.getByRole('button', { name: 'Convert confirmed matches' }).click()
      await expect(
        page.getByText('Legacy citations could not be converted. Try again or open Diagnostics.', {
          exact: true
        })
      ).toBeVisible()
      expect((await current(page)).sectionRevisionId).toBe(base.sectionRevisionId)
    } finally {
      await app.close()
    }
  }
)

for (const dirty of [false, true]) {
  test(
    dirty
      ? 'preserves an unsaved draft when legacy conversion advances its base'
      : 'refreshes an open clean editor after legacy conversion',
    scenario(dirty ? 'manuscript.legacy-conversion-draft' : 'manuscript.legacy-conversion-refresh'),
    async ({ testRoot }) => {
      const bibliography = join(testRoot, 'library.bib')
      await writeFile(
        bibliography,
        '@article{fixture2026, title={Fixture}, author={Doe, Jane}, year={2026}}'
      )
      const launched = await launchApp({
        userData: join(testRoot, 'user-data'),
        dialogPaths: [testRoot],
        bibliographyDialogPath: bibliography
      })
      const { page, app } = launched
      try {
        const base = await prepare(page)
        const dialog = await review(page)
        if (dirty) await gateConversion(app)
        await dialog.getByRole('button', { name: 'Convert confirmed matches' }).click()
        if (dirty) {
          await expect
            .poll(() =>
              app.evaluate(
                () =>
                  (globalThis as unknown as { conversionGate: { started: boolean } }).conversionGate
                    .started
              )
            )
            .toBe(true)
          await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
        } else {
          await expect(dialog).not.toBeVisible()
        }
        await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
        const editor = sectionEditor(page)
        await expect(editor).toBeVisible()
        if (dirty) {
          await editor.click()
          await page.keyboard.press('ControlOrMeta+End')
          await editor.dispatchEvent('compositionstart', { data: '' })
          await page.keyboard.insertText(' unsaved draft')
          await releaseConversion(app)
          await expect(page.getByText('Conflict', { exact: true }).last()).toBeVisible()
          await expect(editor).toContainText('unsaved draft')
          await expect(editor).toHaveAttribute('contenteditable', 'false')
          await editor.dispatchEvent('compositionend', { data: ' unsaved draft' })
          // Cross the autosave interval to prove that the stale draft cannot overwrite Main.
          await page.waitForTimeout(1_800)
          const saved = await current(page)
          expect(JSON.stringify(saved.content)).toContain('[@fixture2026, p. 2]')
          expect(JSON.stringify(saved.content)).not.toContain('unsaved draft')
          const staleSave = await page.evaluate(
            async (base) =>
              window.desktop.editor.saveSectionDocument({
                projectSessionId: base.projectSessionId,
                sectionId: base.sectionId,
                baseRevisionId: base.sectionRevisionId,
                baseContentHash: base.contentHash,
                document: base.content
              }),
            base
          )
          expect(staleSave).toMatchObject({
            ok: false,
            error: { code: 'section_revision_conflict' }
          })
          expect((await current(page)).sectionRevisionId).toBe(saved.sectionRevisionId)
          await page.getByRole('button', { name: 'Reload canonical version' }).click()
          await expect(editor).not.toContainText('unsaved draft')
        }
        await expect(editor).toContainText('[@fixture2026, p. 2]')
        const saved = await current(page)
        const mirror = JSON.parse(
          await readFile(
            join(
              testRoot,
              'Legacy conversion.writellm',
              'manuscript',
              'sections',
              `${encodeURIComponent(base.sectionId)}.blocknote.json`
            ),
            'utf8'
          )
        )
        expect(mirror.sectionRevisionId).toBe(saved.sectionRevisionId)
        expect(mirror.document).toEqual(saved.content)
        expect(saved.sourceClass).toBe('manual_checkpoint')
      } finally {
        await releaseConversion(app)
        await app.close()
      }
    }
  )
}
