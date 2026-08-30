import {
  AGENT_MUTATION_PREVIEW_TEXT_LIMIT,
  mutationPreviewSchema,
  type BriefUpdate,
  type MutationCitedSource,
  type MutationPreview,
  type ProposalPresentation,
  type ProposalPresentationText
} from '../../shared/contracts/agent-mutations'
import type { BlockNoteDocument, BlockNoteTableContent } from '../../shared/contracts/manuscript'
import { summarizeTableChange } from '../../shared/manuscript-table'
import type { WritingRulesState } from '../../shared/contracts/writing-rules'
import type { briefFieldsFromRow } from './mutation-storage'

export function formatWritingRulesPreview(state: WritingRulesState): string {
  if (state.rules.length === 0) return 'No Writing Rules'
  return state.rules
    .map((rule) => {
      const details = [
        rule.preferredForm === null ? null : `prefer “${rule.preferredForm}”`,
        rule.discouragedForms.length === 0
          ? null
          : `avoid ${rule.discouragedForms.map((value) => `“${value}”`).join(', ')}`
      ].filter((value): value is string => value !== null)
      return `${rule.active ? 'Active' : 'Inactive'} · ${rule.category}\n${rule.instruction}${
        details.length === 0 ? '' : `\n${details.join(' · ')}`
      }`
    })
    .join('\n\n')
}

export function createPreview(input: {
  summary: string
  affectedSectionIds: string[]
  beforeText: string
  afterText: string
  citedSources: MutationCitedSource[]
  presentation?: ProposalPresentation
}): MutationPreview {
  const before = truncateUtf8(input.beforeText, AGENT_MUTATION_PREVIEW_TEXT_LIMIT)
  const after = truncateUtf8(input.afterText, AGENT_MUTATION_PREVIEW_TEXT_LIMIT)
  return mutationPreviewSchema.parse({
    summary: input.summary,
    affectedSectionIds: [...new Set(input.affectedSectionIds)],
    beforeText: before.text,
    afterText: after.text,
    beforeTextTruncated: before.truncated,
    afterTextTruncated: after.truncated,
    citedSources: input.citedSources,
    presentation: input.presentation
  })
}

export function createTableDiffPresentation(
  beforeDocument: BlockNoteDocument,
  afterDocument: BlockNoteDocument,
  affectedBlockIds: readonly string[]
): ProposalPresentation | undefined {
  const beforeTables = indexTableBlocks(beforeDocument)
  const afterTables = indexTableBlocks(afterDocument)
  const affected = new Set(affectedBlockIds)
  const ids = [...new Set([...beforeTables.keys(), ...afterTables.keys()])].filter(
    (id) => affected.has(id) && (beforeTables.has(id) || afterTables.has(id))
  )
  const tables = ids.flatMap((blockId) => {
    const before = beforeTables.get(blockId)
    const after = afterTables.get(blockId)
    if (before === undefined && after === undefined) return []
    const summary = summarizeTableChange(before?.content ?? null, after?.content ?? null, 101)
    const allChanged = summary.changedCells.map((cell) => ({
      row: cell.row,
      column: cell.column,
      before: boundedPresentationText(cell.before),
      after: boundedPresentationText(cell.after)
    }))
    return [
      {
        blockId,
        beforeRows: summary.beforeRows,
        beforeColumns: summary.beforeColumns,
        afterRows: summary.afterRows,
        afterColumns: summary.afterColumns,
        structuralChanges: summary.structuralChanges,
        changedCells: allChanged.slice(0, 100),
        truncated:
          summary.truncated ||
          allChanged.length > 100 ||
          allChanged.some((cell) => cell.before.truncated || cell.after.truncated)
      }
    ]
  })
  return tables.length === 0 ? undefined : { schemaVersion: 1, kind: 'table_diff', tables }
}

export function indexTableBlocks(document: BlockNoteDocument) {
  const result = new Map<string, { id: string; content: BlockNoteTableContent }>()
  const visit = (blocks: BlockNoteDocument): void => {
    for (const block of blocks) {
      if (block.type === 'table')
        result.set(block.id, { id: block.id, content: block.content as BlockNoteTableContent })
      if (block.children.length > 0) visit(block.children)
    }
  }
  visit(document)
  return result
}

export function boundedPresentationText(value: string | null): ProposalPresentationText {
  if (value === null) return { text: null, truncated: false }
  const maximum = 512
  return { text: value.slice(0, maximum), truncated: value.length > maximum }
}

export function truncateUtf8(
  value: string,
  maximumBytes: number
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= maximumBytes) return { text: value, truncated: false }
  return { text: bytes.subarray(0, maximumBytes).toString('utf8'), truncated: true }
}

export const BRIEF_PRESENTATION_FIELDS = [
  'title',
  'description',
  'topic',
  'targetAudience',
  'language',
  'styleTone',
  'scopeExclusions',
  'targetLength',
  'citationRequirements',
  'additionalInstructions'
] as const

export function presentationText(value: string | null): ProposalPresentationText {
  if (value === null) return { text: null, truncated: false }
  const projected = truncateUtf8(value, 4_096)
  return { text: projected.text, truncated: projected.truncated }
}

export function createBriefPresentation(
  mutation: BriefUpdate,
  before: ReturnType<typeof briefFieldsFromRow>,
  after: ReturnType<typeof briefFieldsFromRow>
): ProposalPresentation | undefined {
  const fields = BRIEF_PRESENTATION_FIELDS.flatMap((field) =>
    Object.hasOwn(mutation.changes, field)
      ? [
          {
            field,
            before: presentationText(before[field]),
            after: presentationText(after[field])
          }
        ]
      : []
  )
  if (fields.length === 0) return undefined
  return { schemaVersion: 1, kind: 'brief_fields', fields }
}

export function createWritingRulesPresentation(
  before: WritingRulesState,
  after: WritingRulesState
): ProposalPresentation {
  const beforeById = new Map(before.rules.map((rule) => [rule.ruleId, rule]))
  const afterById = new Map(after.rules.map((rule) => [rule.ruleId, rule]))
  const changes: Extract<ProposalPresentation, { kind: 'writing_rules' }>['changes'] = []
  for (const rule of after.rules) {
    const previous = beforeById.get(rule.ruleId)
    if (previous === undefined) {
      changes.push({ action: 'add', ruleId: rule.ruleId, before: null, after: rule })
      continue
    }
    if (JSON.stringify(previous) === JSON.stringify(rule)) continue
    const activeOnly =
      previous.active !== rule.active &&
      JSON.stringify({ ...previous, active: rule.active }) === JSON.stringify(rule)
    changes.push({
      action: activeOnly ? (rule.active ? 'enable' : 'disable') : 'update',
      ruleId: rule.ruleId,
      before: previous,
      after: rule
    })
  }
  for (const rule of before.rules) {
    if (!afterById.has(rule.ruleId)) {
      changes.push({ action: 'remove', ruleId: rule.ruleId, before: rule, after: null })
    }
  }
  return { schemaVersion: 1, kind: 'writing_rules', changes }
}
