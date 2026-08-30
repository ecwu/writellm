# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: parsed-knowledge.spec.ts >> checks article-level citation coverage and refreshes after manuscript edits
- Location: e2e\parsed-knowledge.spec.ts:598:5

# Error details

```
TimeoutError: locator.focus: Timeout 30000ms exceeded.
Call log:
  - waiting for getByLabel('Section title')

```

```
Error: unexpected Renderer pageerror/console.error events

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "pageerror: {\"name\":\"Error\",\"message\":\"Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.\",\"stack\":\"Error: Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.\\n    at getRootForUpdatedFiber (writellm://bundle/assets/index-Dv-5n6DR.js:2641:66)\\n    at enqueueConcurrentHookUpdate (writellm://bundle/assets/index-Dv-5n6DR.js:2625:12)\\n    at dispatchSetStateInternal (writellm://bundle/assets/index-Dv-5n6DR.js:4852:16)\\n    at dispatchSetState (writellm://bundle/assets/index-Dv-5n6DR.js:4827:5)\\n    at Object.setReference (writellm://bundle/assets/index-Dv-5n6DR.js:174927:7)\\n    at writellm://bundle/assets/index-Dv-5n6DR.js:175635:89\\n    at commitHookEffectListMount (writellm://bundle/assets/index-Dv-5n6DR.js:6975:26)\\n    at commitPassiveMountOnFiber (writellm://bundle/assets/index-Dv-5n6DR.js:8125:25)\\n    at recursivelyTraversePassiveMountEffects (writellm://bundle/assets/index-Dv-5n6DR.js:8106:9)\\n    at commitPassiveMountOnFiber (writellm://bundle/assets/index-Dv-5n6DR.js:8119:9)\",\"url\":\"writellm://bundle/\",\"pageClosed\":false}",
+ ]
```

# Test source

