import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ManuscriptSearchResult } from '../../../../shared/contracts/manuscript-search'
import { ManuscriptFindPanel } from './manuscript-find-panel'

const replacementProps = {
  replaceOpen: false,
  onReplaceOpenChange: vi.fn(),
  replacement: '',
  onReplacementChange: vi.fn(),
  replacementPlan: null,
  replacementCandidates: [],
  selectedCandidateIds: new Set<string>(),
  onCandidateChecked: vi.fn(),
  onReviewReplacements: vi.fn(),
  onLoadMoreReplacements: vi.fn(),
  onApplyReplacements: vi.fn(),
  onUndoReplacement: vi.fn(),
  canUndoReplacement: false,
  checkpointAvailable: false,
  createCheckpoint: false,
  onCreateCheckpointChange: vi.fn(),
  replacementLoading: false,
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

describe('ManuscriptFindPanel', () => {
  it('renders remote results with accessible status and exact marked context', () => {
    const html = renderToStaticMarkup(
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
    expect(html).toContain('Part I / Opening')
  })

  it('names incomplete recovery without presenting an exhaustive count', () => {
    const html = renderToStaticMarkup(
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
})
