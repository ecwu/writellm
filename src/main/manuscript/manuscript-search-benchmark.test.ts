import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { manuscriptSearchInputSchema } from '../../shared/contracts/manuscript-search'
import type { ManuscriptAssembly } from '../../shared/contracts/manuscript'
import { ManuscriptSearchService } from './manuscript-search-service'
import type { ManuscriptService } from './manuscript-service'

const enabled = process.env.WRITELLM_MANUSCRIPT_SEARCH_BENCHMARK === '1'

describe('manuscript search benchmark', () => {
  it.runIf(enabled)('meets the 1,000-section / 8-MiB decision gate', async () => {
    const assembly = benchmarkAssembly()
    const serializedBytes = Buffer.byteLength(JSON.stringify(assembly.sections), 'utf8')
    expect(assembly.sections).toHaveLength(1_000)
    expect(serializedBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024)
    const service = new ManuscriptSearchService({
      manuscript: { assemble: () => assembly } as ManuscriptService,
      log: { info: vi.fn(), error: vi.fn() }
    })
    const input = manuscriptSearchInputSchema.parse({
      projectSessionId: 'benchmark-session',
      query: 'needle-0999',
      caseSensitive: false,
      scope: { type: 'manuscript' },
      statuses: [],
      limit: 25
    })
    const samples: number[] = []
    let maxSynchronousSliceMs = 0
    let finalResult: Awaited<ReturnType<typeof service.search>> | undefined
    const rssBefore = process.memoryUsage().rss
    for (let index = 0; index < 35; index += 1) {
      const startedAt = performance.now()
      const result = await service.search(input, new AbortController().signal, {
        budgetMs: 10_000
      })
      const durationMs = performance.now() - startedAt
      expect(result.complete).toBe(true)
      if (index >= 5) samples.push(durationMs)
      maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, result.metrics.maxSynchronousSliceMs)
      finalResult = result
    }
    const ordered = [...samples].sort((left, right) => left - right)
    const percentile = (value: number) =>
      ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * value) - 1)] ?? 0
    const evidence = {
      fixtureFingerprint: createHash('sha256')
        .update(JSON.stringify(assembly.sections.map((entry) => entry.revision.contentHash)))
        .digest('hex'),
      runtime: process.version,
      architecture: process.arch,
      sections: assembly.sections.length,
      serializedBytes,
      query: input.query,
      mode: 'case_insensitive',
      warmups: 5,
      samples: samples.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxSynchronousSliceMs,
      scannedBytes: finalResult?.scannedBytes,
      scannedSurfaces: finalResult?.scannedSurfaces,
      slowPathSurfaces: finalResult?.slowPathSurfaces,
      largeSlowPathSurfaceUtf16: 'Cafe\u0301 evidence '.repeat(5_000).length,
      hitCount: finalResult?.resultCount,
      rssDeltaBytes: process.memoryUsage().rss - rssBefore
    }
    process.stdout.write(`MANUSCRIPT_SEARCH_BENCHMARK ${JSON.stringify(evidence)}\n`)
    expect(evidence.p95Ms).toBeLessThanOrEqual(250)
    expect(evidence.maxSynchronousSliceMs).toBeLessThanOrEqual(16)
    expect(evidence.slowPathSurfaces).toBeGreaterThanOrEqual(1_001)
  })
})

function benchmarkAssembly(): ManuscriptAssembly {
  const repeated =
    'Research writing evidence connects English prose, 中文段落, emoji 🙂, tables, and captions. '
  const body = repeated.repeat(92)
  const sections: ManuscriptAssembly['sections'] = Array.from({ length: 1_000 }, (_, index) => {
    const suffix = index.toString().padStart(4, '0')
    const text = `${body} needle-${suffix}`
    return {
      section: {
        sectionId: `section-${suffix}`,
        manuscriptId: 'benchmark-manuscript',
        parentSectionId: null,
        position: index,
        level: 1,
        title: `Section ${suffix}`,
        objective: index % 20 === 0 ? `Café objective ${suffix}` : null,
        status: index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'drafting' : 'planned',
        currentRevisionId: `revision-${suffix}`,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z'
      },
      revision: {
        sectionRevisionId: `revision-${suffix}`,
        sectionId: `section-${suffix}`,
        revisionNumber: 1,
        source: 'manual',
        sourceClass: 'manual_autosave',
        content: [
          {
            id: `paragraph-${suffix}`,
            type: 'paragraph',
            props: {
              backgroundColor: 'default',
              textColor: 'default',
              textAlignment: 'left'
            },
            content: [
              { type: 'text', text: text.slice(0, 4_096), styles: {} },
              {
                type: 'link',
                href: 'https://example.com',
                content: [{ type: 'text', text: text.slice(4_096), styles: { italic: true } }]
              }
            ],
            children: []
          },
          ...(index === 0
            ? [
                {
                  id: 'paragraph-large-slow-path',
                  type: 'paragraph' as const,
                  props: {
                    backgroundColor: 'default',
                    textColor: 'default',
                    textAlignment: 'left' as const
                  },
                  content: [
                    {
                      type: 'text' as const,
                      text: 'Cafe\u0301 evidence '.repeat(5_000),
                      styles: {}
                    }
                  ],
                  children: []
                }
              ]
            : []),
          {
            id: `table-${suffix}`,
            type: 'table',
            props: { textColor: 'default' },
            content: {
              type: 'tableContent',
              columnWidths: [null, null],
              rows: [
                {
                  cells: [
                    [{ type: 'text', text: `cell ${suffix}`, styles: {} }],
                    [{ type: 'text', text: 'Cafe\u0301', styles: {} }]
                  ]
                }
              ]
            },
            children: []
          }
        ],
        contentSchemaVersion: 3,
        contentHash: createHash('sha256').update(text).digest('hex'),
        priorRevisionId: null,
        wordCount: 1_000,
        characterCount: text.length,
        countAlgorithmVersion: 2,
        agentRunId: null,
        agentToolCallId: null,
        agentProposalId: null,
        createdAt: '2026-08-12T00:00:00.000Z'
      }
    }
  })
  return {
    manuscriptId: 'benchmark-manuscript',
    outlineVersion: 1,
    brief: {
      manuscriptBriefId: 'benchmark-brief',
      manuscriptId: 'benchmark-manuscript',
      version: 1,
      schemaVersion: 1,
      title: 'Benchmark',
      description: '',
      topic: '',
      targetAudience: '',
      language: '',
      styleTone: '',
      scopeExclusions: '',
      targetLength: '',
      citationRequirements: '',
      additionalInstructions: '',
      extensible: {},
      createdAt: '2026-08-12T00:00:00.000Z'
    },
    sections,
    wordCount: 1_000_000,
    characterCount: sections.reduce((total, entry) => total + entry.revision.characterCount, 0)
  }
}
