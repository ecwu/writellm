import { createHash } from 'node:crypto'
import type { Logger } from 'pino'
import type { CheckDraftArgs, CheckDraftResult } from '../../shared/contracts/agent-tools'
import { checkDraftResultSchema } from '../../shared/contracts/agent-tools'
import { readWritingRules } from '../../shared/contracts/writing-rules'
import { findProjectionMatches } from '../../shared/manuscript-search'
import { findReadableCitations, normalizeCitationTitle } from '../../shared/readable-citation'
import { findCitationClusters } from '../../shared/citation-cluster'
import { extractSectionAgentText } from '../manuscript/content'
import type { WritingSnapshot } from './context'
import { AgentToolDomainError } from './read-tools'

const ALL_CHECKS: CheckDraftArgs['checks'] = [
  'document_structure',
  'outline_integrity',
  'revision_lineage',
  'citation_provenance',
  'safe_links',
  'unresolved_placeholders',
  'duplicate_headings',
  'duplicate_paragraphs',
  'length_constraints',
  'empty_sections',
  'section_objectives',
  'unresolved_citations',
  'references_availability',
  'unused_resources',
  'writing_rules',
  'figure_metadata'
]

type Finding = CheckDraftResult['findings'][number]
type CheckName = Finding['check']

export function runDraftChecks(
  args: CheckDraftArgs,
  snapshot: WritingSnapshot,
  signal: AbortSignal,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
): CheckDraftResult {
  const startedAt = Date.now()
  try {
    const result = executeDraftChecks(args, snapshot, signal, log)
    log?.info(
      {
        event: 'agent.draft_check.completed',
        snapshotId: snapshot.snapshotId,
        scopeType: args.scope.type,
        requestedCheckCount: args.checks.length === 0 ? ALL_CHECKS.length : args.checks.length,
        findingCount: result.findings.length,
        skippedCheckCount: result.summary.skippedChecks.length,
        unavailableCheckCount: result.summary.unavailableChecks.length,
        truncated: result.summary.truncated,
        durationMs: Date.now() - startedAt
      },
      'Agent draft checks completed'
    )
    return result
  } catch (err) {
    log?.error(
      {
        event: 'agent.draft_check.failed',
        err,
        snapshotId: snapshot.snapshotId,
        scopeType: args.scope.type,
        durationMs: Date.now() - startedAt
      },
      'Agent draft checks failed'
    )
    throw err
  }
}

