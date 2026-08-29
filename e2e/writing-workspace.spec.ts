import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

function titleMetrics(element: HTMLElement): {
  height: number
  lineHeight: number
  clientWidth: number
  scrollWidth: number
  clientHeight: number
  scrollHeight: number
} {
  const style = getComputedStyle(element)
  return {
    height: element.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(style.lineHeight),
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }
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
  await expect
    .poll(async () => (await page.evaluate(() => window.desktop.projects.lifecycle())).state)
    .toBe('closed')
}

test(
  'keeps BlockNote formatting and slash menus keyboard-usable at narrow widths',
  scenario('manuscript.blocknote-054-controls', ['@packaged']),
  async ({ testRoot }) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, 'BlockNote controls')
      const browserWindow = await launched.app.browserWindow(launched.page)
      await browserWindow.evaluate((window) => window.setContentSize(620, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeLessThan(768)

      const editor = sectionEditor(launched.page)
      await editor.click()
      await launched.page.keyboard.type('Toolbar')
      for (let index = 0; index < 7; index += 1) {
        await launched.page.keyboard.press('Shift+ArrowLeft')
      }
      const bold = launched.page.getByRole('button', { name: 'Bold', exact: true })
      await expect(bold).toBeVisible()
      await expect(
        launched.page.getByRole('button', { name: 'Open Agent quick actions' })
      ).toBeVisible()
      await bold.dispatchEvent('click')

      await editor.click()
      await launched.page.keyboard.press('End')
      await launched.page.keyboard.press('Enter')
      await launched.page.keyboard.type('/merm')
      const slashMenu = launched.page.getByRole('listbox')
      await expect(slashMenu).toBeVisible()
      await expect(slashMenu.getByRole('option', { name: /Mermaid/u })).toBeVisible()
      const menuBox = await slashMenu.boundingBox()
      expect(menuBox).not.toBeNull()
      expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(620)
      await launched.page.keyboard.press('Enter')
      await expect(launched.page.getByRole('button', { name: 'OK', exact: true })).toBeVisible()
      await launched.page.getByRole('button', { name: 'Add Mermaid source' }).click()
      await launched.page.keyboard.type('flowchart LR')
      await launched.page.keyboard.press('Shift+Enter')
      await launched.page.keyboard.type('A --> B')
      await expect(launched.page.locator('code[aria-label="Enter Mermaid source"]')).toContainText(
        'flowchart LR'
      )
      await launched.page.getByRole('button', { name: 'OK', exact: true }).dispatchEvent('click')
      await expect(launched.page.getByRole('img', { name: 'Mermaid diagram' })).toBeVisible()
      await launched.page.keyboard.press('ControlOrMeta+s')
      await expect(launched.page.getByText('Saved', { exact: true }).last()).toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'creates, edits, isolates, and reloads native inline mathematics',
  scenario('manuscript.native-inline-math', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Inline mathematics'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, projectRoot]
    })
    try {
      await createProject(launched.page, projectName)
      const editor = sectionEditor(launched.page)
      await editor.click()
      await launched.page.keyboard.type('Before $E=mc^2$ after')
      await launched.page.keyboard.press('Enter')
      await launched.page.keyboard.type(String.raw`Second \(a+b\) rule`)

      const formulas = launched.page.locator('[data-inline-content-type="math"]')
      await expect(formulas).toHaveCount(2)

      const firstFormula = formulas.first()
      await firstFormula.locator('.bn-preview-container').click()
      await expect(firstFormula.locator('.bn-preview-with-source-popup')).toHaveAttribute(
        'data-open',
        'true'
      )
      await launched.page.keyboard.press('Escape')
      await expect(firstFormula.locator('.bn-preview-with-source-popup')).toHaveAttribute(
        'data-open',
        'false'
      )

      await editor.click()
      await launched.page.keyboard.press('End')
      await launched.page.keyboard.press('Enter')
      await launched.page.keyboard.type('/inline eq')
      const slashMenu = launched.page.getByRole('listbox')
      await expect(slashMenu.getByRole('option', { name: /Inline Equation/u })).toBeVisible()
      await launched.page.keyboard.press('Enter')
      await expect(formulas).toHaveCount(3)
      const slashFormula = formulas.last()
      await slashFormula.locator('.bn-preview-container').click()
      await expect(slashFormula.locator('.bn-preview-with-source-popup')).toHaveAttribute(
        'data-open',
        'true'
      )
      await launched.page.keyboard.type(String.raw`\frac{x}{y}`)
      await launched.page.keyboard.press('Enter')
      await expect(slashFormula.locator('.bn-preview-with-source-popup')).toHaveAttribute(
        'data-open',
        'false'
      )

      await launched.page.keyboard.press('End')
      await launched.page.keyboard.press('Enter')
      await launched.page.keyboard.type(String.raw`Unsafe $\href{https://evil.example}{x}$`)
      await expect(
        launched.page.getByText(
          'Formula or diagram source exceeds its safe size limit or uses a blocked command.'
        )
      ).toBeVisible()
      await expect(formulas).toHaveCount(3)

      await launched.page.keyboard.press('End')
      await launched.page.keyboard.press('Enter')
      await launched.page.keyboard.type(String.raw`Invalid $\badcommand{$`)
      await expect(formulas).toHaveCount(4)
      await launched.page.keyboard.press('ControlOrMeta+z')
      await expect(formulas).toHaveCount(3)
      await launched.page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(formulas).toHaveCount(4)
      const invalidFormula = launched.page.getByRole('button', {
        name: /Invalid equation/u
      })
      await expect(invalidFormula).toBeVisible()
      const invalidMath = invalidFormula.locator(
        'xpath=ancestor::*[@data-inline-content-type="math"][1]'
      )
      await invalidMath.locator('.bn-preview-container').click()
      await expect(invalidMath.locator('.bn-preview-with-source-popup')).toHaveAttribute(
        'data-open',
        'true'
      )
      await launched.page.keyboard.press('ControlOrMeta+a')
      await launched.page.keyboard.type('z^2')
      await launched.page.keyboard.press('Enter')
      await expect(invalidFormula).not.toBeVisible()

      await launched.page.keyboard.press('ControlOrMeta+s')
      await expect(launched.page.getByText('Saved', { exact: true }).last()).toBeVisible()

      await launched.page.keyboard.press('ControlOrMeta+f')
      await launched.page.getByTestId('manuscript-find-input').fill('E=mc^2')
      await expect(launched.page.getByText('0 results', { exact: true })).toBeVisible()
      await launched.page.getByRole('button', { name: 'Close Find' }).click()

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      await expect(launched.page.locator('[data-inline-content-type="math"]')).toHaveCount(4)

      const browserWindow = await launched.app.browserWindow(launched.page)
      await browserWindow.evaluate((window) => window.setContentSize(620, 800))
      await expect
        .poll(() =>
          launched.page
            .getByTestId('section-editor')
            .evaluate((element) => element.scrollWidth <= element.clientWidth)
        )
        .toBe(true)

      await launched.page.getByRole('menuitem', { name: 'Tools', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: /Settings/u }).click()
      const settings = launched.page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('option', { name: 'General', exact: true }).click()
      await settings.getByRole('radio', { name: 'Dark', exact: true }).click()
      await expect
        .poll(() => launched.page.evaluate(() => document.documentElement.dataset.theme))
        .toBe('dark')
      await launched.page.keyboard.press('Escape')
      await expect(settings).not.toBeVisible()
      await expect(formulas.first().locator('math')).toBeVisible({ timeout: 30_000 })
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'finds current manuscript text and preserves exact navigation across window sizes',
  scenario('manuscript.find-navigation'),
  async ({ testRoot }) => {
    const projectName = 'Find navigation'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await launched.page.getByLabel('Section title').fill('Searchable opening')
      await launched.page.getByLabel('Section title').press('Tab')
      await saveEditorText(launched.page, 'Before the exact needle phrase after it.')

      await launched.page.keyboard.press('ControlOrMeta+f')
      const input = launched.page.getByTestId('manuscript-find-input')
      await expect(input).toBeVisible()
      await input.fill('needle phrase')
      await expect(launched.page.getByText('1 results', { exact: true })).toBeVisible()
      const result = launched.page
        .locator('[data-slot="command-item"]')
        .filter({ hasText: 'needle phrase' })
      await expect(result).toBeVisible()

      const screenshotDirectory = process.env.WRITELLM_CP29_SCREENSHOT_DIR
      if (screenshotDirectory !== undefined) {
        await mkdir(screenshotDirectory, { recursive: true })
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp29-find-desktop.png'),
          animations: 'disabled'
        })
      }

      await result.click()
      await expect(launched.page.locator('.writellm-search-match')).toContainText('needle phrase')

      const browserWindow = await launched.app.browserWindow(launched.page)
      await browserWindow.evaluate((window) => window.setContentSize(620, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeLessThan(768)
      await launched.page.keyboard.press('ControlOrMeta+f')
      await expect(input).toBeVisible()
      await expect(launched.page.getByRole('button', { name: 'Close Find' })).toBeVisible()
      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp29-find-narrow.png'),
          animations: 'disabled'
        })
      }
      await launched.page
        .locator('[data-slot="sheet-overlay"]')
        .click({ position: { x: 600, y: 400 } })
      await expect(input).not.toBeVisible()
      await expect(launched.page.locator('.writellm-search-match')).toHaveCount(0)

      await launched.page.keyboard.press('ControlOrMeta+f')
      await expect(input).toBeVisible()
      await launched.page.getByRole('button', { name: 'Replace', exact: true }).click()
      const replacementInput = launched.page.getByLabel('Replace with')
      await expect(replacementInput).toBeFocused()
      await launched.page.keyboard.press('Escape')
      await expect(replacementInput).not.toBeVisible()
      await expect(input).toBeVisible()
      await launched.page.keyboard.press('Escape')
      await expect(input).not.toBeVisible()

      await launched.page.keyboard.press('ControlOrMeta+f')
      await expect(input).toBeVisible()
      await launched.page.getByRole('button', { name: 'Close Find' }).click()
      await expect(input).not.toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'previews, selects, and atomically applies a safe manuscript replacement',
  scenario('manuscript.safe-replacement', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, 'Safe replacement')
      await saveEditorText(launched.page, 'Alpha evidence and Alpha conclusion.')
      await launched.page.keyboard.press('ControlOrMeta+f')
      await launched.page.getByTestId('manuscript-find-input').fill('Alpha')
      await expect(launched.page.getByText('2 results', { exact: true })).toBeVisible()
      await launched.page.getByRole('button', { name: 'Replace', exact: true }).click()
      const replacementInput = launched.page.getByLabel('Replace with')
      await expect(replacementInput).toBeFocused()
      await replacementInput.fill('Beta')
      await launched.page.getByRole('button', { name: 'Review replacements' }).click()
      await expect(launched.page.getByText('2 eligible · 0 skipped · 1 sections')).toBeVisible()
      await expect(
        launched.page.locator('[role="status"]').filter({ hasText: '2 eligible · 0 skipped' })
      ).toBeFocused()
      const candidates = launched.page.getByRole('checkbox', { name: /Select replacement in/u })
      await expect(candidates).toHaveCount(2)
      await launched.page.getByRole('checkbox', { name: /Select loaded replacements in/u }).click()
      await expect(candidates.nth(0)).toBeChecked()
      await expect(candidates.nth(1)).toBeChecked()

      const screenshotDirectory = process.env.WRITELLM_CP30_SCREENSHOT_DIR
      if (screenshotDirectory !== undefined) {
        await mkdir(screenshotDirectory, { recursive: true })
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp30-replacement-review.png'),
          animations: 'disabled'
        })
      }

      await launched.page.getByRole('button', { name: 'Apply 2 replacements in 1 section' }).click()
      await expect(launched.page.getByText('Applied 2 replacements in 1 sections.')).toBeVisible()
      await expect(launched.page.getByRole('alert')).toBeFocused()
      await launched.page.getByRole('button', { name: 'Close Find' }).click()
      await expect(launched.page.locator('.bn-editor')).toContainText(
        'Beta evidence and Beta conclusion.'
      )
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'reviews and applies a Main-owned hashed Markdown import plan',
  scenario('manuscript.staged-markdown-import', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const markdownPath = join(testRoot, '导入 manuscript.md')
    await writeFile(
      markdownPath,
      '# Imported opening\n\nHello **reviewed** import.\n\n# Imported ending\n\nFinal mapped paragraph.'
    )
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, markdownPath]
    })
    try {
      await createProject(launched.page, 'Staged import')
      await launched.page.getByRole('button', { name: 'Section actions' }).click()
      await launched.page.getByRole('menuitem', { name: 'Import manuscript' }).click()

      const dialog = launched.page.getByRole('dialog', { name: 'Review manuscript import' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('Imported opening', { exact: true }).first()).toBeVisible()
      await expect(dialog.getByText('Imported ending', { exact: true })).toBeVisible()
      await expect(dialog.getByText(/Hello reviewed import/u)).toBeVisible()
      await expect(dialog.getByText(/Nothing in the manuscript changes/u)).toBeVisible()

      const screenshotDirectory = process.env.WRITELLM_CP36_SCREENSHOT_DIR
      if (screenshotDirectory !== undefined) {
        await mkdir(screenshotDirectory, { recursive: true })
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp36-import-plan.png'),
          animations: 'disabled'
        })
      }

      await dialog.getByRole('button', { name: 'Apply reviewed import' }).click()
      await expect(dialog).not.toBeVisible()
      const imported = launched.page.getByTestId(/^outline-section-/).filter({
        hasText: 'Imported ending'
      })
      await expect(imported).toBeVisible()
      await imported.click()
      await expect(sectionEditor(launched.page)).toContainText('Final mapped paragraph.')
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'isolates, reviews, applies, and reopens a single-file LaTeX import',
  scenario('manuscript.staged-latex-import', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const projectName = 'LaTeX import'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const latexPath = join(testRoot, '多语言 manuscript.tex')
    await writeFile(
      latexPath,
      String.raw`\documentclass{article}
\usepackage{unknown-package}
\title{可编辑研究}
\begin{document}
% retained comment
\chapter{Imported opening}
Hello \textbf{reviewed} import with $x^2$.
\section{Imported evidence}
\begin{equation}E = mc^2\end{equation}
\cite{missing-key}
\end{document}`
    )
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, latexPath, projectRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Section actions' }).click()
      await launched.page.getByRole('menuitem', { name: 'Import manuscript' }).click()

      const dialog = launched.page.getByRole('dialog', { name: 'Review manuscript import' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('LATEX', { exact: true })).toBeVisible()
      await expect(dialog.getByText('Imported opening', { exact: true }).first()).toBeVisible()
      await expect(dialog.getByText('Imported evidence', { exact: true })).toBeVisible()
      await expect(dialog.getByText(/missing-key/u)).toBeVisible()

      await dialog.getByRole('button', { name: 'Apply reviewed import' }).click()
      await expect(dialog).not.toBeVisible()
      const opening = launched.page.getByTestId(/^outline-section-/).filter({
        hasText: 'Imported opening'
      })
      await opening.click()
      await expect(launched.page.locator('[data-inline-content-type="math"]')).toHaveCount(1)
      const evidence = launched.page.getByTestId(/^outline-section-/).filter({
        hasText: 'Imported evidence'
      })
      await expect(evidence).toBeVisible()
      await evidence.click()
      await expect(launched.page.locator('.bn-editor')).toContainText('\\cite{missing-key}')

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      const reopenedOpening = launched.page.getByTestId(/^outline-section-/).filter({
        hasText: 'Imported opening'
      })
      await reopenedOpening.click()
      await expect(launched.page.locator('[data-inline-content-type="math"]')).toHaveCount(1)
      const reopenedEvidence = launched.page.getByTestId(/^outline-section-/).filter({
        hasText: 'Imported evidence'
      })
      await reopenedEvidence.click()
      await expect(launched.page.locator('.bn-editor')).toContainText('\\cite{missing-key}')
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'reviews a contained LaTeX project with includes, bibliography, table, and figure',
  scenario('manuscript.staged-latex-project-import', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const projectName = 'LaTeX project import'
    const sourceRoot = join(testRoot, 'paper-source')
    await mkdir(join(sourceRoot, 'chapters'), { recursive: true })
    await mkdir(join(sourceRoot, 'images'))
    await writeFile(
      join(sourceRoot, 'main.tex'),
      String.raw`\title{完整项目}\begin{document}\input{chapters/results}\end{document}`
    )
    await writeFile(
      join(sourceRoot, 'chapters/results.tex'),
      String.raw`\section{Imported project results}
Evidence from \cite{garcia2025}.
\begin{table}\caption{Measurements}\begin{tabular}{lc}Name & Value \\ Alpha & 2\end{tabular}\end{table}
\begin{figure}\includegraphics{../images/plot.png}\caption{Observed result}\label{fig:plot}\end{figure}`
    )
    await writeFile(
      join(sourceRoot, 'references.bib'),
      '@article{garcia2025,title={Result},author={García, Ana},year={2025}}'
    )
    await writeFile(
      join(sourceRoot, 'images/plot.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, sourceRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Section actions' }).click()
      await launched.page.getByRole('menuitem', { name: 'Import LaTeX project folder' }).click()

      const dialog = launched.page.getByRole('dialog', { name: 'Review manuscript import' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('LATEX-PROJECT', { exact: true })).toBeVisible()
      await expect(
        dialog.getByText('Imported project results', { exact: true }).first()
      ).toBeVisible()
      await expect(dialog.getByText(/García, 2025/u)).toBeVisible()
      await expect(dialog.getByText('1 registered images', { exact: true })).toBeVisible()

      await dialog.getByRole('button', { name: 'Apply reviewed import' }).click()
      const imported = launched.page.getByTestId(/^outline-section-/).filter({
        hasText: 'Imported project results'
      })
      await imported.click()
      await expect(launched.page.locator('.bn-editor')).toContainText('García, 2025')
      await expect(launched.page.locator('.bn-editor img')).toHaveCount(1)
      await expect(launched.page.locator('.bn-editor')).toContainText('Alpha')
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'keeps review fixtures passive, versioned, and usable at narrow widths',
  scenario('review.passive-fixtures-workbench'),
  async ({ testRoot }) => {
    const projectName = 'Review fixtures'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, projectRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: /Review Center/u }).click()
      await launched.page.getByRole('tab', { name: 'Agent issues' }).click()
      const issues = launched.page.getByTestId('review-issues-panel')
      await expect(issues).toBeVisible()
      await expect(issues.getByText('No matching issues', { exact: true })).toBeVisible()
      await expect(issues.getByRole('button', { name: /AI Review|Analyze/u })).toHaveCount(0)

      await launched.page.getByRole('button', { name: 'Writing rules', exact: true }).click()
      const rules = launched.page.getByTestId('writing-rules-panel')
      await expect(rules).toBeVisible()
      await rules.getByLabel('New rule').fill('Translate LLM consistently.')
      await rules.getByRole('button', { name: 'Advanced terminology fields' }).click()
      await rules.getByLabel('Category').first().click()
      await launched.page.getByRole('option', { name: 'translation', exact: true }).click()
      await rules.getByLabel('Preferred form').first().fill('大型语言模型')
      await rules.getByLabel('Discouraged forms').first().fill('大语言模型')
      await rules.getByRole('button', { name: 'Add rule', exact: true }).click()
      await expect(rules.getByText('Translate LLM consistently.', { exact: true })).toBeVisible()
      await expect(rules.getByRole('switch', { name: 'Deactivate rule' })).toBeChecked()

      const browserWindow = await launched.app.browserWindow(launched.page)
      await browserWindow.evaluate((window) => window.setContentSize(620, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeLessThan(768)
      await expect(rules).toBeVisible()
      await expect
        .poll(() => rules.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true)

      await browserWindow.evaluate((window) => window.setContentSize(900, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeGreaterThan(767)

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Writing rules', exact: true }).click()
      await expect(
        launched.page
          .getByTestId('writing-rules-panel')
          .getByText('Translate LLM consistently.', { exact: true })
      ).toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'attaches private TODOs, resolves them, and rolls them back with project history',
  scenario('annotations.durable-todos', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Durable annotations'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await saveEditorText(launched.page, 'Claim requiring a private follow-up.')
      await sectionEditor(launched.page).click()
      await launched.page.getByRole('button', { name: 'Section actions' }).click()
      await launched.page.getByRole('menuitem', { name: 'Add note or TODO' }).click()
      const create = launched.page.getByRole('dialog', { name: 'Add annotation' })
      await create.getByLabel('Annotation text').fill('Verify the source before publication.')
      await create.getByRole('button', { name: 'Add annotation' }).click()

      const annotations = launched.page.getByTestId('annotations-panel')
      await expect(annotations).toBeVisible()
      await expect(
        annotations.getByText('Verify the source before publication.', { exact: true })
      ).toBeVisible()
      await annotations.getByText('Verify the source before publication.', { exact: true }).click()
      await annotations.getByRole('button', { name: 'Go to block' }).click()
      await expect(sectionEditor(launched.page)).toBeVisible()
      await expect(sectionEditor(launched.page)).toContainText(
        'Claim requiring a private follow-up.'
      )

      await launched.page.getByRole('button', { name: /Review Center/u }).click()
      await annotations.getByText('Verify the source before publication.', { exact: true }).click()
      await annotations.getByRole('button', { name: 'Resolve', exact: true }).click()
      await expect(
        annotations.getByRole('button', { name: /Verify the source before publication/u })
      ).toHaveCount(0)

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Create checkpoint…' }).click()
      const checkpoint = launched.page.getByRole('dialog', { name: 'Create checkpoint' })
      await checkpoint.getByLabel('Name').fill('Resolved annotation')
      await checkpoint.getByRole('button', { name: 'Create checkpoint', exact: true }).click()
      await expect(checkpoint).not.toBeVisible()

      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await sectionEditor(launched.page).click()
      await launched.page.getByRole('button', { name: 'Section actions' }).click()
      await launched.page.getByRole('menuitem', { name: 'Add note or TODO' }).click()
      const later = launched.page.getByRole('dialog', { name: 'Add annotation' })
      await later.getByLabel('Annotation text').fill('Temporary note after checkpoint.')
      await later.getByRole('button', { name: 'Add annotation' }).click()
      await expect(
        annotations.getByText('Temporary note after checkpoint.', { exact: true })
      ).toBeVisible()

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Version history…' }).click()
      const history = launched.page.getByRole('dialog', { name: 'Version history' })
      await history
        .locator('[data-slot=item]')
        .filter({ hasText: 'Resolved annotation' })
        .getByRole('button', { name: 'Restore', exact: true })
        .click()
      const confirmation = launched.page.getByRole('alertdialog', {
        name: 'Restore this checkpoint?'
      })
      await confirmation.getByRole('button', { name: 'Restore checkpoint', exact: true }).click()
      await expect(confirmation).not.toBeVisible({ timeout: 15_000 })

      await launched.page.getByRole('button', { name: /Review Center/u }).click()
      await annotations.getByLabel('Status').click()
      await launched.page.getByRole('option', { name: 'All status' }).click()
      await expect(
        annotations.getByText('Verify the source before publication.', { exact: true })
      ).toBeVisible()
      await expect(
        annotations.getByText('Temporary note after checkpoint.', { exact: true })
      ).toHaveCount(0)

      await launched.page.keyboard.press('ControlOrMeta+f')
      await launched.page.getByTestId('manuscript-find-input').fill('Verify the source')
      await expect(launched.page.getByText('0 results', { exact: true })).toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'edits a brief and nested outline, reorders sections, previews, and reopens identically',
  scenario('manuscript.workspace-survives-reopen', ['@packaged']),
  async ({ testRoot }) => {
    test.setTimeout(180_000)
    const projectName = 'Writing workspace'
    const manuscriptTitle =
      'From Intent to Control: Language Models for Edge–Cloud Orchestration—Problem Space, Agency, Assurance, and Evidence'
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
      await brief.getByLabel('Title').fill(manuscriptTitle)
      await brief.getByLabel('Purpose').fill('A durable multi-section writing workflow.')
      await brief.getByLabel('Audience').fill('Researchers')
      await brief.getByRole('button', { name: 'Save brief' }).click()
      await expect(brief.getByText('Saved', { exact: true })).toBeVisible()
      await brief.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(brief).not.toBeVisible()
      await expectBriefTitle(launched.page, manuscriptTitle)

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

      await expect(
        outlinePanel.getByRole('button', { name: 'Preview all', exact: true })
      ).toHaveCount(0)
      await outlinePanel.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(outlinePanel).not.toBeVisible()
      await sectionEditor(launched.page).click()
      await launched.page.keyboard.press('End')
      await launched.page.keyboard.type(' Preview flush draft')
      await launched.page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click()
      await launched.page.getByRole('button', { name: 'Preview', exact: true }).click()
      const previewWorkspace = launched.page.getByTestId('manuscript-preview-workspace')
      const previewScroll = launched.page.getByTestId('whole-manuscript-preview-scroll')
      const preview = launched.page.getByTestId('whole-manuscript-preview')
      await expect(previewWorkspace).toBeVisible()
      await expect(launched.page.getByRole('dialog')).toHaveCount(0)
      await expect(preview).toBeVisible()
      await expect(preview.getByRole('heading', { name: 'Conclusion' })).toBeVisible()
      const previewText = await preview.textContent()
      expect(previewText?.indexOf('Conclusion')).toBeLessThan(
        previewText?.indexOf('Introduction') ?? 0
      )
      expect(previewText).toContain('Opening evidence')
      expect(previewText).toContain('Final synthesis')
      expect(previewText).toContain('Supporting context')
      expect(previewText).toContain('Preview flush draft')
      expect(previewText).not.toContain('Frame the opening evidence.')
      await expect
        .poll(() =>
          previewWorkspace.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return (
              bounds.left >= 0 &&
              bounds.right <= window.innerWidth &&
              bounds.top >= 0 &&
              bounds.bottom <= window.innerHeight &&
              element.scrollWidth <= element.clientWidth
            )
          })
        )
        .toBe(true)
      await expect
        .poll(() => previewScroll.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true)
      await expect
        .poll(() => preview.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true)
      await launched.page.keyboard.press('Escape')
      await expect(preview).toBeVisible()
      await browserWindow.evaluate((window) => window.setContentSize(900, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeGreaterThan(767)
      await expect(
        launched.page.getByRole('button', { name: 'Preview', exact: true })
      ).toHaveAttribute('data-active', 'true')
      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Background')
      await expect(sectionEditor(launched.page)).toContainText('Preview flush draft')
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
      await expectBriefTitle(launched.page, manuscriptTitle)
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
      await expectBriefTitle(relaunched.page, manuscriptTitle)
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
      await title.fill('Local outline draft')
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
      await title.press('Tab')
      await expect(outline.getByText(/Outline changed elsewhere|Changes not saved/)).toBeVisible()
      await expect(title).toHaveValue('Local outline draft')
      const retry = outline.getByRole('button', { name: 'Retry', exact: true })
      if (await retry.isVisible()) {
        await retry.click({ force: true })
      }
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
      await launched.page.getByRole('button', { name: 'Checks', exact: true }).click()
      await expect(launched.page.getByTestId('checks-workspace')).toHaveCount(0)
      await expect(editor).toContainText('Local stale draft')
      await launched.page.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(launched.page.getByTestId('manuscript-preview-workspace')).toHaveCount(0)
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
  'wraps long section titles while preserving single-line metadata and keyboard flow',
  scenario('manuscript.section-title-wraps'),
  async ({ testRoot }) => {
    const projectName = 'Adaptive section title'
    const longTitle =
      'Language-Model Agency and Systems Orchestration Across Evidence-Constrained Research Pipelines — 语言模型在复杂研究流程中的自主性、系统编排与证据边界'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })

    try {
      await createProject(launched.page, projectName)
      const browserWindow = await launched.app.browserWindow(launched.page)
      const title = launched.page.getByLabel('Section title')

      await browserWindow.evaluate((window) => {
        window.unmaximize()
        window.setContentSize(900, 800)
      })
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeGreaterThan(767)
      await expect(title).toHaveAttribute('maxlength', '500')
      await title.fill('Evidence orchestration\n跨语言研究')
      await expect(title).toHaveValue('Evidence orchestration 跨语言研究')

      await title.fill(longTitle)
      const desktopMetrics = await title.evaluate(titleMetrics)
      expect(desktopMetrics.height).toBeGreaterThan(desktopMetrics.lineHeight * 1.5)
      expect(desktopMetrics.scrollWidth).toBeLessThanOrEqual(desktopMetrics.clientWidth + 1)
      expect(desktopMetrics.scrollHeight - desktopMetrics.clientHeight).toBeLessThanOrEqual(8)

      await browserWindow.evaluate((window) => window.setContentSize(620, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeLessThan(768)
      const narrowMetrics = await title.evaluate(titleMetrics)
      expect(narrowMetrics.height).toBeGreaterThan(narrowMetrics.lineHeight * 1.5)
      expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth + 1)
      expect(narrowMetrics.scrollHeight - narrowMetrics.clientHeight).toBeLessThanOrEqual(8)

      await title.press('Enter')
      await expect(sectionEditor(launched.page)).toBeFocused()

      await browserWindow.evaluate((window) => window.setContentSize(900, 800))
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeGreaterThan(767)
      const sidebarTitle = launched.page
        .getByTestId(/^outline-section-/)
        .getByText(longTitle, { exact: true })
      await expect(sidebarTitle).toBeVisible()
      await expect
        .poll(() =>
          sidebarTitle.evaluate((element) => {
            const style = getComputedStyle(element)
            return {
              overflow: style.overflow,
              textOverflow: style.textOverflow,
              whiteSpace: style.whiteSpace
            }
          })
        )
        .toEqual({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

      await closeProject(launched.page)
      await expect(launched.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
      await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await expect(launched.page.locator('textarea#section-title')).toHaveValue(longTitle)
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
  'saves an independent project copy and opens source and clone sequentially',
  scenario('project.clone-independent', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Clone source'
    const sourceRoot = join(testRoot, `${projectName}.writellm`)
    const cloneRoot = join(testRoot, '克隆副本.writellm')
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, cloneRoot]
    })
    try {
      await createProject(launched.page, projectName)
      await saveEditorText(launched.page, 'Independent clone content')
      const sourceManifest = JSON.parse(
        await readFile(join(sourceRoot, 'writellm.project.json'), 'utf8')
      ) as { projectId: string }

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page
        .getByRole('menuitem', { name: 'Save As independent copy…', exact: true })
        .click()
      await expectActiveProject(launched.page, '克隆副本')
      await expect(sectionEditor(launched.page)).toContainText('Independent clone content')
      const cloneManifest = JSON.parse(
        await readFile(join(cloneRoot, 'writellm.project.json'), 'utf8')
      ) as { projectId: string }
      expect(cloneManifest.projectId).not.toBe(sourceManifest.projectId)
      await expect(
        readFile(join(cloneRoot, '.writellm', 'history.git', 'HEAD'), 'utf8')
      ).rejects.toMatchObject({ code: 'ENOENT' })
      const historyPrompt = launched.page.getByRole('alertdialog', {
        name: 'Enable version history?'
      })
      await historyPrompt.getByRole('button', { name: 'Not now', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await expect(
        launched.page.getByRole('menuitem', { name: 'Enable version history…', exact: true })
      ).toBeVisible()
      await launched.page.keyboard.press('Escape')

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      await expect(sectionEditor(launched.page)).toContainText('Independent clone content')
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'creates a CJK-ready project from a reviewed built-in template',
  scenario('project.template-built-in', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await launched.page.getByRole('button', { name: 'Create project', exact: true }).click()
      const dialog = launched.page.getByRole('dialog', { name: 'Create project' })
      await dialog.getByLabel('Project name').fill('模板项目')
      await dialog.getByLabel('Starting template').click()
      await launched.page.getByRole('option', { name: '中文研究报告' }).click()
      await dialog.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(launched.page, '模板项目')
      await expect(
        launched.page.getByTestId(/^outline-section-/).filter({ hasText: '执行摘要' })
      ).toBeVisible()
      await expectBriefTitle(launched.page, '模板项目')
      await expect(sectionEditor(launched.page)).not.toContainText('PRIVATE')
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'extracts a reusable user template without manuscript content or source identity',
  scenario('project.template-user-extraction', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const sourceRoot = join(testRoot, 'Template source.writellm')
    const targetRoot = join(testRoot, 'Template target.writellm')
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, testRoot]
    })
    try {
      await createProject(launched.page, 'Template source')
      await saveEditorText(launched.page, 'PRIVATE SOURCE MANUSCRIPT BODY')
      const sourceManifest = JSON.parse(
        await readFile(join(sourceRoot, 'writellm.project.json'), 'utf8')
      ) as { projectId: string }

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page
        .getByRole('menuitem', { name: 'Save as reusable template…', exact: true })
        .click()
      const save = launched.page.getByRole('dialog', { name: 'Save reusable project template' })
      await expect(save.getByText('Manuscript bodies and citations', { exact: true })).toBeVisible()
      await save.getByLabel('Template name').fill('My reusable template')
      await save.getByLabel('Description').fill('Reusable structure only')
      await save.getByRole('button', { name: 'Save template', exact: true }).click()
      await expect(save).not.toBeVisible()

      await closeProject(launched.page)
      await rm(sourceRoot, { recursive: true, force: true })
      await launched.page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = launched.page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Template target')
      await create.getByLabel('Starting template').click()
      await launched.page.getByRole('option', { name: /My reusable template/u }).click()
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(launched.page, 'Template target')
      await expect(sectionEditor(launched.page)).not.toContainText('PRIVATE SOURCE MANUSCRIPT BODY')
      const targetManifest = JSON.parse(
        await readFile(join(targetRoot, 'writellm.project.json'), 'utf8')
      ) as { projectId: string }
      expect(targetManifest.projectId).not.toBe(sourceManifest.projectId)
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
      await launched.page.evaluate(
        async ({ pngBase64, unusedPngBase64 }) => {
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
          await window.desktop.editor.uploadAsset({
            projectSessionId,
            originalName: 'unused.png',
            mimeType: 'image/png',
            dataBase64: unusedPngBase64
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
                  altText: 'Uploaded pixel',
                  showPreview: true,
                  previewWidth: 320
                },
                children: []
              },
              {
                id: 'mermaid-diagram',
                type: 'diagram',
                props: {
                  engine: 'mermaid',
                  caption: 'Flow',
                  altText: 'Flow'
                },
                content: [
                  {
                    type: 'text',
                    text: 'flowchart LR\nA["<img src=x onerror=alert(1)>"] --> B[Finish]',
                    styles: {}
                  }
                ],
                children: []
              },
              {
                id: 'display-formula',
                type: 'mathBlock',
                props: {},
                content: [{ type: 'text', text: 'E = mc^2', styles: {} }],
                children: []
              }
            ]
          })
          if (!saved.ok) throw new Error(saved.error.message)
        },
        {
          pngBase64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          unusedPngBase64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlKAAAAAASUVORK5CYII='
        }
      )
      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)
      const renderedEditor = launched.page.getByTestId('section-editor')
      await expect(renderedEditor.getByRole('img', { name: 'Flow' })).toBeVisible()
      await expect(renderedEditor.getByRole('math')).toBeVisible()
      await launched.page.getByRole('button', { name: 'Images', exact: true }).click()
      const assetWorkspace = launched.page.getByTestId('asset-workspace')
      await expect(assetWorkspace.getByText('pixel.png', { exact: true })).toBeVisible()
      await expect(assetWorkspace.getByText('unused.png', { exact: true })).toBeVisible()
      await expect(assetWorkspace.getByText('1 current reference', { exact: true })).toBeVisible()
      await assetWorkspace.getByRole('button', { name: 'Delete unused.png', exact: true }).click()
      const deleteDialog = launched.page.getByRole('alertdialog', { name: 'Delete unused image?' })
      await deleteDialog.getByRole('button', { name: 'Delete image', exact: true }).click()
      await expect(assetWorkspace.getByText('unused.png', { exact: true })).not.toBeVisible()
      await assetWorkspace
        .getByRole('button', { name: 'Open Untitled Section', exact: true })
        .first()
        .click()
      await expect(renderedEditor.getByRole('img')).toHaveCount(2)
      await renderedEditor.locator('.bn-preview-container:has(math)').click()
      await expect(renderedEditor.locator('code[aria-label="E = mc^2"]')).toBeVisible()
      await renderedEditor
        .locator('.bn-preview-with-source-popup[data-open="true"]')
        .getByRole('button', { name: 'OK', exact: true })
        .dispatchEvent('click')
      const diagramSourcePreview = renderedEditor.locator(
        '.bn-preview-container:has(img[alt="Flow"])'
      )
      await diagramSourcePreview.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await diagramSourcePreview.dispatchEvent('click')
      await expect(renderedEditor.locator('code[aria-label="Enter Mermaid source"]')).toContainText(
        'flowchart LR'
      )
      await renderedEditor
        .locator('.bn-preview-with-source-popup[data-open="true"]')
        .getByRole('button', { name: 'OK', exact: true })
        .dispatchEvent('click')
      await renderedEditor.getByRole('button', { name: 'Edit figure metadata' }).click()
      await launched.page.getByLabel('Caption', { exact: true }).fill('Edited project asset')
      await launched.page.getByLabel('Alt text', { exact: true }).fill('Edited uploaded pixel')
      await launched.page.getByRole('button', { name: 'Save metadata', exact: true }).click()
      await expect(renderedEditor.getByRole('img', { name: 'Edited uploaded pixel' })).toBeVisible()
      await expect(launched.page.getByText('Saved', { exact: true }).first()).toBeVisible({
        timeout: 10_000
      })
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

      await launched.page.getByRole('menuitem', { name: 'Tools', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: /Settings/u }).click()
      const settings = launched.page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('option', { name: 'General', exact: true }).click()
      await settings.getByRole('radio', { name: 'Dark', exact: true }).click()
      await expect
        .poll(() => launched.page.evaluate(() => document.documentElement.dataset.theme))
        .toBe('dark')
      await launched.page.keyboard.press('Escape')
      await expect(settings).not.toBeVisible()
      await expect
        .poll(() => renderedEditor.getByRole('img', { name: 'Flow' }).getAttribute('src'))
        .not.toBe(mermaidPreview)
      const browserWindow = await launched.app.browserWindow(launched.page)
      await browserWindow.evaluate((window) => window.setContentSize(620, 800))
      await expect
        .poll(() =>
          renderedEditor.evaluate((element) => element.scrollWidth <= element.clientWidth)
        )
        .toBe(true)
      await browserWindow.evaluate((window) => window.setContentSize(1280, 900))
      await expect(
        launched.page.getByRole('button', { name: 'Edit outline', exact: true })
      ).toBeVisible()

      await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const outline = launched.page.getByRole('dialog', { name: 'Outline editor' })
      await expect(outline.getByRole('button', { name: 'Preview all', exact: true })).toHaveCount(0)
      await outline.getByRole('button', { name: 'Done', exact: true }).click()
      await launched.page.getByRole('button', { name: 'Preview', exact: true }).click()
      const manuscriptPreview = launched.page.getByTestId('whole-manuscript-preview')
      const manuscriptImage = manuscriptPreview.getByRole('img', { name: 'Edited uploaded pixel' })
      await expect(manuscriptPreview).toBeVisible()
      await expect(manuscriptPreview.getByRole('img', { name: 'Mermaid diagram' })).toBeVisible()
      await expect(manuscriptPreview.getByText('Flow', { exact: true })).toBeVisible()
      await expect(manuscriptPreview.getByRole('math')).toBeVisible()
      await expect
        .poll(() =>
          manuscriptImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)
        )
        .toBeGreaterThan(0)
      expect(await manuscriptImage.getAttribute('src')).toMatch(
        /^writellm:\/\/bundle\/project-asset\//
      )
      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await expect(manuscriptPreview).not.toBeVisible()

      await launched.page.getByRole('button', { name: 'Section actions', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Export Markdown', exact: true }).click()
      const exportsDirectory = join(projectRoot, 'manuscript', 'exports')
      await expect
        .poll(
          async () =>
            (await readdir(exportsDirectory)).filter((name) => name.endsWith('.md')).length
        )
        .toBe(1)
      const exportName = (await readdir(exportsDirectory)).find((name) => name.endsWith('.md'))
      if (exportName === undefined) throw new Error('Markdown export missing')
      const markdown = await readFile(join(exportsDirectory, exportName), 'utf8')
      expect(markdown).toContain('```mermaid')
      expect(markdown).toContain('$$\nE = mc^2\n$$')
      expect(markdown).toContain('![Edited uploaded pixel]')
      expect(markdown).toMatch(/\.\.\/assets\/[0-9a-f]{64}\.png/)

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      await expect(launched.page.getByTestId('section-editor').getByRole('img')).toHaveCount(2)
      await expect(
        launched.page
          .getByTestId('section-editor')
          .getByRole('img', { name: 'Edited uploaded pixel' })
      ).toBeVisible()
      expect(
        await launched.page.evaluate(async () => {
          const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
            ?.projectSessionId
          if (projectSessionId === undefined) throw new Error('Project session missing')
          const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
          const sectionId = workspace.sections[0]?.section.sectionId
          if (sectionId === undefined) throw new Error('Section missing')
          const loaded = await window.desktop.editor.loadSection({ projectSessionId, sectionId })
          const image = loaded.revision.content.find((block) => block.type === 'image')
          if (image?.type !== 'image') throw new Error('Image block missing')
          return {
            altText: image.props.altText,
            caption: image.props.caption,
            figureId: image.props.figureId
          }
        })
      ).toEqual({
        altText: 'Edited uploaded pixel',
        caption: 'Edited project asset',
        figureId: expect.stringMatching(/^figure:/)
      })
      await expect(launched.page.getByTestId('section-editor').getByRole('math')).toBeVisible()
    } finally {
      await launched.app.close()
    }
  }
)

test(
  'switches citation display, filters counts, renumbers references, and exports global markers',
  scenario('manuscript.citation-display-references-export'),
  async ({ testRoot }) => {
    const projectName = 'Citation display'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, projectName)
      const ids = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const initial = await window.desktop.manuscript.workspace({ projectSessionId })
        const first = initial.sections[0]
        if (first === undefined) throw new Error('Initial section missing')
        const firstCurrent = await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: first.section.sectionId
        })
        const firstSaved = await window.desktop.editor.saveSectionDocument({
          projectSessionId,
          sectionId: first.section.sectionId,
          baseRevisionId: firstCurrent.revision.sectionRevisionId,
          baseContentHash: firstCurrent.revision.contentHash,
          document: [
            {
              id: crypto.randomUUID(),
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [
                {
                  type: 'text',
                  text: 'Alpha [Source: Alpha report, p. 1] Omega',
                  styles: {}
                }
              ],
              children: []
            }
          ]
        })
        if (!firstSaved.ok) throw new Error(firstSaved.error.message)
        const created = await window.desktop.manuscript.createSection({
          projectSessionId,
          create: {
            baseOutlineVersion: initial.outlineVersion,
            parentSectionId: null,
            position: 1,
            title: 'Second',
            objective: null,
            status: 'drafting'
          }
        })
        const second = created.sections.find(
          (item) => item.section.sectionId !== first.section.sectionId
        )
        if (second === undefined) throw new Error('Second section missing')
        const secondCurrent = await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: second.section.sectionId
        })
        const secondSaved = await window.desktop.editor.saveSectionDocument({
          projectSessionId,
          sectionId: second.section.sectionId,
          baseRevisionId: secondCurrent.revision.sectionRevisionId,
          baseContentHash: secondCurrent.revision.contentHash,
          document: [
            {
              id: crypto.randomUUID(),
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [
                { type: 'text', text: 'Beta [Source: Beta report] Gamma ', styles: {} },
                { type: 'text', text: '【来源：Alpha report，第 9 页】', styles: { italic: true } }
              ],
              children: []
            }
          ]
        })
        if (!secondSaved.ok) throw new Error(secondSaved.error.message)
        return {
          projectSessionId,
          firstSectionId: first.section.sectionId,
          secondSectionId: second.section.sectionId
        }
      })
      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)

      await expect(
        launched.page.getByTestId(`outline-word-count-${ids.firstSectionId}`)
      ).toHaveText('2')
      await expect(
        launched.page.getByTestId(`outline-word-count-${ids.secondSectionId}`)
      ).toHaveText('2')
      await expect(
        launched.page.getByText('4 words · 19 characters', { exact: true })
      ).toBeVisible()

      await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = launched.page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('radio', { name: '[1]', exact: true }).click()
      await launched.page.keyboard.press('Escape')
      await expect(
        sectionEditor(launched.page).locator('.writellm-readable-citation-numbered')
      ).toHaveText('[1]')
      const numberedLayout = await sectionEditor(launched.page)
        .locator('.bn-inline-content', { hasText: 'Alpha' })
        .evaluate((paragraph) => {
          const hiddenSource = paragraph.querySelector<HTMLElement>(
            '.writellm-readable-citation-source-hidden'
          )
          const marker = paragraph.querySelector<HTMLElement>(
            '.writellm-readable-citation-numbered'
          )
          if (hiddenSource === null || marker === null) {
            throw new Error('Compact citation geometry missing')
          }
          return {
            paragraphHeight: paragraph.getBoundingClientRect().height,
            hiddenHeight: hiddenSource.getBoundingClientRect().height,
            markerHeight: marker.getBoundingClientRect().height,
            hiddenWhiteSpace: getComputedStyle(hiddenSource).whiteSpace
          }
        })
      expect(numberedLayout.hiddenWhiteSpace).toBe('nowrap')
      expect(numberedLayout.hiddenHeight).toBeLessThanOrEqual(numberedLayout.paragraphHeight)
      expect(numberedLayout.markerHeight).toBeLessThanOrEqual(numberedLayout.paragraphHeight)
      expect(numberedLayout.paragraphHeight).toBeLessThan(64)

      await launched.page.getByRole('button', { name: 'References', exact: true }).click()
      const references = launched.page.locator('[aria-label="Manuscript references"]')
      await expect(references.getByText('Alpha report', { exact: true })).toBeVisible()
      await expect(references.getByText('2 citations', { exact: true })).toBeVisible()
      await references.getByText('Alpha report', { exact: true }).click()
      const unavailable = launched.page.getByRole('dialog', { name: 'Source link unavailable' })
      await expect(unavailable).toContainText('No verifiable source association')
      await launched.page.keyboard.press('Escape')

      await launched.page.evaluate(() => window.resizeTo(700, 670))
      await expect
        .poll(() => launched.page.evaluate(() => window.matchMedia('(max-width: 767px)').matches))
        .toBe(true)
      const mobileSidebar = launched.page.locator('[data-mobile="true"]').filter({
        has: launched.page.locator('[aria-label="Manuscript references"]')
      })
      await expect(mobileSidebar).toBeVisible()
      await expect(
        mobileSidebar
          .locator('[aria-label="Manuscript references"]')
          .getByText('Alpha report', { exact: true })
      ).toBeVisible()
      await launched.page.keyboard.press('Escape')
      await launched.page.evaluate(() => window.resizeTo(900, 670))
      await expect
        .poll(() => launched.page.evaluate(() => window.matchMedia('(min-width: 768px)').matches))
        .toBe(true)

      await moveSectionUp(launched.page, 'Second')
      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await launched.page.getByTestId(`outline-section-${ids.firstSectionId}`).click()
      await expect(
        sectionEditor(launched.page).locator('.writellm-readable-citation-numbered')
      ).toHaveText('[2]')

      await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
      await settings.getByRole('radio', { name: 'Icon', exact: true }).click()
      await launched.page.keyboard.press('Escape')
      const citationIcon = sectionEditor(launched.page).locator('.writellm-readable-citation-icon')
      const iconGeometry = await citationIcon.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const svg = element.querySelector('svg')
        if (svg === null) throw new Error('Citation icon SVG missing')
        const svgBounds = svg.getBoundingClientRect()
        const svgStyle = getComputedStyle(svg)
        return {
          width: bounds.width,
          height: bounds.height,
          display: getComputedStyle(element).display,
          svgWidth: svgBounds.width,
          svgHeight: svgBounds.height,
          svgStroke: svgStyle.stroke,
          parent: element.parentElement?.className ?? null,
          parentWidth: element.parentElement?.getBoundingClientRect().width ?? null
        }
      })
      expect(iconGeometry.width).toBeGreaterThan(0)
      expect(iconGeometry.height).toBeGreaterThan(0)
      expect(iconGeometry.svgWidth).toBe(16)
      expect(iconGeometry.svgHeight).toBe(16)
      expect(iconGeometry.svgStroke).not.toBe('none')
      expect(iconGeometry.svgStroke).not.toBe('rgba(0, 0, 0, 0)')
      await expect(citationIcon.locator('svg')).toHaveCount(1)
      await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
      await settings.getByRole('radio', { name: 'Full', exact: true }).click()
      await launched.page.keyboard.press('Escape')
      await expect(sectionEditor(launched.page)).toContainText('[Source: Alpha report, p. 1]')

      await launched.page.getByRole('button', { name: 'Section actions', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Export Markdown', exact: true }).click()
      const exportsDirectory = join(projectRoot, 'manuscript', 'exports')
      await expect
        .poll(async () => (await readdir(exportsDirectory)).filter((name) => name.endsWith('.md')))
        .toHaveLength(1)
      const exportName = (await readdir(exportsDirectory)).find((name) => name.endsWith('.md'))
      if (exportName === undefined) throw new Error('Citation Markdown export missing')
      const markdown = await readFile(join(exportsDirectory, exportName), 'utf8')
      expect(markdown).toBe('Alpha [2] Omega\n')
      expect(markdown).not.toContain('Alpha report')
      expect(markdown).not.toContain('References')
    } finally {
      await launched.app.close()
    }
  }
)
