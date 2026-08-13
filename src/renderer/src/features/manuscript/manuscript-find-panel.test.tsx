import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ManuscriptSearchResult } from '../../../../shared/contracts/manuscript-search'
import type {
  ManuscriptReplacementCandidate,
  ManuscriptReplacementPlanResult
} from '../../../../shared/contracts/manuscript-replacement'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ManuscriptFindPanel } from './manuscript-find-panel'

const replacementProps = {
  replaceOpen: false,
  onReplaceOpenChange: vi.fn(),
  replacement: '',
  onReplacementChange: vi.fn(),
  replacementPlan: null,
  replacementCandidates: [],
  selectedCandidateIds: new Set<string>(),
  onCandidatesChecked: vi.fn(),
  onReviewReplacements: vi.fn(),
  onLoadMoreReplacements: vi.fn(),
  onApplyReplacements: vi.fn(),
  onUndoReplacement: vi.fn(),
  canUndoReplacement: false,
  checkpointAvailable: false,
  createCheckpoint: false,
  onCreateCheckpointChange: vi.fn(),
  replacementLoading: false,
  replacementLoadingMore: false,
  replacementApplying: false,
  replacementMessage: null
}

const result: ManuscriptSearchResult = {
  snapshotFingerprint: 'a'.repeat(64),
  hits: [
    {
      matchId: 'b'.repeat(64),
      sourceSliceHash: 'c'.repeat(64),
      sectionTitle: 'Opening',
      sectionStatus: 'drafting',
      headingPath: ['Part I', 'Opening'],
      excerpt: 'An exact phrase appears here.',
      excerptMatch: { from: 3, to: 8 },
      target: {
        kind: 'block_inline',
        sectionId: 'section-1',
        revisionId: 'revision-1',
        blockId: 'block-1',
        segments: [{ inlineIndex: 0, range: { from: 3, to: 8 } }],
        flatRange: { from: 3, to: 8 }
      }
    }
  ],
  nextCursor: null,
  complete: true,
  incompleteReason: null,
  scannedSections: 1,
  scannedSurfaces: 2,
  scannedBytes: 100,
  slowPathSurfaces: 0,
  resultCount: 1
}

const replacementCandidates: ManuscriptReplacementCandidate[] = [
  {
    candidateId: '11111111-1111-4111-8111-111111111111',
    sectionId: 'section-1',
    sectionTitle: 'Opening',
    sectionStatus: 'drafting',
    headingPath: ['Part I', 'Opening'],
    targetKind: 'block_inline',
    beforePreview: 'Alpha evidence',
    afterPreview: 'Beta evidence',
    eligible: true,
    skipReason: null
  },
  {
    candidateId: '22222222-2222-4222-8222-222222222222',
    sectionId: 'section-1',
    sectionTitle: 'Opening',
    sectionStatus: 'drafting',
    headingPath: ['Part I', 'Opening'],
    targetKind: 'section_title',
    beforePreview: 'Alpha opening',
    afterPreview: 'Beta opening',
    eligible: false,
    skipReason: 'section_metadata'
  }
]

const replacementPlan: ManuscriptReplacementPlanResult = {
  status: 'ready',
  planId: '33333333-3333-4333-8333-333333333333',
  expiresAt: '2026-08-13T12:00:00.000Z',
  candidateCount: 2,
  eligibleCount: 1,
  skippedCount: 1,
  sectionCount: 1,
  candidates: replacementCandidates,
  nextCursor: null
}

function renderPanel(panel: React.ReactElement): string {
  return renderToStaticMarkup(<TooltipProvider>{panel}</TooltipProvider>)
}