function executeDraftChecks(
  args: CheckDraftArgs,
  snapshot: WritingSnapshot,
  signal: AbortSignal,
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
): CheckDraftResult {
  const requested = args.checks.length === 0 ? ALL_CHECKS : args.checks
  const entries = snapshot.workspace.sections.filter(
    (entry) => args.scope.type === 'manuscript' || entry.section.sectionId === args.scope.sectionId
  )
  if (args.scope.type === 'section' && entries.length === 0) {
    throw new AgentToolDomainError('not_found', 'Section does not exist in the writing snapshot')
  }
  const findings: Finding[] = []
  const unavailable = new Map<CheckName, string>()
  const skipped = new Map<CheckName, string>()
  let truncated = false
  const add = (input: Omit<Finding, 'findingId'>): void => {
    if (findings.length >= 200) {
      if (!truncated) {
        log?.warn(
          {
            event: 'agent.draft_check.truncated',
            snapshotId: snapshot.snapshotId,
            scopeType: args.scope.type,
            findingCount: findings.length
          },
          'Agent draft check findings reached the safety cap'
        )
      }
      truncated = true
      return
    }
    findings.push({
      ...input,
      findingId: createHash('sha256')
        .update(
          JSON.stringify({
            snapshotId: snapshot.snapshotId,
            check: input.check,
            sectionId: input.sectionId,
            revisionId: input.revisionId,
            blockIds: input.blockIds,
            evidence: input.evidence
          })
        )
        .digest('hex')
    })
  }
  const checkAbort = (): void => {
    if (signal.aborted) throw new AgentToolDomainError('aborted', 'Draft check was aborted', true)
  }

  if (requested.includes('outline_integrity')) checkOutline(snapshot, add)
  const seenHeadings = new Map<string, { sectionId: string; revisionId: string; blockId: string }>()
  const seenParagraphs = new Map<
    string,
    { sectionId: string; revisionId: string; blockId: string }
  >()
  const rules = readWritingRules(snapshot.workspace.brief.extensible).rules.filter(
    (rule) => rule.active
  )
  const citedResourceTitles = new Set<string>()
  const citedReferenceKeys = new Set<string>()
  for (const entry of entries) {
    checkAbort()
    const section = entry.section
    const revision = entry.revision
    const content = snapshot.sectionContents.get(revision.sectionRevisionId)
    if (content === undefined) {
      if (requested.includes('document_structure')) {
        add({
          priority: 'P0',
          category: 'integrity',
          check: 'document_structure',
          sectionId: section.sectionId,
          revisionId: revision.sectionRevisionId,
          title: 'Section content is unavailable',
          description: 'The immutable run snapshot does not contain this section revision.',
          evidence: revision.sectionRevisionId
        })
      }
      continue
    }
    if (
      requested.includes('revision_lineage') &&
      (revision.sectionId !== section.sectionId ||
        section.currentRevisionId !== revision.sectionRevisionId)
    ) {
      add({
        priority: 'P0',
        category: 'integrity',
        check: 'revision_lineage',
        sectionId: section.sectionId,
        revisionId: revision.sectionRevisionId,
        title: 'Section revision lineage is inconsistent',
        description: 'The snapshot section and its captured revision do not agree.',
        evidence: `${section.currentRevisionId}:${revision.sectionRevisionId}`
      })
    }
    const blocks = flatten(content)
    const ids = new Set<string>()
    if (requested.includes('empty_sections') && blocks.every((block) => block.text.trim() === '')) {
      add({
        priority: section.status === 'completed' ? 'P1' : 'P2',
        category: 'structure',
        check: 'empty_sections',
        sectionId: section.sectionId,
        revisionId: revision.sectionRevisionId,
        title: 'Section has no substantive content',
        description:
          section.status === 'completed'
            ? 'A completed section is empty.'
            : 'The section currently contains no substantive text.',
        evidence: section.title
      })
    }
    if (requested.includes('section_objectives') && !section.objective?.trim()) {
      add({
        priority: 'P2',
        category: 'objective',
        check: 'section_objectives',
        sectionId: section.sectionId,
        revisionId: revision.sectionRevisionId,
        title: 'Section objective is missing',
        description:
          'Without an objective, objective coverage cannot be checked deterministically.',
        evidence: section.title
      })
    }
    for (const block of blocks) {
      checkAbort()
      if (requested.includes('document_structure') && ids.has(block.id)) {
        add(
          location(entry, block.id, {
            priority: 'P0',
            category: 'integrity',
            check: 'document_structure',
            title: 'Duplicate block ID',
            description: 'Two blocks in the same revision share an identity.',
            evidence: block.id
          })
        )
      }
      ids.add(block.id)
      const normalized = block.text.normalize('NFC').trim().toLowerCase()
      for (const citation of findReadableCitations(block.text)) {
        citedResourceTitles.add(normalizeCitationTitle(citation.title))
      }
      for (const cluster of findCitationClusters(block.text)) {
        for (const citation of cluster.items) citedReferenceKeys.add(citation.citationKey)
      }
      if (requested.includes('safe_links')) checkLinks(entry, block.value, add)
      if (requested.includes('figure_metadata') && block.type === 'image') {
        const value = block.value as { props?: unknown }
        const props =
          value.props !== null && typeof value.props === 'object'
            ? (value.props as Record<string, unknown>)
            : {}
        const figureId = typeof props.figureId === 'string' ? props.figureId : block.id
        if (typeof props.caption !== 'string' || props.caption.trim() === '') {
          add(
            location(entry, block.id, {
              priority: 'P2',
              category: 'structure',
              check: 'figure_metadata',
              title: 'Figure caption is missing',
              description: 'The figure has no reader-visible caption.',
              evidence: figureId
            })
          )
        }
        if (typeof props.altText !== 'string' || props.altText.trim() === '') {
          add(
            location(entry, block.id, {
              priority: 'P1',
              category: 'audience',
              check: 'figure_metadata',
              title: 'Figure alt text is missing',
              description: 'The figure has no explicit accessibility description.',
              evidence: figureId
            })
          )
        }
      }
      if (
        requested.includes('unresolved_placeholders') &&
        /\[(?:todo|tbd)\]|\bxxx\b|(?:待补充|待完善|占位符)/iu.test(block.text)
      ) {
        add(
          location(entry, block.id, {
            priority: 'P2',
            category: 'consistency',
            check: 'unresolved_placeholders',
            title: 'Unresolved placeholder',
            description: 'Placeholder text remains in the draft.',
            evidence: block.text.slice(0, 500)
          })
        )
      }
      if (requested.includes('unresolved_citations')) checkUnresolvedCitations(entry, block, add)
      if (requested.includes('duplicate_headings') && block.type === 'heading' && normalized) {
        const previous = seenHeadings.get(normalized)
        if (previous !== undefined) {
          add(
            location(entry, block.id, {
              priority: 'P2',
              category: 'structure',
              check: 'duplicate_headings',
              title: 'Duplicate heading',
              description: 'The same normalized heading occurs more than once.',
              evidence: `${block.text.slice(0, 500)}; first at ${previous.sectionId}/${previous.blockId}`
            })
          )
        } else seenHeadings.set(normalized, locationIdentity(entry, block.id))
      }
      if (
        requested.includes('duplicate_paragraphs') &&
        block.type === 'paragraph' &&
        normalized.length >= 80
      ) {
        const previous = seenParagraphs.get(normalized)
        if (previous !== undefined) {
          add(
            location(entry, block.id, {
              priority: 'P2',
              category: 'consistency',
              check: 'duplicate_paragraphs',
              title: 'Exact duplicate paragraph',
              description: 'A substantive paragraph is repeated exactly after normalization.',
              evidence: `${block.text.slice(0, 500)}; first at ${previous.sectionId}/${previous.blockId}`
            })
          )
        } else seenParagraphs.set(normalized, locationIdentity(entry, block.id))
      }
      if (requested.includes('writing_rules')) checkWritingRules(entry, block, rules, add)
    }
  }

  if (requested.includes('length_constraints')) {
    const range = parseLengthConstraint(snapshot.workspace.brief.targetLength)
    if (range === null) {
      skipped.set(
        'length_constraints',
        'The Brief does not contain a deterministic numeric length target.'
      )
    } else if (
      snapshot.workspace.wordCount < range.minimum ||
      snapshot.workspace.wordCount > range.maximum
    ) {
      add({
        priority: 'P2',
        category: 'structure',
        check: 'length_constraints',
        title: 'Manuscript length is outside its target',
        description: 'The snapshot word count is outside the explicit Brief range.',
        evidence: `${snapshot.workspace.wordCount} words; target ${range.minimum}-${range.maximum}`
      })
    }
  }
  if (requested.includes('citation_provenance')) {
    unavailable.set(
      'citation_provenance',
      'Citation provenance requires the current Agent run evidence ledger and is completed by the Agent tool boundary.'
    )
  }
  if (requested.includes('references_availability')) {
    if (snapshot.reviewResources === null) {
      unavailable.set(
        'references_availability',
        'The immutable writing snapshot does not contain the project knowledge inventory.'
      )
    } else {
      const registered = new Map(
        (snapshot.reviewResources.references ?? []).map((reference) => [
          reference.citationKey,
          reference
        ])
      )
      for (const citationKey of citedReferenceKeys) {
        const reference = registered.get(citationKey)
        if (reference?.evidenceAvailable === true) continue
        add({
          priority: 'P1',
          category: 'citation',
          check: 'references_availability',
          title:
            reference === undefined
              ? 'Citation key is not registered'
              : 'Citation has no available evidence',
          description:
            reference === undefined
              ? 'The manuscript citekey is absent from the project Reference registry.'
              : 'Metadata-only references cannot be used as Agent evidence.',
          evidence: `@${citationKey}`
        })
      }
      const available = new Set(
        snapshot.reviewResources.knowledgeItems
          .filter((item) => item.state === 'stored')
          .map((item) => normalizeCitationTitle(item.displayName))
      )
      for (const title of citedResourceTitles) {
        if (available.has(title)) continue
        add({
          priority: 'P1',
          category: 'citation',
          check: 'references_availability',
          title: 'Referenced source is unavailable',
          description:
            'A readable citation does not match an available project knowledge resource.',
          evidence: title
        })
      }
    }
  }
  if (requested.includes('unused_resources')) {
    if (snapshot.reviewResources === null) {
      unavailable.set(
        'unused_resources',
        'The immutable writing snapshot lacks resource inventories.'
      )
    } else {
      for (const asset of snapshot.reviewResources.manuscriptAssets) {
        if (asset.referencedByCurrentRevision) continue
        add({
          priority: 'P3',
          category: 'other',
          check: 'unused_resources',
          title: 'Manuscript asset is unused',
          description: 'This project asset is not referenced by any captured current revision.',
          evidence: asset.assetId
        })
      }
      for (const item of snapshot.reviewResources.knowledgeItems) {
        if (
          item.state !== 'stored' ||
          citedResourceTitles.has(normalizeCitationTitle(item.displayName))
        )
          continue
        add({
          priority: 'P3',
          category: 'evidence',
          check: 'unused_resources',
          title: 'Knowledge resource is unused',
          description: 'This available project source is not cited by the captured manuscript.',
          evidence: item.displayName
        })
      }
    }
  }

  const checkOutcomes = requested.map((check) => {
    const unavailableReason = unavailable.get(check)
    if (unavailableReason !== undefined)
      return { check, status: 'unavailable' as const, reason: unavailableReason }
    const skippedReason = skipped.get(check)
    if (skippedReason !== undefined)
      return { check, status: 'skipped' as const, reason: skippedReason }
    return {
      check,
      status: findings.some((finding) => finding.check === check)
        ? ('failed' as const)
        : ('passed' as const),
      reason: null
    }
  })
  return checkDraftResultSchema.parse({
    snapshotId: snapshot.snapshotId,
    findings,
    summary: {
      priorities: {
        P0: findings.filter((finding) => finding.priority === 'P0').length,
        P1: findings.filter((finding) => finding.priority === 'P1').length,
        P2: findings.filter((finding) => finding.priority === 'P2').length,
        P3: findings.filter((finding) => finding.priority === 'P3').length
      },
      passedChecks: checkOutcomes
        .filter((item) => item.status === 'passed')
        .map((item) => item.check),
      skippedChecks: checkOutcomes
        .filter((item) => item.status === 'skipped')
        .map((item) => item.check),
      unavailableChecks: checkOutcomes
        .filter((item) => item.status === 'unavailable')
        .map((item) => item.check),
      checkOutcomes,
      truncated
    }
  })
}