```ts
  97  |   }
  98  |   const page = await app.firstWindow()
  99  |   const rendererErrors = rendererErrorsForCurrentTest()
  100 |   page.on('pageerror', (error) => {
  101 |     const details = {
  102 |       name: error.name,
  103 |       message: error.message,
  104 |       stack: error.stack,
  105 |       cause: error.cause,
  106 |       url: page.url(),
  107 |       pageClosed: page.isClosed()
  108 |     }
  109 |     rendererErrors.push(`pageerror: ${JSON.stringify(details)}`)
  110 |   })
  111 |   page.on('console', (message) => {
  112 |     if (message.type() === 'error') {
  113 |       const location = message.location()
  114 |       if (
  115 |         message.text() === 'Failed to load resource: net::ERR_UNKNOWN_URL_SCHEME' &&
  116 |         /^writellm-asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
  117 |           location.url
  118 |         )
  119 |       ) {
  120 |         return
  121 |       }
  122 |       rendererErrors.push(`console.error: ${JSON.stringify({ text: message.text(), location })}`)
  123 |     }
  124 |   })
  125 |   await page.waitForLoadState('domcontentloaded')
  126 |   if (options.onboarding !== 'show') {
  127 |     const onboardingCompleted = await page.evaluate(async () => {
  128 |       const current = await window.desktop.app.getOnboardingState()
  129 |       if (current.status === 'completed') return true
  130 |       await window.desktop.app.setOnboardingState({
  131 |         state: { schemaVersion: 1, status: 'completed' }
  132 |       })
  133 |       return false
  134 |     })
  135 |     if (!onboardingCompleted) await page.reload({ waitUntil: 'domcontentloaded' })
  136 |   }
  137 |   if (windowPresentation === 'silent-e2e') {
  138 |     await expect
  139 |       .poll(() =>
  140 |         app.evaluate(({ BrowserWindow }) => {
  141 |           const window = BrowserWindow.getAllWindows()[0]
  142 |           return {
  143 |             visible: window?.isVisible() ?? false,
  144 |             focused: window?.isFocused() ?? false,
  145 |             backgroundThrottling: window?.webContents.getBackgroundThrottling() ?? true
  146 |           }
  147 |         })
  148 |       )
  149 |       .toEqual({ visible: false, focused: false, backgroundThrottling: false })
  150 |   }
  151 |   return { app, page }
  152 | }
  153 | 
  154 | /**
  155 |  * Asserts that a project is open by checking the workspace sidebar header, which
  156 |  * renders the project name as plain text next to an `Active` badge (not a heading).
  157 |  */
  158 | export async function expectActiveProject(page: Page, name: string): Promise<void> {
  159 |   const header = page.locator('[data-slot="sidebar-header"]').filter({ hasText: name })
  160 |   await expect(header.getByText(name, { exact: true })).toBeVisible()
  161 |   await expect(header.getByText('Active', { exact: true })).toBeVisible()
  162 | }
  163 | 
  164 | export function sectionEditor(page: Page) {
  165 |   return page.getByTestId('section-editor').locator('.bn-editor[role="textbox"]')
  166 | }
  167 | 
  168 | interface Fixtures {
  169 |   testRoot: string
  170 |   rendererErrorGuard: undefined
  171 | }
  172 | 
  173 | const rendererErrorsByTest = new Map<string, string[]>()
  174 | 
  175 | export function scenario(
  176 |   id: string,
  177 |   tags: readonly ('@critical' | '@packaged')[] = []
  178 | ): {
  179 |   tag: string[]
  180 |   annotation: { type: string; description: string }
  181 | } {
  182 |   return {
  183 |     tag: [...tags],
  184 |     annotation: { type: 'scenario', description: id }
  185 |   }
  186 | }
  187 | 
  188 | export const test = base.extend<Fixtures>({
  189 |   rendererErrorGuard: [
  190 |     // Playwright requires fixture callbacks to use an object destructuring pattern.
  191 |     // biome-ignore lint/correctness/noEmptyPattern: required by the Playwright fixture API
  192 |     async ({}, use, testInfo) => {
  193 |       rendererErrorsByTest.set(testInfo.testId, [])
  194 |       await use(undefined)
  195 |       const errors = rendererErrorsByTest.get(testInfo.testId) ?? []
  196 |       rendererErrorsByTest.delete(testInfo.testId)
> 197 |       expect(errors, 'unexpected Renderer pageerror/console.error events').toEqual([])
      |                                                                            ^ Error: unexpected Renderer pageerror/console.error events
  198 |     },
  199 |     { auto: true }
  200 |   ],
  201 |   // Playwright requires fixture callbacks to use an object destructuring pattern.
  202 |   // biome-ignore lint/correctness/noEmptyPattern: required by the Playwright fixture API
  203 |   testRoot: async ({}, use) => {
  204 |     const root = await mkdtemp(join(tmpdir(), 'writellm-e2e-'))
  205 |     await mkdir(join(root, 'user-data'))
  206 |     try {
  207 |       await use(root)
  208 |     } finally {
  209 |       await rm(root, {
  210 |         recursive: true,
  211 |         force: true,
  212 |         maxRetries: process.platform === 'win32' ? 20 : 0,
  213 |         retryDelay: 100
  214 |       })
  215 |     }
  216 |   }
  217 | })
  218 | 
  219 | function rendererErrorsForCurrentTest(): string[] {
  220 |   let testInfo: TestInfo
  221 |   try {
  222 |     testInfo = base.info()
  223 |   } catch {
  224 |     return []
  225 |   }
  226 |   const existing = rendererErrorsByTest.get(testInfo.testId)
  227 |   if (existing !== undefined) return existing
  228 |   const created: string[] = []
  229 |   rendererErrorsByTest.set(testInfo.testId, created)
  230 |   return created
  231 | }
  232 | 
  233 | export { expect } from '@playwright/test'
  234 | 
```