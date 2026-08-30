# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-quick-actions.spec.ts >> runs an exact selection quick action through the normal Agent conversation
- Location: e2e\agent-quick-actions.spec.ts:6:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Open Agent quick actions' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('button', { name: 'Open Agent quick actions' })

```

```yaml
- text: WriteLLM
- menubar:
  - menuitem "Project"
  - menuitem "Edit"
  - menuitem "Tools"
- button "Agent"
- list:
  - listitem:
    - button
- list:
  - listitem:
    - button "Manuscript"
  - listitem:
    - button "Preview"
  - listitem:
    - button "Find"
  - listitem:
    - button "References"
  - listitem:
    - button "Knowledge"
  - listitem:
    - button "Notebook"
  - listitem:
    - button "Checks"
  - listitem:
    - button "Writing rules"
  - listitem:
    - button "Review Center, 0 open annotations"
  - listitem:
    - button "Images"
  - listitem:
    - button "Settings"
- text: Quick action project Active
- button "Brief"
- button "Edit outline"
- text: Outline
- list:
  - listitem:
    - button "Planned Evidence notes 5"
- region "Manuscript statistics":
  - paragraph: 5 words · 28 characters
  - paragraph: 0/1 sections completed
- main:
  - button "Toggle Sidebar"
  - text: Open
  - main:
    - textbox "Section title": Evidence notes
    - text: Saved
    - button "Section actions"
    - textbox:
      - paragraph: This exact claim needs evidence.
      - paragraph
    - text: Saved ⌘/Ctrl+S save · ⇧⌘/Ctrl+K quick actions · ⌘/Ctrl+Alt+↑/↓ navigate ⌘/Ctrl+J toggles the agent panel