function checkOutline(
  snapshot: WritingSnapshot,
  add: (finding: Omit<Finding, 'findingId'>) => void
): void {
  const byId = new Map(
    snapshot.workspace.sections.map((entry) => [entry.section.sectionId, entry.section])
  )
  const positions = new Map<string, Set<number>>()
  for (const entry of snapshot.workspace.sections) {
    const section = entry.section
    const parent = section.parentSectionId === null ? undefined : byId.get(section.parentSectionId)
    if (
      (section.parentSectionId !== null && parent === undefined) ||
      section.level !== (parent?.level ?? 0) + 1
    ) {
      add(
        location(entry, `section:${section.sectionId}`, {
          priority: 'P0',
          category: 'integrity',
          check: 'outline_integrity',
          title: 'Outline hierarchy is inconsistent',
          description: 'The section parent or level is invalid in the captured outline.',
          evidence: `${section.parentSectionId ?? 'root'}:${section.level}`
        })
      )
    }
    const key = section.parentSectionId ?? 'root'
    const siblingPositions = positions.get(key) ?? new Set<number>()
    if (siblingPositions.has(section.position)) {
      add(
        location(entry, `section:${section.sectionId}`, {
          priority: 'P0',
          category: 'integrity',
          check: 'outline_integrity',
          title: 'Outline positions collide',
          description: 'Two siblings have the same position.',
          evidence: String(section.position)
        })
      )
    }
    siblingPositions.add(section.position)
    positions.set(key, siblingPositions)
  }
}

