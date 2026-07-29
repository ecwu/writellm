import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, test } from './fixtures'

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
  if (parentTitle === undefined) {
    await page.getByRole('button', { name: 'Create top-level section' }).click()
  } else {
    await page.getByRole('button', { name: `Add subsection to ${parentTitle}` }).click()
  }
  const dialog = page.getByRole('dialog', { name: 'Create section' })
  await dialog.getByLabel('Section title').fill(title)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('#section-title')).toHaveValue(title)
}

async function saveEditorText(page: Page, text: string): Promise<void> {
  const editor = page.locator('.bn-editor').first()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type(text)
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByText('Saved', { exact: true }).last()).toBeVisible()
}

async function moveSectionBefore(
  page: Page,
  sourceTitle: string,
  targetTitle: string
): Promise<void> {
  const source = page.getByTestId(/^outline-section-/).filter({ hasText: sourceTitle })
  const target = page.getByTestId(/^outline-section-/).filter({ hasText: targetTitle })
  await source.dragTo(target)
}

async function closeProject(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click()
}

test('edits a brief and nested outline, reorders sections, previews, and reopens identically', async ({
  testRoot
}) => {
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
    const sidebarHeader = outlineButton.locator('xpath=ancestor::*[@data-slot="sidebar-header"][1]')
    const contextualSidebar = outlineButton.locator(
      'xpath=ancestor::*[@data-slot="sidebar-inner"][1]'
    )
    await expect(outlineButton).toBeVisible()
    await expect(launched.page.getByText('Active', { exact: true }).first()).toBeVisible()
    await expect
      .poll(() => sidebarHeader.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true)
    const outlineButtonBounds = await outlineButton.boundingBox()
    const contextualSidebarBounds = await contextualSidebar.boundingBox()
    if (outlineButtonBounds === null || contextualSidebarBounds === null) {
      throw new Error('Sidebar header bounds missing')
    }
    expect(outlineButtonBounds.x + outlineButtonBounds.width).toBeLessThanOrEqual(
      contextualSidebarBounds.x + contextualSidebarBounds.width
    )

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

    await launched.page.locator('#section-title').fill('Introduction')
    await launched.page.locator('#section-title').press('Tab')
    await expect(launched.page.getByText('Introduction', { exact: true }).first()).toBeVisible()
    await saveEditorText(launched.page, 'Opening evidence')

    await createSection(launched.page, 'Conclusion')
    await saveEditorText(launched.page, 'Final synthesis')
    await moveSectionBefore(launched.page, 'Conclusion', 'Introduction')

    await createSection(launched.page, 'Background', 'Introduction')
    await saveEditorText(launched.page, 'Supporting context')

    const longOutlineTitle =
      'Background architecture with an intentionally very long title that must stay inside the outline'
    await launched.page.locator('#section-title').fill(longOutlineTitle)
    await launched.page.locator('#section-title').press('Tab')
    const longOutlineRow = launched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: longOutlineTitle })
    await expect(longOutlineRow).toBeVisible()
    const longOutlineItem = longOutlineRow.locator(
      'xpath=ancestor::*[@data-slot="sidebar-menu-item"][1]'
    )
    const longOutlineCount = longOutlineItem.getByTestId(/^outline-word-count-/)
    const longOutlineActions = longOutlineItem.getByTestId(/^outline-actions-/)
    const addSubsectionAction = longOutlineItem.getByRole('button', {
      name: `Add subsection to ${longOutlineTitle}`
    })
    const deleteSectionAction = longOutlineItem.getByRole('button', {
      name: `Delete ${longOutlineTitle}`
    })
    await expect(longOutlineCount).toBeVisible()
    await expect(longOutlineActions).toHaveCSS('opacity', '0')
    const longOutlineRowBounds = await longOutlineRow.boundingBox()
    const longOutlineItemBounds = await longOutlineItem.boundingBox()
    if (longOutlineRowBounds === null || longOutlineItemBounds === null) {
      throw new Error('Outline row bounds missing')
    }
    expect(longOutlineRowBounds.x + longOutlineRowBounds.width).toBeCloseTo(
      longOutlineItemBounds.x + longOutlineItemBounds.width,
      0
    )
    await longOutlineRow.hover()
    await expect(longOutlineCount).toBeHidden()
    await expect(longOutlineActions).toHaveCSS('opacity', '1')
    await expect(addSubsectionAction).toBeVisible()
    await expect(deleteSectionAction).toBeVisible()
    const outlineContent = longOutlineRow.locator(
      'xpath=ancestor::*[@data-slot="sidebar-content"][1]'
    )
    await expect
      .poll(() => outlineContent.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true)
    await launched.page.locator('#section-title').fill('Background')
    await launched.page.locator('#section-title').press('Tab')
    await expect(launched.page.getByText('Background', { exact: true }).first()).toBeVisible()

    await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
    const outlinePanel = launched.page.getByRole('dialog', { name: 'Outline editor' })
    await expect(outlinePanel).toBeVisible()
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
    await launched.page.keyboard.press('Escape')
    await expect(outlinePanel).not.toBeVisible()

    await closeProject(launched.page)
    await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await launched.page.getByRole('button', { name: 'Open project' }).click()
    await expectActiveProject(launched.page, projectName)
    await expectBriefTitle(launched.page, 'Field Notes')
    const outlineSections = launched.page.getByTestId(/^outline-section-/)
    await expect(outlineSections.filter({ hasText: 'Conclusion' })).toBeVisible()
    await expect(outlineSections.filter({ hasText: 'Introduction' })).toBeVisible()
    await expect(outlineSections.filter({ hasText: 'Background' })).toBeVisible()

    await launched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: 'Introduction' })
      .click()
    await expect(launched.page.locator('.bn-editor').first()).toContainText('Opening evidence')
    await launched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: 'Background' })
      .click()
    await expect(launched.page.locator('.bn-editor').first()).toContainText('Supporting context')

    await launched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: 'Introduction' })
      .click()
    await expect(launched.page.locator('#section-title')).toHaveValue('Introduction')
    await moveSectionBefore(launched.page, 'Introduction', 'Conclusion')
    await launched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: 'Background' })
      .click()
    await launched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: 'Introduction' })
      .click()
    const cachedEditor = launched.page.locator('.bn-editor').first()
    await cachedEditor.click()
    await launched.page.keyboard.type(' Final flush draft')
    await closeProject(launched.page)
    await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await launched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: 'Introduction' })
      .click()
    await expect(launched.page.locator('.bn-editor').first()).toContainText('Final flush draft')
    await expect(launched.page.locator('#section-title')).toHaveValue('Introduction')
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
    await expect(relaunched.page.locator('.bn-editor').first()).toContainText('Final flush draft')
    await expect(relaunched.page.locator('#section-title')).toHaveValue('Introduction')
  } finally {
    if (relaunched === undefined) await launched.app.close()
    else await relaunched.app.close()
  }
})

