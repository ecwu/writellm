import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { KnowledgeItem } from '../../../../shared/contracts/knowledge'
import type { ReferenceItem } from '../../../../shared/contracts/references'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import { TaskRow } from './knowledge-activity'
import {
  canRetryItem,
  currentActivity,
  itemStatus,
  jobProgress,
  libraryEntries,
  loadJobs,
  referenceStatus
} from './knowledge-sidebar-model'

const item = {
  knowledgeItemId: '11111111-1111-4111-8111-111111111111',
  displayName: 'ALBERT.pdf',
  originalName: 'ALBERT.pdf',
  state: 'stored',
  parseState: 'succeeded',
  normalizationState: 'published',
  activeParseRevisionId: 'revision',
  extension: 'pdf',
  createdAt: '2026-09-01'
} as KnowledgeItem
const reference = {
  referenceId: 'reference',
  title: 'ALBERT',
  citationKey: 'lan2020',
  issuedYear: 2020,
  creators: [{ role: 'author', family: 'Lan' }],
  knowledgeItemIds: [item.knowledgeItemId],
  metadataCompleteness: 'complete',
  syncStatus: 'synced',
  createdAt: '2026-09-01'
} as ReferenceItem
const job = {
  jobId: 'job',
  type: 'build_embedding_generation',
  subject: { kind: 'project' },
  state: 'succeeded',
  progress: { completed: 1, total: 2, stage: 'built' },
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01'
} as JobStatus
const ready = { readiness: 'available', indexed: true } as const

describe('Reference sidebar model', () => {
  it('never turns filtered attachments into unrelated search results', () => {
    const other = {
      ...item,
      knowledgeItemId: 'unlinked',
      displayName: 'notes.pdf',
      originalName: 'notes.pdf'
    }
    expect(libraryEntries([reference], [item, other], 'unmatched', false, false)).toMatchObject({
      references: [],
      unlinked: [],
      unlinkedCount: 1
    })
    expect(libraryEntries([reference], [item, other], 'Lan', false, false).references).toHaveLength(
      1
    )
    expect(
      libraryEntries([reference], [item, other], '2020', false, false).references
    ).toHaveLength(1)
    expect(libraryEntries([reference], [item, other], 'notes', false, false).unlinked).toEqual([
      other
    ])
  })
  it('sorts and filters the complete library while retaining attachment order', () => {
    const failed = { ...item, knowledgeItemId: 'failed', parseState: 'failed' }
    const second = {
      ...reference,
      referenceId: 'second',
      title: 'Big Bird',
      createdAt: '2026-09-02',
      knowledgeItemIds: ['failed', item.knowledgeItemId]
    }
    const list = libraryEntries([reference, second], [item, failed], '', true, true)
    expect(list.attentionCount).toBe(1)
    expect(list.references[0].reference).toEqual(second)
    expect(list.references[0].attachments).toEqual([failed, item])
  })
  it('distinguishes readable from searchable and keeps prior content after failed updates', () => {
    expect(itemStatus(item, ready)).toBe('Searchable')
    expect(itemStatus(item, { readiness: 'available', indexed: false })).toBe(
      'Readable · Search preparing'
    )
    expect(itemStatus(item, undefined, true)).toBe('Readable · Search unavailable')
    expect(itemStatus({ ...item, parseState: 'failed' }, ready)).toBe('Searchable · Update failed')
    expect(canRetryItem({ ...item, parseState: 'failed' })).toBe(true)
    expect(canRetryItem({ ...item, state: 'failed' })).toBe(false)
    expect(itemStatus({ ...item, activeParseRevisionId: null, parseState: 'queued' }, ready)).toBe(
      'Waiting to parse'
    )
    expect(referenceStatus(reference, [], ready)).toBe('Citation only · No attachment')
    expect(referenceStatus(reference, [item, { ...item, parseState: 'failed' }], ready)).toContain(
      'Processing failed'
    )
  })
  it('does not treat citation-only references as problems unless metadata needs work', () => {
    expect(
      libraryEntries([{ ...reference, knowledgeItemIds: [] }], [], '', true, false).references
    ).toHaveLength(0)
    expect(
      libraryEntries([{ ...reference, metadataCompleteness: 'partial' }], [item], '', true, false)
        .references
    ).toHaveLength(1)
  })
  it('prioritizes terminal outcomes over residual progress and never marks cancellation successful', () => {
    expect(jobProgress(job)).toBe('Completed')
    expect(jobProgress({ ...job, state: 'cancelled' })).toBe('Cancelled')
    expect(jobProgress({ ...job, state: 'failed' })).toBe('Failed')
    expect(jobProgress({ ...job, state: 'running' })).toBe('50%')
    const html = renderToStaticMarkup(
      createElement(TaskRow, { job: { ...job, state: 'cancelled' } })
    )
    expect(html).toContain('lucide-ban')
    expect(html).not.toContain('50%')
  })
  it('removes recovered failures, but retains every active job', () => {
    const failed = { ...job, state: 'failed' as const }
    const succeeded = { ...job, jobId: 'new', createdAt: '2026-09-02' }
    expect(currentActivity([failed, succeeded], [item])).toEqual([])
    const running = { ...failed, state: 'running' as const }
    expect(currentActivity([running, succeeded], [item])).toEqual([running])
    expect(
      currentActivity(
        [
          {
            ...failed,
            type: 'mineru_parse',
            subject: { kind: 'file', knowledgeItemId: item.knowledgeItemId }
          }
        ],
        [item]
      )
    ).toEqual([])
  })
  it('reads all pages rather than silently limiting activity to the latest 100 jobs', async () => {
    const cursor = { updatedAt: job.updatedAt, jobId: job.jobId }
    const list = vi
      .fn()
      .mockResolvedValueOnce({ jobs: [job], nextCursor: cursor })
      .mockResolvedValueOnce({ jobs: [{ ...job, jobId: 'older' }], nextCursor: null })
    vi.stubGlobal('window', { desktop: { jobs: { list } } })
    try {
      expect(await loadJobs({ projectSessionId: 'session', limit: 100 })).toHaveLength(2)
      expect(list.mock.calls[1][0].cursor).toEqual(cursor)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