function checkLinks(
  entry: SnapshotEntry,
  value: unknown,
  add: (finding: Omit<Finding, 'findingId'>) => void
): void {
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object') return
    if (
      'type' in candidate &&
      candidate.type === 'link' &&
      'href' in candidate &&
      typeof candidate.href === 'string'
    ) {
      try {
        const protocol = new URL(candidate.href).protocol
        if (!['http:', 'https:', 'mailto:'].includes(protocol)) throw new Error('Unsafe scheme')
      } catch {
        add(
          location(entry, blockIdOf(value), {
            priority: 'P0',
            category: 'integrity',
            check: 'safe_links',
            title: 'Unsafe or invalid link',
            description: 'A link uses a disallowed or invalid URL.',
            evidence: candidate.href.slice(0, 500)
          })
        )
      }
    }
    for (const child of Object.values(candidate)) {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child !== null && typeof child === 'object') visit(child)
    }
  }
  visit(value)
}

function checkUnresolvedCitations(
  entry: SnapshotEntry,
  block: FlatBlock,
  add: (finding: Omit<Finding, 'findingId'>) => void
): void {
  if (/citation-[a-f0-9]{40}/u.test(block.text)) {
    add(
      location(entry, block.id, {
        priority: 'P1',
        category: 'citation',
        check: 'unresolved_citations',
        title: 'Internal citation identifier is exposed',
        description: 'An internal evidence identifier appears in manuscript prose.',
        evidence: block.text.slice(0, 500)
      })
    )
  }
  const valid = findReadableCitations(block.text).map((citation) => citation.raw)
  if (/\[(?:Source|来源)\s*:/iu.test(block.text) && valid.length === 0) {
    add(
      location(entry, block.id, {
        priority: 'P2',
        category: 'citation',
        check: 'unresolved_citations',
        title: 'Malformed readable citation',
        description: 'Citation-like text does not match the supported readable citation syntax.',
        evidence: block.text.slice(0, 500)
      })
    )
  }
}

function checkWritingRules(
  entry: SnapshotEntry,
  block: FlatBlock,
  rules: ReturnType<typeof readWritingRules>['rules'],
  add: (finding: Omit<Finding, 'findingId'>) => void
): void {
  for (const rule of rules) {
    if (rule.preferredForm === null || rule.discouragedForms.length === 0) continue
    for (const discouraged of rule.discouragedForms) {
      const matches = isWordLike(discouraged)
        ? wordMatches(block.text, discouraged)
        : findProjectionMatches(block.text, discouraged, false).matches
      if (matches.length === 0) continue
      add(
        location(entry, block.id, {
          priority: 'P2',
          category: rule.category === 'translation' ? 'translation' : 'terminology',
          check: 'writing_rules',
          title: 'Writing Rule terminology mismatch',
          description: `Use “${rule.preferredForm}” instead of the discouraged form “${discouraged}”.`,
          evidence: block.text.slice(Math.max(0, matches[0].from - 100), matches[0].to + 200)
        })
      )
    }
  }
}

const wordSegmenter = new Intl.Segmenter('und', { granularity: 'word' })
function isWordLike(value: string): boolean {
  return (
    /^[\p{L}\p{N}_-]+$/u.test(value) &&
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value)
  )
}
function wordMatches(source: string, query: string): Array<{ from: number; to: number }> {
  const expected = query.normalize('NFC').toLowerCase()
  return [...wordSegmenter.segment(source)].flatMap((segment) =>
    segment.isWordLike && segment.segment.normalize('NFC').toLowerCase() === expected
      ? [{ from: segment.index, to: segment.index + segment.segment.length }]
      : []
  )
}