test('surfaces a stale section conflict and can reload the canonical revision', async ({
  testRoot
}) => {
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

    const editor = launched.page.locator('.bn-editor').first()
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
})

test('creates a project snapshot and restores it into a new project folder', async ({
  testRoot
}) => {
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
    await expect(launched.page.locator('.bn-editor').first()).toContainText('Snapshot content')
  } finally {
    await launched.app.close()
  }
})

test('creates and restores named project checkpoints without losing later history', async ({
  testRoot
}) => {
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
    await expect(launched.page.locator('.bn-editor').first()).toContainText('Checkpoint one')
    await expect(launched.page.locator('.bn-editor').first()).not.toContainText('after checkpoint')

    await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
    await launched.page.getByRole('menuitem', { name: 'Version history…' }).click()
    const restoredHistory = launched.page.getByRole('dialog', { name: 'Version history' })
    await expect(restoredHistory.getByText('Restored First draft', { exact: true })).toBeVisible()
    await expect(
      restoredHistory.getByText('Before restoring First draft', { exact: true })
    ).toBeVisible()
    await expect(readdir(join(projectRoot, '.writellm', 'history.git'))).resolves.toContain('HEAD')
  } finally {
    await launched.app.close()
  }
})

test('imports a durable project-local knowledge original and deduplicates repeated bytes', async ({
  testRoot
}) => {
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
        () => launched.page.evaluate(async () => (await window.desktop.projects.lifecycle()).state),
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
})

test('renders and reopens project images, Mermaid, and block LaTeX with Markdown export', async ({
  testRoot
}) => {
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
    await expect(launched.page.locator('.bn-editor img')).toHaveCount(2)
    await expect(launched.page.locator('.bn-editor .katex-display')).toBeVisible()
    const mermaidPreview = await launched.page
      .locator('.bn-editor img[alt="Flow"]')
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

    await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
    const outline = launched.page.getByRole('dialog', { name: 'Outline editor' })
    await outline.getByRole('button', { name: 'Markdown', exact: true }).click()
    await expect
      .poll(async () => (await readdir(join(projectRoot, 'manuscript', 'exports'))).length)
      .toBe(1)
    const [exportName] = await readdir(join(projectRoot, 'manuscript', 'exports'))
    if (exportName === undefined) throw new Error('Markdown export missing')
    const markdown = await readFile(join(projectRoot, 'manuscript', 'exports', exportName), 'utf8')
    expect(markdown).toContain('```mermaid')
    expect(markdown).toContain('$$\nE = mc^2\n$$')
    expect(markdown).toMatch(/\.\.\/assets\/[0-9a-f]{64}\.png/)
    await launched.page.keyboard.press('Escape')

    await closeProject(launched.page)
    await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await expectActiveProject(launched.page, projectName)
    await expect(launched.page.locator('.bn-editor img')).toHaveCount(2)
    await expect(launched.page.locator('.bn-editor .katex-display')).toBeVisible()
  } finally {
    await launched.app.close()
  }
})
