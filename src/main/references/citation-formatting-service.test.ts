import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CitationFormatterRequest,
  CitationFormatterResult
} from '../../shared/contracts/citation-formatting'
import type { ProjectContext } from '../project/project-context'
import { CitationFormattingService } from './citation-formatting-service'

type Request = Omit<CitationFormatterRequest, 'operation' | 'requestId'>
const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function harness() {
  vi.useFakeTimers()
  const settings = {
    styleId: 'apa',
    locale: 'en-US',
    customStyleRelativePath: null as string | null
  }
  let text = 'See [@beta; @alpha, pp. 2-4] and [@missing].'
  const references = ['beta', 'alpha', 'uncited'].map((key) => ({
    citationKey: key,
    csl: { id: key, type: 'article-journal', title: key }
  }))
  const context = {
    manifest: { projectId: 'project-1' },
    projectSessionId: '11111111-1111-4111-8111-111111111111',
    manuscript: {
      assemble: () => ({
        sections: [
          {
            section: { sectionId: 'section-1' },
            revision: {
              sectionRevisionId: 'revision-1',
              content: [
                {
                  id: 'block-1',
                  type: 'paragraph',
                  props: {},
                  children: [],
                  content: [{ type: 'text', text, styles: {} }]
                }
              ]
            }
          }
        ]
      })
    },
    references: { list: () => references, formattingSettings: () => settings },
    filesystem: { assertExistingRegularFile: vi.fn(async (_relative: string) => '') }
  }
  const format = vi.fn(
    async (input: Request, _signal: AbortSignal): Promise<CitationFormatterResult> => ({
      type: 'citation-format-result',
      requestId: '11111111-1111-4111-8111-111111111112',
      projectSessionId: input.projectSessionId,
      snapshotHash: input.snapshotHash,
      citations: input.clusters.map((cluster) => ({
        clusterId: cluster.clusterId,
        formatted: '(Alpha; Beta)'
      })),
      bibliography: input.items.map((item) => ({
        citationKey: item.id as string,
        formatted: `${item.title}.`
      }))
    })
  )
  const log = { info: vi.fn(), error: vi.fn() }
  const service = new CitationFormattingService({ client: { format } as never, log })
  const run = async () => {
    const settled = service.format(context as unknown as ProjectContext).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    await vi.advanceTimersByTimeAsync(300)
    const result = await settled
    if ('error' in result) throw result.error
    return result.value
  }
  return {
    context,
    settings,
    references,
    format,
    log,
    service,
    run,
    setText: (value: string) => {
      text = value
    }
  }
}

