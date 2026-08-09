import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

async function expectBriefTitle(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Brief', exact: true }).click()
  const brief = page.getByRole('dialog', { name: 'Manuscript brief' })
  await expect(brief.getByLabel('Title')).toHaveValue(title)
  await brief.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(brief).not.toBeVisible()
}

async function createSection(page: Page, title: string, parentTitle?: string): Promise<void> {
  await page.getByRole('button', { name: 'Edit outline', exact: true }).click()
  const outline = page.getByRole('dialog', { name: 'Outline editor' })
  if (parentTitle === undefined) {
    await outline.getByRole('button', { name: 'New section', exact: true }).click()
  } else {
    await outline
      .getByTestId(/^outline-editor-section-/)
      .filter({ hasText: parentTitle })
      .locator('button[id^="outline-tree-item-"]')
      .click()
    await outline.getByRole('button', { name: 'Add subsection', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: 'Create section' })
  await dialog.getByLabel('Section title').fill(title)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const createdItem = outline.getByTestId(/^outline-editor-section-/).filter({ hasText: title })
  await createdItem.getByRole('button').first().click()
  await expect(createdItem).toHaveAttribute('aria-selected', 'true')
  await outline.getByRole('button', { name: 'Open in editor', exact: true }).click()
  await expect(outline).not.toBeVisible()
  await expect(page.getByLabel('Section title')).toHaveValue(title)
}

async function saveEditorText(page: Page, text: string): Promise<void> {
  const editor = sectionEditor(page)
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type(text)
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByText('Saved', { exact: true }).last()).toBeVisible()
}

async function moveSectionUp(page: Page, sourceTitle: string): Promise<void> {
  await page.getByRole('button', { name: 'Edit outline', exact: true }).click()
  const outline = page.getByRole('dialog', { name: 'Outline editor' })
  await outline
    .getByTestId(/^outline-editor-section-/)
    .filter({ hasText: sourceTitle })
    .locator('button[id^="outline-tree-item-"]')
    .click()
  await outline.getByRole('button', { name: 'Up', exact: true }).click()
  await outline.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(outline).not.toBeVisible()
}

async function closeProject(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click()
}