describe('ManuscriptFindPanel', () => {
  it('renders remote results with accessible status and exact marked context', () => {
    const html = renderPanel(
      <ManuscriptFindPanel
        {...replacementProps}
        query='exact'
        onQueryChange={vi.fn()}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        scope='manuscript'
        onScopeChange={vi.fn()}
        statuses={[]}
        onStatusesChange={vi.fn()}
        result={result}
        loading={false}
        loadingMore={false}
        error={null}
        selectedMatchId={null}
        onActivate={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )
    expect(html).toContain('aria-label="Find in manuscript"')
    expect(html).toContain('1 results')
    expect(html).toContain('<mark')
    expect(html).toContain('Collapse Opening')
    expect(html).toContain('1 loaded matches')
  })

  it('names incomplete recovery without presenting an exhaustive count', () => {
    const html = renderPanel(
      <ManuscriptFindPanel
        {...replacementProps}
        query='exact'
        onQueryChange={vi.fn()}
        caseSensitive
        onCaseSensitiveChange={vi.fn()}
        scope='section'
        onScopeChange={vi.fn()}
        statuses={['drafting']}
        onStatusesChange={vi.fn()}
        result={{ ...result, complete: false, incompleteReason: 'scan_budget' }}
        loading={false}
        loadingMore={false}
        error={null}
        selectedMatchId={result.hits[0]?.matchId ?? null}
        onActivate={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )
    expect(html).toContain('results so far')
    expect(html).toContain('Narrow the scope')
  })

  it('groups loaded pages by stable section and names partial loading honestly', () => {
    const openingHit = result.hits[0]
    if (openingHit === undefined) throw new Error('Expected the opening fixture hit')
    const secondOpeningHit: ManuscriptSearchResult['hits'][number] = {
      ...openingHit,
      matchId: 'd'.repeat(64),
      sourceSliceHash: 'e'.repeat(64),
      excerpt: 'Another exact phrase in the opening.',
      excerptMatch: { from: 8, to: 13 }
    }
    const conclusionHit: ManuscriptSearchResult['hits'][number] = {
      ...openingHit,
      matchId: 'f'.repeat(64),
      sourceSliceHash: '1'.repeat(64),
      sectionTitle: 'Conclusion',
      headingPath: ['Part II', 'Conclusion'],
      target: {
        kind: 'block_inline',
        sectionId: 'section-2',
        revisionId: 'revision-2',
        blockId: 'block-2',
        segments: [{ inlineIndex: 0, range: { from: 3, to: 8 } }],
        flatRange: { from: 3, to: 8 }
      }
    }
    const html = renderPanel(
      <ManuscriptFindPanel
        {...replacementProps}
        query='exact'
        onQueryChange={vi.fn()}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        scope='manuscript'
        onScopeChange={vi.fn()}
        statuses={[]}
        onStatusesChange={vi.fn()}
        result={{
          ...result,
          hits: [openingHit, secondOpeningHit, conclusionHit],
          resultCount: 7,
          nextCursor: 'next-page'
        }}
        loading={false}
        loadingMore={false}
        error={null}
        selectedMatchId={null}
        onActivate={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )

    expect(html).toContain('3 of 7 results loaded')
    expect(html).toContain('Collapse Opening')
    expect(html).toContain('2 loaded matches')
    expect(html).toContain('Collapse Conclusion')
    expect(html).toContain('Load more')
  })

  it('renders the compact replace row and grouped selection review', () => {
    const html = renderPanel(
      <ManuscriptFindPanel
        {...replacementProps}
        replaceOpen
        replacement='Beta'
        replacementPlan={replacementPlan}
        replacementCandidates={replacementCandidates}
        selectedCandidateIds={new Set([replacementCandidates[0]?.candidateId ?? ''])}
        query='Alpha'
        onQueryChange={vi.fn()}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        scope='manuscript'
        onScopeChange={vi.fn()}
        statuses={[]}
        onStatusesChange={vi.fn()}
        result={result}
        loading={false}
        loadingMore={false}
        error={null}
        selectedMatchId={null}
        onActivate={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )

    expect(html).toContain('aria-label="Hide replace"')
    expect(html).toContain('aria-label="Replace with"')
    expect(html).toContain('aria-label="Review replacements"')
    expect(html).toContain('Select all')
    expect(html).toContain('Select loaded replacements in Opening')
    expect(html).toContain('Before: Alpha evidence')
    expect(html).toContain('After: Beta evidence')
    expect(html).toContain('Skipped (1)')
    expect(html).toContain('Apply 1 replacement in 1 section')
  })

  it('disables replacement pagination while the next page is loading', () => {
    const html = renderPanel(
      <ManuscriptFindPanel
        {...replacementProps}
        replaceOpen
        replacementLoadingMore
        replacementPlan={{ ...replacementPlan, nextCursor: 'next-page' }}
        replacementCandidates={replacementCandidates}
        query='Alpha'
        onQueryChange={vi.fn()}
        caseSensitive={false}
        onCaseSensitiveChange={vi.fn()}
        scope='manuscript'
        onScopeChange={vi.fn()}
        statuses={[]}
        onStatusesChange={vi.fn()}
        result={result}
        loading={false}
        loadingMore={false}
        error={null}
        selectedMatchId={null}
        onActivate={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('Loading…')
    expect(html).not.toContain('Load more candidates')
  })
})