describe('CitationFormattingService', () => {
  it('formats complete clusters in manuscript order with locators and restores source tokens', async () => {
    const { run, format } = harness()
    const snapshot = await run()
    const request = format.mock.calls[0]?.[0]
    expect(request?.items.map((item) => item.id)).toEqual(['alpha', 'beta'])
    expect(request?.clusters).toEqual([
      {
        clusterId: expect.stringMatching(/^section-1:/),
        items: [
          { citationKey: 'beta' },
          { citationKey: 'alpha', locator: { label: 'page', startPageIndex: 1, endPageIndex: 3 } }
        ]
      }
    ])
    expect(snapshot).toMatchObject({
      styleId: 'apa',
      locale: 'en-US',
      citations: [{ raw: '[@beta; @alpha, pp. 2-4]', formatted: '(Alpha; Beta)' }]
    })
    expect(snapshot.bibliography.map((entry) => entry.citationKey)).toEqual(['alpha', 'beta'])
  })

  it('reuses unchanged citation snapshots across prose edits and invalidates changed metadata and locale', async () => {
    const fixture = harness()
    const first = await fixture.run()
    fixture.setText('See [@beta; @alpha, pp. 2-4] and [@missing]. Different prose.')
    expect(await fixture.run()).toBe(first)
    expect(fixture.format).toHaveBeenCalledOnce()
    const reference = fixture.references[0]
    if (reference === undefined) throw new Error('Missing reference fixture')
    reference.csl.title = 'Revised title'
    const revised = await fixture.run()
    expect(revised.snapshotHash).not.toBe(first.snapshotHash)
    fixture.settings.locale = 'zh-CN'
    expect((await fixture.run()).snapshotHash).not.toBe(revised.snapshotHash)
    expect(fixture.format).toHaveBeenCalledTimes(3)
  })

  it('omits an entire cluster when any citekey is unresolved', async () => {
    const fixture = harness()
    fixture.setText('[@alpha; @missing]')
    expect(await fixture.run()).toMatchObject({ citations: [], bibliography: [] })
    expect(fixture.format.mock.calls[0]?.[0]).toMatchObject({ items: [], clusters: [] })
  })

  it('logs worker failures with the original error and permits a later retry', async () => {
    const fixture = harness()
    const cause = new Error('Worker unavailable')
    fixture.format.mockRejectedValueOnce(cause)
    const failure = expect(fixture.run()).rejects.toMatchObject({
      message: 'Citation formatting failed',
      cause
    })
    await failure
    expect(fixture.log.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'reference.formatter.failed', err: cause }),
      expect.any(String)
    )
    expect((await fixture.run()).citations).toHaveLength(1)
  })

  it('rejects formatter output that cannot map back to a source cluster', async () => {
    const fixture = harness()
    fixture.format.mockImplementationOnce(async (input) => ({
      type: 'citation-format-result',
      requestId: '11111111-1111-4111-8111-111111111112',
      projectSessionId: input.projectSessionId,
      snapshotHash: input.snapshotHash,
      citations: [{ clusterId: 'unknown', formatted: '(Unknown)' }],
      bibliography: []
    }))
    await expect(fixture.run()).rejects.toMatchObject({ cause: { name: 'ZodError' } })
    expect(fixture.log.error).toHaveBeenCalledOnce()
  })

  it('supersedes pending debounce work without sending an obsolete worker request', async () => {
    const fixture = harness()
    const first = fixture.service.format(fixture.context as unknown as ProjectContext)
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    fixture.setText('[@alpha]')
    const second = fixture.run()
    await rejected
    expect((await second).citations[0]?.raw).toBe('[@alpha]')
    expect(fixture.format).toHaveBeenCalledOnce()
  })

  it('aborts active formatting on close and rejects late worker results', async () => {
    const fixture = harness()
    let finish!: (result: CitationFormatterResult) => void
    fixture.format.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = fixture.service.format(fixture.context as unknown as ProjectContext)
    const failure = expect(pending).rejects.toMatchObject({ cause: { name: 'AbortError' } })
    await vi.advanceTimersByTimeAsync(300)
    const call = fixture.format.mock.calls[0]
    if (call === undefined) throw new Error('Expected a formatter call')
    const [request, signal] = call
    fixture.service.close()
    expect(signal.aborted).toBe(true)
    finish({
      type: 'citation-format-result',
      requestId: '11111111-1111-4111-8111-111111111112',
      projectSessionId: request.projectSessionId,
      snapshotHash: request.snapshotHash,
      citations: [],
      bibliography: []
    })
    await failure
  })

  it('reads custom style content only through the project filesystem capability', async () => {
    const fixture = harness()
    const root = await mkdtemp(join(tmpdir(), 'writellm-citation-style-'))
    roots.push(root)
    const path = join(root, 'style.csl')
    await writeFile(path, '<style class="in-text"/>')
    fixture.settings.customStyleRelativePath = 'styles/custom.csl'
    fixture.context.filesystem.assertExistingRegularFile.mockResolvedValueOnce(path)
    const pending = fixture.service.format(fixture.context as unknown as ProjectContext)
    // Wait for the real file read before advancing the debounce timer.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
    await vi.advanceTimersByTimeAsync(300)
    await pending
    expect(fixture.context.filesystem.assertExistingRegularFile).toHaveBeenCalledWith(
      'styles/custom.csl'
    )
    expect(fixture.format.mock.calls[0]?.[0].style.customXml).toBe(await readFile(path, 'utf8'))
  })
})