type SnapshotEntry = WritingSnapshot['workspace']['sections'][number]
interface FlatBlock {
  id: string
  type: string
  text: string
  value: unknown
}
function flatten(content: readonly unknown[]): FlatBlock[] {
  const result: FlatBlock[] = []
  const visit = (blocks: readonly unknown[]): void => {
    for (const value of blocks) {
      if (value === null || typeof value !== 'object') continue
      const block = value as { id?: unknown; type?: unknown; children?: unknown }
      if (typeof block.id !== 'string' || typeof block.type !== 'string') continue
      result.push({
        id: block.id,
        type: block.type,
        text: extractSectionAgentText([{ ...block, children: [] }]),
        value
      })
      if (Array.isArray(block.children)) visit(block.children)
    }
  }
  visit(content)
  return result
}

function blockIdOf(value: unknown): string {
  return value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string'
    ? value.id
    : 'unknown'
}

function locationIdentity(entry: SnapshotEntry, blockId: string) {
  return {
    sectionId: entry.section.sectionId,
    revisionId: entry.revision.sectionRevisionId,
    blockId
  }
}
function location(
  entry: SnapshotEntry,
  blockId: string,
  finding: Omit<Finding, 'findingId' | 'sectionId' | 'revisionId' | 'blockIds'>
): Omit<Finding, 'findingId'> {
  return {
    ...finding,
    sectionId: entry.section.sectionId,
    revisionId: entry.revision.sectionRevisionId,
    blockIds: [blockId]
  }
}

function parseLengthConstraint(value: string): { minimum: number; maximum: number } | null {
  const normalized = value.replaceAll(',', '')
  const range = normalized.match(/(\d+)\s*(?:-|–|—|to|至)\s*(\d+)/iu)
  if (range !== null) {
    const first = Number(range[1])
    const second = Number(range[2])
    return { minimum: Math.min(first, second), maximum: Math.max(first, second) }
  }
  const exact = normalized.match(/(?:exactly|约|大约)?\s*(\d+)\s*(?:words?|字)/iu)
  if (exact === null) return null
  const target = Number(exact[1])
  return { minimum: target, maximum: target }
}
