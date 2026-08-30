# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-active-tool-context.spec.ts >> keeps the newest long section read authoritative across Pi context pruning
- Location: e2e\agent-active-tool-context.spec.ts:117:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('agent-panel').getByText('RQ3 remained authoritative and the long read sequence completed.', { exact: true })
Expected: visible
Error: strict mode violation: getByTestId('agent-panel').getByText('RQ3 remained authoritative and the long read sequence completed.', { exact: true }) resolved to 2 elements:
    1) <p>RQ3 remained authoritative and the long read sequ…</p> aka getByText('RQ3 remained authoritative').first()
    2) <p>RQ3 remained authoritative and the long read sequ…</p> aka getByText('RQ3 remained authoritative').nth(1)

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByTestId('agent-panel').getByText('RQ3 remained authoritative and the long read sequence completed.', { exact: true })

```

# Test source

```ts
  134 |       }
  135 |       const chunks: Buffer[] = []
  136 |       request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  137 |       request.on('end', () => {
  138 |         const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown
  139 |         const bodyText = JSON.stringify(body)
  140 |         if (bodyText.includes('Create a concise title for the delimited')) {
  141 |           sendCompletion(response, 'Long section context')
  142 |           return
  143 |         }
  144 |         providerBodies.push(body)
  145 |         const sectionId = sectionIds[agentCall]
  146 |         agentCall += 1
  147 |         if (sectionId !== undefined) {
  148 |           sendToolCall(response, {
  149 |             responseId: `cp51-read-response-${agentCall}`,
  150 |             toolCallId: `cp51-read-tool-${agentCall}`,
  151 |             sectionId
  152 |           })
  153 |           return
  154 |         }
  155 |         sendCompletion(response, 'RQ3 remained authoritative and the long read sequence completed.')
  156 |       })
  157 |     })
  158 |     await new Promise<void>((resolve, reject) => {
  159 |       server.once('error', reject)
  160 |       server.listen(0, '127.0.0.1', resolve)
  161 |     })
  162 |     const port = (server.address() as AddressInfo).port
  163 |     const launched = await launchApp({
  164 |       userData: join(testRoot, 'user-data'),
  165 |       dialogPaths: [testRoot]
  166 |     })
  167 |     try {
  168 |       await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)
  169 |       await createProject(launched.page, 'CP51 long context')
  170 |       sectionIds = await launched.page.evaluate(async () => {
  171 |         const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
  172 |           ?.projectSessionId
  173 |         if (projectSessionId === undefined) throw new Error('Project session missing')
  174 |         let workspace = await window.desktop.manuscript.workspace({ projectSessionId })
  175 |         for (const [position, title] of ['RQ2', 'RQ3'].entries()) {
  176 |           workspace = await window.desktop.manuscript.createSection({
  177 |             projectSessionId,
  178 |             create: {
  179 |               baseOutlineVersion: workspace.outlineVersion,
  180 |               parentSectionId: null,
  181 |               position: position + 1,
  182 |               title,
  183 |               objective: null,
  184 |               status: 'drafting'
  185 |             }
  186 |           })
  187 |         }
  188 |         const ordered = [...workspace.sections].sort(
  189 |           (left, right) => left.section.position - right.section.position
  190 |         )
  191 |         for (const [sectionIndex, item] of ordered.entries()) {
  192 |           const marker = `RQ${sectionIndex + 1}-AUTHORITATIVE-MARKER`
  193 |           const current = await window.desktop.editor.loadSection({
  194 |             projectSessionId,
  195 |             sectionId: item.section.sectionId
  196 |           })
  197 |           const document = Array.from({ length: 3 }, (_, blockIndex) => ({
  198 |             id: `rq${sectionIndex + 1}-block-${blockIndex + 1}`,
  199 |             type: 'paragraph' as const,
  200 |             props: {
  201 |               backgroundColor: 'default' as const,
  202 |               textColor: 'default' as const,
  203 |               textAlignment: 'left' as const
  204 |             },
  205 |             content: [
  206 |               {
  207 |                 type: 'text' as const,
  208 |                 text: `${marker}-${blockIndex + 1} ${'context '.repeat(400)}`,
  209 |                 styles: {}
  210 |               }
  211 |             ],
  212 |             children: []
  213 |           }))
  214 |           const saved = await window.desktop.editor.saveSectionDocument({
  215 |             projectSessionId,
  216 |             sectionId: item.section.sectionId,
  217 |             baseRevisionId: current.revision.sectionRevisionId,
  218 |             baseContentHash: current.revision.contentHash,
  219 |             document
  220 |           })
  221 |           if (!saved.ok) throw new Error(saved.error.message)
  222 |         }
  223 |         return ordered.map((item) => item.section.sectionId)
  224 |       })
  225 | 
  226 |       await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
  227 |       const panel = launched.page.getByTestId('agent-panel')
  228 |       await panel.getByLabel('Agent message').fill('Read RQ1, RQ2, and RQ3 in order, then report.')
  229 |       await panel.getByRole('button', { name: 'Send', exact: true }).click()
  230 |       await expect(
  231 |         panel.getByText('RQ3 remained authoritative and the long read sequence completed.', {
  232 |           exact: true
  233 |         })
> 234 |       ).toBeVisible({ timeout: 30_000 })
      |         ^ Error: expect(locator).toBeVisible() failed
  235 | 
  236 |       expect(agentCall).toBe(4)
  237 |       const finalBody = JSON.stringify(providerBodies[3])
  238 |       expect(finalBody).toContain('RQ3-AUTHORITATIVE-MARKER')
  239 |       expect(finalBody).toContain('blockHash')
  240 |       expect(finalBody).toContain('revisionId')
  241 |       expect(finalBody).toContain('historical_projection')
  242 |       const finalRequest = providerBodies[3] as {
  243 |         messages?: Array<{ role?: string; content?: unknown }>
  244 |       }
  245 |       const toolContents =
  246 |         finalRequest.messages
  247 |           ?.filter((message) => message.role === 'tool')
  248 |           .map((message) => String(message.content)) ?? []
  249 |       expect(toolContents.some((content) => content.includes('active_batch_retry'))).toBe(false)
  250 |       expect(finalBody).not.toContain('cp51-e2e-secret')
  251 |       await expect(
  252 |         panel.getByText('Reading context was too large to continue safely', { exact: true })
  253 |       ).toHaveCount(0)
  254 |     } finally {
  255 |       await launched.app.close()
  256 |       await new Promise<void>((resolve) => server.close(() => resolve()))
  257 |     }
  258 |   }
  259 | )
  260 | 
```