test(
  'edits a brief and nested outline, reorders sections, previews, and reopens identically',
  scenario('manuscript.workspace-survives-reopen', ['@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Writing workspace'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, projectRoot]
    })
    let relaunched: typeof launched | undefined

    try {
      await createProject(launched.page, projectName)

      const browserWindow = await launched.app.browserWindow(launched.page)
      await browserWindow.evaluate((window) => {
        window.unmaximize()
        window.setContentSize(900, 800)
      })
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeGreaterThan(767)
      const outlineButton = launched.page.getByRole('button', {
        name: 'Edit outline',
        exact: true
      })
      await expect(outlineButton).toBeVisible()
      await expect(launched.page.getByText('Active', { exact: true }).first()).toBeVisible()

      await launched.page.getByRole('button', { name: 'Brief', exact: true }).click()
      const brief = launched.page.getByRole('dialog', { name: 'Manuscript brief' })
      await brief.getByLabel('Title').fill('Field Notes')
      await brief.getByLabel('Purpose').fill('A durable multi-section writing workflow.')
      await brief.getByLabel('Audience').fill('Researchers')
      await brief.getByRole('button', { name: 'Save brief' }).click()
      await expect(brief.getByText('Saved', { exact: true })).toBeVisible()
      await brief.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(brief).not.toBeVisible()
      await expectBriefTitle(launched.page, 'Field Notes')

      await launched.page.getByLabel('Section title').fill('Introduction')
      await launched.page.getByLabel('Section title').press('Tab')
      await expect(launched.page.getByText('Introduction', { exact: true }).first()).toBeVisible()
      await saveEditorText(launched.page, 'Opening evidence')

      await createSection(launched.page, 'Conclusion')
      await saveEditorText(launched.page, 'Final synthesis')
      await moveSectionUp(launched.page, 'Conclusion')

      await createSection(launched.page, 'Background', 'Introduction')
      await saveEditorText(launched.page, 'Supporting context')
      await expect(launched.page.getByText('Background', { exact: true }).first()).toBeVisible()

      await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const outlinePanel = launched.page.getByRole('dialog', { name: 'Outline editor' })
      await expect(outlinePanel).toBeVisible()
      await expect(outlinePanel.getByRole('treeitem')).toHaveCount(3)
      const introductionTreeItem = outlinePanel
        .getByTestId(/^outline-editor-section-/)
        .filter({ hasText: 'Introduction' })
      const introductionTreeButton = introductionTreeItem.locator(
        'button[id^="outline-tree-item-"]'
      )
      await introductionTreeButton.click()
      await introductionTreeButton.press('ArrowUp')
      await expect(outlinePanel.getByRole('treeitem').first()).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await launched.page.keyboard.press('ArrowDown')
      await expect(introductionTreeItem).toHaveAttribute('aria-selected', 'true')
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Background')
      await outlinePanel.getByLabel('Section objective').fill('Frame the opening evidence.')
      await outlinePanel.getByRole('radio', { name: 'Drafting', exact: true }).click()
      await expect(outlinePanel.getByTestId('outline-save-state')).toHaveText('Saved')
      await outlinePanel.getByLabel('Section objective').press('Tab')
      await expect(outlinePanel.getByTestId('outline-save-state')).toHaveText('Saved')
      await expect(introductionTreeItem).toContainText('Drafting')
      await expect(outlinePanel.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()

      const conclusionTreeItem = outlinePanel
        .getByTestId(/^outline-editor-section-/)
        .filter({ hasText: 'Conclusion' })
      await conclusionTreeItem.locator('button[id^="outline-tree-item-"]').click()
      await outlinePanel.getByRole('radio', { name: 'Completed', exact: true }).click()
      await expect(outlinePanel.getByTestId('outline-save-state')).toHaveText('Saved')

      await browserWindow.evaluate((window) => window.setContentSize(620, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeLessThan(768)
      await outlinePanel.getByRole('button', { name: 'Back to outline' }).click()
      await expect(outlinePanel.getByRole('tree', { name: 'Manuscript sections' })).toBeVisible()
      await conclusionTreeItem.locator('button[id^="outline-tree-item-"]').click()
      await expect(outlinePanel.getByLabel('Section objective')).toBeVisible()
      await browserWindow.evaluate((window) => window.setContentSize(900, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeGreaterThan(767)

      await outlinePanel.getByRole('button', { name: 'Preview all', exact: true }).click()
      const preview = launched.page.getByTestId('whole-manuscript-preview')
      await expect(preview).toBeVisible()
      await expect(preview.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
      const previewText = await preview.textContent()
      expect(previewText?.indexOf('Conclusion')).toBeLessThan(
        previewText?.indexOf('Introduction') ?? 0
      )
      expect(previewText).toContain('Opening evidence')
      expect(previewText).toContain('Final synthesis')
      expect(previewText).toContain('Supporting context')
      await launched.page.keyboard.press('Escape')
      await expect(preview).not.toBeVisible()
      await outlinePanel.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(outlinePanel).not.toBeVisible()
      await expect(
        launched.page.getByTestId(/^outline-section-/).filter({ hasText: 'Introduction' })
      ).toContainText('Drafting')
      await expect(
        launched.page.getByTestId(/^outline-section-/).filter({ hasText: 'Conclusion' })
      ).toContainText('Completed')

      await closeProject(launched.page)
      await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
      await launched.page.getByRole('button', { name: 'Open project' }).click()
      await expectActiveProject(launched.page, projectName)
      await expectBriefTitle(launched.page, 'Field Notes')
      const outlineSections = launched.page.getByTestId(/^outline-section-/)
      await expect(outlineSections.filter({ hasText: 'Conclusion' })).toBeVisible()
      await expect(outlineSections.filter({ hasText: 'Introduction' })).toBeVisible()
      await expect(outlineSections.filter({ hasText: 'Background' })).toBeVisible()
      await expect(outlineSections.filter({ hasText: 'Introduction' })).toContainText('Drafting')
      await expect(outlineSections.filter({ hasText: 'Conclusion' })).toContainText('Completed')

      await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const reopenedOutline = launched.page.getByRole('dialog', { name: 'Outline editor' })
      await reopenedOutline
        .getByTestId(/^outline-editor-section-/)
        .filter({ hasText: 'Introduction' })
        .locator('button[id^="outline-tree-item-"]')
        .click()
      await expect(reopenedOutline.getByLabel('Section objective')).toHaveValue(
        'Frame the opening evidence.'
      )
      await expect(
        reopenedOutline.getByRole('radio', { name: 'Drafting', exact: true })
      ).toHaveAttribute('data-state', 'on')
      await reopenedOutline.getByRole('button', { name: 'Done', exact: true }).click()

      await launched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Introduction' })
        .click()
      await expect(sectionEditor(launched.page)).toContainText('Opening evidence')
      await launched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Background' })
        .click()
      await expect(sectionEditor(launched.page)).toContainText('Supporting context')

      await launched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Introduction' })
        .click()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Introduction')
      await moveSectionUp(launched.page, 'Introduction')
      await launched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Background' })
        .click()
      await launched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Introduction' })
        .click()
      const cachedEditor = sectionEditor(launched.page)
      await cachedEditor.click()
      await launched.page.keyboard.type(' Final flush draft')
      await closeProject(launched.page)
      await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
      await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await launched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Introduction' })
        .click()
      await expect(sectionEditor(launched.page)).toContainText('Final flush draft')
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Introduction')
      await expect(readdir(join(projectRoot, 'manuscript', 'sections'))).resolves.toHaveLength(3)
      await closeProject(launched.page)
      await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
      await launched.app.close()
      relaunched = await launchApp({
        userData: join(testRoot, 'relaunch-user-data'),
        dialogPaths: [projectRoot]
      })
      await expect(relaunched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
      await relaunched.page.getByRole('button', { name: 'Open project' }).click()
      await expectActiveProject(relaunched.page, projectName)
      await expectBriefTitle(relaunched.page, 'Field Notes')
      await relaunched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Introduction' })
        .click()
      await expect(sectionEditor(relaunched.page)).toContainText('Final flush draft')
      await expect(relaunched.page.getByLabel('Section title')).toHaveValue('Introduction')
    } finally {
      if (relaunched === undefined) await launched.app.close()
      else await relaunched.app.close()
    }
  }
)

test(
  'keeps outline metadata drafts through conflicts and enforces deletion guards',
  scenario('manuscript.outline-conflict-preserves-draft'),
  async ({ testRoot }) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, 'Outline conflict')
      await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const outline = launched.page.getByRole('dialog', { name: 'Outline editor' })
      await expect(outline.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()

      await outline.getByRole('button', { name: 'New section', exact: true }).click()
      const create = launched.page.getByRole('dialog', { name: 'Create section' })
      await create.getByLabel('Section title').fill('Temporary leaf')
      await create.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(create).not.toBeVisible()
      await expect(outline.getByRole('treeitem')).toHaveCount(2)
      await outline.getByRole('button', { name: 'Delete', exact: true }).click()
      const confirmation = launched.page.getByRole('alertdialog', { name: 'Delete section?' })
      await confirmation.getByRole('button', { name: 'Delete section', exact: true }).click()
      await expect(confirmation).not.toBeVisible()
      await expect(outline.getByRole('treeitem')).toHaveCount(1)
      await expect(outline.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()

      const title = outline.getByLabel('Title', { exact: true })
      await launched.page.evaluate(async () => {
        const lifecycle = await window.desktop.projects.lifecycle()
        const projectSessionId = lifecycle.activeProject?.projectSessionId
        if (!projectSessionId) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const sectionId = workspace.sections[0]?.section.sectionId
        if (!sectionId) throw new Error('Section missing')
        await window.desktop.manuscript.updateSection({
          projectSessionId,
          update: {
            baseOutlineVersion: workspace.outlineVersion,
            sectionId,
            title: 'External outline title'
          }
        })
      })
      await title.fill('Local outline draft')
      await title.press('Tab')
      await expect(outline.getByText(/Outline changed elsewhere|Changes not saved/)).toBeVisible()
      await expect(title).toHaveValue('Local outline draft')
      await outline.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(outline.getByTestId('outline-save-state')).toHaveText('Saved')
      await expect(
        outline.getByTestId(/^outline-editor-section-/).filter({ hasText: 'Local outline draft' })
      ).toBeVisible()
      await outline.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Local outline draft')
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'surfaces a stale section conflict and can reload the canonical revision',
  scenario('manuscript.section-conflict-reloads-canonical'),
  async ({ testRoot }) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, 'Conflict recovery')
      await launched.page.evaluate(async () => {
        const lifecycle = await window.desktop.projects.lifecycle()
        const projectSessionId = lifecycle.activeProject?.projectSessionId
        if (!projectSessionId) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const sectionId = workspace.sections[0]?.section.sectionId
        if (!sectionId) throw new Error('Section missing')
        const current = await window.desktop.editor.loadSection({ projectSessionId, sectionId })
        await window.desktop.editor.saveSectionDocument({
          projectSessionId,
          sectionId,
          baseRevisionId: current.revision.sectionRevisionId,
          baseContentHash: current.revision.contentHash,
          document: [
            {
              id: crypto.randomUUID(),
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [{ type: 'text', text: 'External canonical update', styles: {} }],
              children: []
            }
          ]
        })
      })

      const editor = sectionEditor(launched.page)
      await editor.click()
      await launched.page.keyboard.type('Local stale draft')
      await launched.page.keyboard.press('ControlOrMeta+s')
      await expect(launched.page.getByText(/This section changed elsewhere/)).toBeVisible()
      await expect(editor).toContainText('Local stale draft')
      await launched.page.getByRole('button', { name: 'Reload canonical version' }).click()
      await expect(editor).toContainText('External canonical update')
      await expect(editor).not.toContainText('Local stale draft')
      await closeProject(launched.page)
      await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'creates a project snapshot and restores it into a new project folder',
  scenario('project.snapshot-restore', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Snapshot source'
    const snapshotRoot = join(testRoot, 'Snapshot backup')
    const restoredRoot = join(testRoot, 'Snapshot backup.writellm')
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, snapshotRoot, snapshotRoot, testRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await saveEditorText(launched.page, 'Snapshot content')

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Create snapshot', exact: true }).click()
      await expect
        .poll(
          async () =>
            readdir(snapshotRoot)
              .then((names) => names.includes('writellm.snapshot.json'))
              .catch(() => false),
          { timeout: 10_000 }
        )
        .toBe(true)

      await closeProject(launched.page)
      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Restore snapshot', exact: true }).click()
      await expectActiveProject(launched.page, 'Snapshot backup')
      await expect(readdir(restoredRoot)).resolves.toContain('writellm.project.json')
      await expect(sectionEditor(launched.page)).toContainText('Snapshot content')
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'creates and restores named project checkpoints without losing later history',
  scenario('manuscript.checkpoint-restore-preserves-history', ['@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Version history'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await saveEditorText(launched.page, 'Checkpoint one')

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Create checkpoint…' }).click()
      const create = launched.page.getByRole('dialog', { name: 'Create checkpoint' })
      await create.getByLabel('Name').fill('First draft')
      await create.getByLabel('Note (optional)').fill('E2E checkpoint')
      await create.getByRole('button', { name: 'Create checkpoint', exact: true }).click()
      await expect(create).not.toBeVisible()

      await saveEditorText(launched.page, ' after checkpoint')
      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Version history…' }).click()
      const history = launched.page.getByRole('dialog', { name: 'Version history' })
      await expect(history.getByText('Uncheckpointed changes', { exact: true })).toBeVisible()
      const firstDraft = history.locator('[data-slot=item]').filter({ hasText: 'First draft' })
      await firstDraft.getByRole('button', { name: 'Restore', exact: true }).click()

      const confirmation = launched.page.getByRole('alertdialog', {
        name: 'Restore this checkpoint?'
      })
      await confirmation.getByRole('button', { name: 'Restore checkpoint', exact: true }).click()
      await expect(confirmation).not.toBeVisible({ timeout: 15_000 })
      await expect(sectionEditor(launched.page)).toContainText('Checkpoint one')
      await expect(sectionEditor(launched.page)).not.toContainText('after checkpoint')

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Version history…' }).click()
      const restoredHistory = launched.page.getByRole('dialog', { name: 'Version history' })
      await expect(restoredHistory.getByText('Restored First draft', { exact: true })).toBeVisible()
      await expect(
        restoredHistory.getByText('Before restoring First draft', { exact: true })
      ).toBeVisible()
      await expect(readdir(join(projectRoot, '.writellm', 'history.git'))).resolves.toContain(
        'HEAD'
      )
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'imports a durable project-local knowledge original and deduplicates repeated bytes',
  scenario('knowledge.original-survives-reopen'),
  async ({ testRoot }) => {
    const source = join(testRoot, '研究 source.pdf')
    await writeFile(source, '%PDF-1.7\nDurable knowledge source')
    const projectName = 'Knowledge storage'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, projectRoot],
      knowledgeDialogPaths: [source, source]
    })
    try {
      await createProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      const knowledge = launched.page.getByTestId('knowledge-workspace')
      await knowledge.getByTestId('knowledge-upload-button').click()
      await expect
        .poll(
          () =>
            launched.page.evaluate(async () => {
              const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
                ?.projectSessionId
              if (projectSessionId === undefined) return 0
              const items = await window.desktop.knowledge.list({ projectSessionId })
              return items.filter((item) => item.state === 'stored').length
            }),
          { timeout: 20_000 }
        )
        .toBe(1)
      await expect(knowledge.getByTestId(/^knowledge-file-/)).toHaveCount(1)
      await expect(knowledge.getByText('研究 source.pdf', { exact: true })).toBeVisible()
      const originalNames = await readdir(join(projectRoot, 'knowledge', 'originals', 'sha256'), {
        recursive: true
      })
      expect(originalNames.some((name) => name.endsWith('研究 source.pdf'))).toBe(true)
      await closeProject(launched.page)
      await expect
        .poll(
          () =>
            launched.page.evaluate(async () => (await window.desktop.projects.lifecycle()).state),
          { timeout: 30_000 }
        )
        .toBe('closed')
      await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()
      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await expect(
        launched.page.getByTestId('knowledge-workspace').getByText('研究 source.pdf')
      ).toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'renders and reopens project images, Mermaid, and block LaTeX with Markdown export',
  scenario('manuscript.rich-media-reopen-export', ['@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Rich media workspace'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, projectRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await launched.page.evaluate(async (pngBase64) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const sectionId = workspace.sections[0]?.section.sectionId
        if (sectionId === undefined) throw new Error('Section missing')
        const current = await window.desktop.editor.loadSection({ projectSessionId, sectionId })
        const asset = await window.desktop.editor.uploadAsset({
          projectSessionId,
          originalName: 'pixel.png',
          mimeType: 'image/png',
          dataBase64: pngBase64
        })
        const saved = await window.desktop.editor.saveSectionDocument({
          projectSessionId,
          sectionId,
          baseRevisionId: current.revision.sectionRevisionId,
          baseContentHash: current.revision.contentHash,
          document: [
            {
              id: 'uploaded-image',
              type: 'image',
              props: {
                backgroundColor: 'default',
                textAlignment: 'center',
                name: 'Uploaded pixel',
                url: asset.logicalUrl,
                caption: 'Project asset',
                showPreview: true,
                previewWidth: 320
              },
              children: []
            },
            {
              id: 'mermaid-diagram',
              type: 'mermaid',
              props: {
                textAlignment: 'center',
                source: 'flowchart LR\nA["<img src=x onerror=alert(1)>"] --> B[Finish]',
                caption: 'Flow',
                previewWidth: 720
              },
              children: []
            },
            {
              id: 'display-formula',
              type: 'math',
              props: {
                textAlignment: 'center',
                source: 'E = mc^2',
                caption: 'Energy',
                previewWidth: 720
              },
              children: []
            }
          ]
        })
        if (!saved.ok) throw new Error(saved.error.message)
      }, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)
      await expect(launched.page.getByText('Mermaid diagram', { exact: true })).toBeVisible()
      await expect(launched.page.getByText('Display formula', { exact: true })).toBeVisible()
      const renderedEditor = launched.page.getByTestId('section-editor')
      await expect(renderedEditor.getByRole('img')).toHaveCount(2)
      const mermaidPreview = await renderedEditor
        .getByRole('img', { name: 'Flow' })
        .getAttribute('src')
      expect(mermaidPreview).not.toBeNull()
      expect(
        await launched.page.evaluate((source) => {
          if (source === null) return null
          const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1))
          const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
          return {
            activeElements: document.querySelectorAll('script,foreignObject,iframe,object,embed')
              .length,
            eventAttributes: document.querySelectorAll('[onload],[onclick],[onerror]').length,
            remoteLinks: document.querySelectorAll('a[href^="http"],[href^="http"],[src]').length
          }
        }, mermaidPreview)
      ).toEqual({ activeElements: 0, eventAttributes: 0, remoteLinks: 0 })

      await launched.page.getByRole('button', { name: 'Section actions', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Export Markdown', exact: true }).click()
      await expect
        .poll(async () => (await readdir(join(projectRoot, 'manuscript', 'exports'))).length)
        .toBe(1)
      const [exportName] = await readdir(join(projectRoot, 'manuscript', 'exports'))
      if (exportName === undefined) throw new Error('Markdown export missing')
      const markdown = await readFile(
        join(projectRoot, 'manuscript', 'exports', exportName),
        'utf8'
      )
      expect(markdown).toContain('```mermaid')
      expect(markdown).toContain('$$\nE = mc^2\n$$')
      expect(markdown).toMatch(/\.\.\/assets\/[0-9a-f]{64}\.png/)

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      await expect(launched.page.getByTestId('section-editor').getByRole('img')).toHaveCount(2)
      await expect(launched.page.getByText('Display formula', { exact: true })).toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)
