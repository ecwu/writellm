import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, launchApp, test } from './fixtures'

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
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

    await launched.page.getByRole('button', { name: 'Manuscript brief' }).click()
    const brief = launched.page.getByRole('dialog', { name: 'Manuscript brief' })
    await brief.getByLabel('Title').fill('Field Notes')
    await brief.getByLabel('Purpose').fill('A durable multi-section writing workflow.')
    await brief.getByLabel('Audience').fill('Researchers')
    await brief.getByRole('button', { name: 'Save brief' }).click()
    await expect(brief.getByText('Saved', { exact: true })).toBeVisible()
    await brief.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(launched.page.getByText('Field Notes', { exact: true })).toBeVisible()

    await launched.page.getByLabel('Section title').fill('Introduction')
    await launched.page.getByLabel('Objective').fill('Frame the evidence.')
    await launched.page.getByRole('button', { name: 'Planned' }).click()
    await launched.page.getByRole('menuitemradio', { name: 'Drafting' }).click()
    await launched.page.getByRole('button', { name: 'Save details' }).click()
    await expect(launched.page.getByText('Introduction', { exact: true }).first()).toBeVisible()
    await saveEditorText(launched.page, 'Opening evidence')

    await createSection(launched.page, 'Conclusion')
    await saveEditorText(launched.page, 'Final synthesis')
    await launched.page.getByRole('button', { name: 'Up', exact: true }).click()

    await createSection(launched.page, 'Background', 'Introduction')
    await saveEditorText(launched.page, 'Supporting context')

    await launched.page.getByRole('button', { name: 'Preview all' }).click()
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

    await closeProject(launched.page)
    await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await launched.page.getByRole('button', { name: 'Open project' }).click()
    await expect(
      launched.page.getByRole('heading', { name: projectName, exact: true })
    ).toBeVisible()
    await expect(launched.page.getByText('Field Notes', { exact: true })).toBeVisible()
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
    await launched.page.getByLabel('Objective').fill('Preserved while the outline changes.')
    await launched.page.getByRole('button', { name: 'Up', exact: true }).click()
    await expect(launched.page.getByLabel('Objective')).toHaveValue(
      'Preserved while the outline changes.'
    )
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
    await expect(launched.page.getByLabel('Objective')).toHaveValue(
      'Preserved while the outline changes.'
    )
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
    await expect(
      relaunched.page.getByRole('heading', { name: projectName, exact: true })
    ).toBeVisible()
    await expect(relaunched.page.getByText('Field Notes', { exact: true })).toBeVisible()
    await relaunched.page
      .getByTestId(/^outline-section-/)
      .filter({ hasText: 'Introduction' })
      .click()
    await expect(relaunched.page.locator('.bn-editor').first()).toContainText('Final flush draft')
    await expect(relaunched.page.getByLabel('Objective')).toHaveValue(
      'Preserved while the outline changes.'
    )
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

test('imports a durable project-local knowledge original and deduplicates repeated bytes', async ({
  testRoot
}) => {
  const source = join(testRoot, '研究 source.pdf')
  await writeFile(source, '%PDF-1.7\nDurable knowledge source')
  const projectName = 'Knowledge storage'
  const projectRoot = join(testRoot, `${projectName}.writellm`)
  const launched = await launchApp({
    userData: join(testRoot, 'user-data'),
    dialogPaths: [testRoot],
    knowledgeDialogPaths: [source, source]
  })
  try {
    await createProject(launched.page, projectName)
    await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    const knowledge = launched.page.getByTestId('knowledge-workspace')
    await knowledge.getByTestId('knowledge-upload-button').click()
    await expect(knowledge.getByText('研究 source.pdf', { exact: true })).toBeVisible()
    await expect(knowledge.getByText('stored', { exact: true })).toHaveCount(1)
    const originalNames = await readdir(join(projectRoot, 'knowledge', 'originals', 'sha256'), {
      recursive: true
    })
    expect(originalNames.some((name) => name.endsWith('研究 source.pdf'))).toBe(true)
    await closeProject(launched.page)
    await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    await expect(
      launched.page.getByTestId('knowledge-workspace').getByText('研究 source.pdf')
    ).toBeVisible()
  } finally {
    await launched.app.close()
  }
})