- heading "Settings" [level=2]
- paragraph: Application settings and provider configuration
- region "Notifications alt+T"
```

# Test source

```ts
  1   | import { createServer, type ServerResponse } from 'node:http'
  2   | import type { AddressInfo } from 'node:net'
  3   | import { join } from 'node:path'
  4   | import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'
  5   | 
  6   | test(
  7   |   'runs an exact selection quick action through the normal Agent conversation',
  8   |   scenario('agent.selection-quick-actions'),
  9   |   async ({ testRoot }) => {
  10  |     const agentRequests: unknown[] = []
  11  |     const server = createServer((request, response) => {
  12  |       if (request.method === 'GET' && request.url === '/v1/models') {
  13  |         response.writeHead(200, { 'content-type': 'application/json' })
  14  |         response.end('{"data":[{"id":"quick-writer","displayName":"Quick Writer"}]}')
  15  |         return
  16  |       }
  17  |       if (request.method === 'POST' && request.url === '/v1/chat/completions') {
  18  |         const chunks: Buffer[] = []
  19  |         request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  20  |         request.on('end', () => {
  21  |           const body = JSON.parse(Buffer.concat(chunks).toString()) as {
  22  |             messages?: Array<{ role?: string; content?: unknown }>
  23  |           }
  24  |           if (JSON.stringify(body).includes('Create a concise title for the delimited')) {
  25  |             sendCompletion(response, 'Evidence review')
  26  |             return
  27  |           }
  28  |           agentRequests.push(body)
  29  |           sendCompletion(
  30  |             response,
  31  |             'The selected claim is clear but has no linked project evidence. Review completed; no manuscript change is proposed.'
  32  |           )
  33  |         })
  34  |         return
  35  |       }
  36  |       response.writeHead(404)
  37  |       response.end()
  38  |     })
  39  |     await new Promise<void>((resolve, reject) => {
  40  |       server.once('error', reject)
  41  |       server.listen(0, '127.0.0.1', resolve)
  42  |     })
  43  |     const port = (server.address() as AddressInfo).port
  44  |     const launched = await launchApp({
  45  |       userData: join(testRoot, 'user-data'),
  46  |       dialogPaths: [testRoot]
  47  |     })
  48  |     try {
  49  |       await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)
  50  |       await createProject(launched.page, 'Quick action project')
  51  |       await launched.page.getByLabel('Section title').fill('Evidence notes')
  52  |       await launched.page.getByLabel('Section title').press('Tab')
  53  |       const editor = sectionEditor(launched.page)
  54  |       await editor.fill('This exact claim needs evidence.')
  55  |       await launched.page.keyboard.press('ControlOrMeta+s')
  56  | 
  57  |       await launched.page.getByTestId('agent-menubar-trigger').click()
  58  |       const panel = launched.page.getByTestId('agent-panel')
  59  |       await panel.getByTestId('agent-conversation-menu').click()
  60  |       await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
  61  |       const details = launched.page.getByRole('dialog', { name: 'Agent details' })
  62  |       await details.getByLabel('Agent model').click()
  63  |       const modelPicker = launched.page.getByTestId('agent-model-picker')
  64  |       await modelPicker.getByRole('option', { name: /Quick action Agent/ }).click()
  65  |       await modelPicker.getByRole('option', { name: /Quick Writer/ }).click()
  66  |       await details.getByRole('button', { name: 'Close', exact: true }).click()
  67  |       await panel.getByRole('button', { name: 'Close writing agent' }).click()
  68  | 
  69  |       await editor.click()
  70  |       await launched.page.keyboard.press('End')
  71  |       await launched.page.keyboard.press('Shift+Home')
  72  |       await expect(
  73  |         launched.page.getByRole('button', { name: 'Open Agent quick actions' })
> 74  |       ).toBeVisible()
      |         ^ Error: expect(locator).toBeVisible() failed
  75  |       await launched.page.keyboard.press('ControlOrMeta+Shift+k')
  76  |       await expect(
  77  |         launched.page.getByRole('menu', { name: 'Open Agent quick actions' })
  78  |       ).toBeVisible()
  79  |       await launched.page.getByRole('menuitem', { name: /Check evidence/ }).dispatchEvent('click')
  80  | 
  81  |       await expect(panel).toBeVisible()
  82  |       await expect(panel.getByText('Quick action · Check evidence', { exact: true })).toBeVisible()
  83  |       await expect(panel.getByText('Captured selection', { exact: true })).toBeVisible()
  84  |       await expect(
  85  |         panel.getByText('This exact claim needs evidence.', { exact: true })
  86  |       ).toBeVisible()
  87  |       await expect(
  88  |         panel.getByText(
  89  |           'The selected claim is clear but has no linked project evidence. Review completed; no manuscript change is proposed.',
  90  |           { exact: true }
  91  |         )
  92  |       ).toBeVisible()
  93  |       await expect(panel.getByTestId('agent-status')).toContainText('Ready')
  94  |       await expect(panel.getByRole('button', { name: /Apply/ })).toHaveCount(0)
  95  | 
  96  |       const truth = await launched.page.evaluate(async () => {
  97  |         const project = (await window.desktop.projects.lifecycle()).activeProject
  98  |         if (project === undefined) throw new Error('Project is not open')
  99  |         const session = (
  100 |           await window.desktop.agent.listSessions({ projectSessionId: project.projectSessionId })
  101 |         )[0]
  102 |         if (session === undefined) throw new Error('Agent session is missing')
  103 |         const runs = await window.desktop.agent.listRuns({
  104 |           projectSessionId: project.projectSessionId,
  105 |           agentSessionId: session.agentSessionId
  106 |         })
  107 |         const proposals = await window.desktop.agent.listProposals({
  108 |           projectSessionId: project.projectSessionId,
  109 |           agentSessionId: session.agentSessionId
  110 |         })
  111 |         return { session, runs, proposals }
  112 |       })
  113 |       expect(truth.runs[0]?.editorContext).toMatchObject({
  114 |         selectedText: 'This exact claim needs evidence.',
  115 |         selectedBlockIds: expect.arrayContaining([expect.any(String)])
  116 |       })
  117 |       expect(truth.proposals).toEqual([])
  118 |       expect(agentRequests).toHaveLength(1)
  119 |       const requestText = JSON.stringify(agentRequests[0])
  120 |       expect(requestText).toContain('QUICK_ACTION_SELECTION')
  121 |       expect(requestText).toContain('This exact claim needs evidence.')
  122 |       expect(requestText).toContain('review-only response with no proposal is a successful outcome')
  123 |     } finally {
  124 |       await launched.app.close()
  125 |       await new Promise<void>((resolve) => server.close(() => resolve()))
  126 |     }
  127 |   }
  128 | )
  129 | 
  130 | function sendCompletion(response: ServerResponse, content: string): void {
  131 |   response.writeHead(200, {
  132 |     'content-type': 'text/event-stream',
  133 |     'cache-control': 'no-cache'
  134 |   })
  135 |   const chunks = [
  136 |     {
  137 |       id: 'quick-action-response',
  138 |       object: 'chat.completion.chunk',
  139 |       created: 1,
  140 |       model: 'quick-writer',
  141 |       choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
  142 |     },
  143 |     {
  144 |       id: 'quick-action-response',
  145 |       object: 'chat.completion.chunk',
  146 |       created: 1,
  147 |       model: 'quick-writer',
  148 |       choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  149 |       usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 }
  150 |     }
  151 |   ]
  152 |   for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  153 |   response.end('data: [DONE]\n\n')
  154 | }
  155 | 
  156 | async function configureAgentProvider(
  157 |   page: import('@playwright/test').Page,
  158 |   baseUrl: string
  159 | ): Promise<void> {
  160 |   await page.getByRole('button', { name: 'Settings', exact: true }).click()
  161 |   const settings = page.getByRole('dialog', { name: 'Settings' })
  162 |   await settings.getByRole('option', { name: /^Agent API/ }).click()
  163 |   await settings.getByRole('button', { name: 'Add provider' }).click()
  164 |   const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  165 |   await addProvider.getByLabel('Provider name').fill('Quick action Agent')
  166 |   await addProvider.getByRole('button', { name: 'Continue' }).click()
  167 |   await settings.getByLabel('Base URL').fill(baseUrl)
  168 |   await settings.getByLabel('API key').fill('e2e-secret')
  169 |   await settings.getByRole('button', { name: 'Save provider' }).click()
  170 |   await settings.getByRole('button', { name: 'Fetch Quick action Agent models' }).click()
  171 |   await expect(settings.getByText(/1 models · current/)).toBeVisible()
  172 |   await page.keyboard.press('Escape')
  173 | }
  174 | 
```