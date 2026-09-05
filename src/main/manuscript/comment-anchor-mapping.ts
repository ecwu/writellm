import type Database from 'better-sqlite3'
import { blockNoteInlinePlainText } from '../../shared/blocknote-inline-text'
import {
  commentAnchorSegmentSchema,
  type CommentAnchorSegment
} from '../../shared/contracts/manuscript-comments'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { decodeStoredSectionContent } from './content'

/**
 * The editor stores positions as JavaScript string offsets.  Keep the mapper in
 * UTF-16 code units as well, rather than converting to code points and risking
 * an off-by-one around emoji or combining characters.
 */
const MAX_DIFF_CELLS = 4_000_000
const MAX_BLOCK_WINDOW = 32

export interface CommentAnchorUpdateResult {
  sectionId: string
  scanned: number
  updated: number
  attached: number
  orphaned: number
  restored: number
  historyRows: number
}

interface SectionRevisionRow {
  section_revision_id: string
  section_id: string
  content_json: string
  content_schema_version: number
  content_hash: string
  content_body_retained: number
}

interface CommentThreadRow {
  thread_id: string
  section_id: string
  version: number
  anchor_status: 'attached' | 'orphaned'
  quote: string
  anchor_json: string
  created_revision_id: string
  current_revision_id: string
  anchor_revision_id: string | null
  deleted_at: string | null
}

interface AnchorHistoryRow {
  revision_id: string
  content_hash: string
  anchor_json: string
  anchor_status: 'attached' | 'orphaned'
}

interface BlockSnapshot {
  id: string
  text: string
  order: number
}

interface BlockTarget {
  blockId: string
  oldFrom: number
  oldTo: number
  newFrom: number
  newTo: number
}

interface BlockRelation {
  targets: BlockTarget[]
  exact: boolean
}

interface DiffChunk {
  type: 'equal' | 'delete' | 'insert' | 'unknown'
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

type RawDiff = { type: DiffChunk['type']; oldLength: number; newLength: number }

type NativeDatabase = Database.Database

/**
 * Reconcile all live comment anchors for one section after its current
 * revision changes. The caller must invoke this from the same transaction that
 * updates sections.current_revision_id. This makes the section revision and
 * the persisted anchor transition one atomic state change.
 */
export function updateCommentAnchors(
  database: NativeDatabase,
  sectionId: string,
  options: { now?: string } = {}
): CommentAnchorUpdateResult {
  const now = options.now ?? new Date().toISOString()
  const current = database
    .prepare(
      `SELECT r.section_revision_id, r.section_id, r.content_json,
              r.content_schema_version, r.content_hash, r.content_body_retained
       FROM sections s
       JOIN section_revisions r ON r.section_revision_id = s.current_revision_id
       WHERE s.section_id = ? AND s.deleted_at IS NULL`
    )
    .get(sectionId) as SectionRevisionRow | undefined

  if (current === undefined) {
    return {
      sectionId,
      scanned: 0,
      updated: 0,
      attached: 0,
      orphaned: 0,
      restored: 0,
      historyRows: 0
    }
  }

  const currentDocument = retainedDocument(current)
  const rows = database
    .prepare(
      `SELECT thread_id, section_id, version, anchor_status, quote, anchor_json,
              created_revision_id, current_revision_id, anchor_revision_id, deleted_at
       FROM manuscript_comment_threads
       WHERE section_id = ? AND deleted_at IS NULL
       ORDER BY created_at, thread_id`
    )
    .all(sectionId) as CommentThreadRow[]

  const result: CommentAnchorUpdateResult = {
    sectionId,
    scanned: rows.length,
    updated: 0,
    attached: 0,
    orphaned: 0,
    restored: 0,
    historyRows: 0
  }

  for (const row of rows) {
    const sourceRevisionId = row.anchor_revision_id ?? row.created_revision_id
    const source = database
      .prepare(
        `SELECT section_revision_id, section_id, content_json,
                content_schema_version, content_hash, content_body_retained
         FROM section_revisions WHERE section_revision_id = ?`
      )
      .get(sourceRevisionId) as SectionRevisionRow | undefined

    const sourceHistory = database
      .prepare(
        `SELECT revision_id, content_hash, anchor_json, anchor_status
         FROM manuscript_comment_anchor_history
         WHERE thread_id = ? AND revision_id = ?`
      )
      .get(row.thread_id, sourceRevisionId) as AnchorHistoryRow | undefined

    const sameRevision = sourceRevisionId === current.section_revision_id
    const sourceAnchorJson = sameRevision
      ? row.anchor_json
      : (sourceHistory?.anchor_json ?? row.anchor_json)
    const sourceAnchorStatus = sameRevision
      ? row.anchor_status
      : (sourceHistory?.anchor_status ?? inferSourceStatus(row, source))
    const sourceHash = sourceHistory?.content_hash ?? source?.content_hash

    // Seed a durable representation of the anchor before changing its
    // revision pointer. For rows created before the history table existed,
    // this is the only copy of the old range we can preserve.
    result.historyRows += insertHistory(
      database,
      row.thread_id,
      sourceRevisionId,
      sourceHash,
      sourceAnchorJson,
      sourceAnchorStatus
    )

    const targetHistory = sameRevision
      ? undefined
      : (database
          .prepare(
            `SELECT revision_id, content_hash, anchor_json, anchor_status
             FROM manuscript_comment_anchor_history
             WHERE thread_id = ? AND content_hash = ?
             ORDER BY CASE WHEN revision_id = ? THEN 0 ELSE 1 END, revision_id
             LIMIT 1`
          )
          .get(row.thread_id, current.content_hash, current.section_revision_id) as
          | AnchorHistoryRow
          | undefined)

    let nextAnchorJson = sourceAnchorJson
    let nextStatus: 'attached' | 'orphaned' = sourceAnchorStatus
    let restored = false

    if (targetHistory !== undefined) {
      // A content hash is the identity of the complete canonical document.
      // Reusing an anchor from a matching historical document is therefore
      // safe even when the revision ID changed after undo/restore.
      nextAnchorJson = targetHistory.anchor_json
      nextStatus = targetHistory.anchor_status
      restored = !sameRevision && targetHistory.revision_id !== sourceRevisionId
    } else if (!sameRevision) {
      const sourceDocument = retainedDocument(source)
      if (sourceDocument !== null && currentDocument !== null && sourceHash !== undefined) {
        const sourceSegments = parseSegments(sourceAnchorJson)
        const mapped =
          sourceAnchorStatus === 'attached'
            ? mapAnchor(sourceDocument, currentDocument, sourceSegments)
            : null
        if (mapped !== null) {
          nextAnchorJson = JSON.stringify(mapped)
          nextStatus = 'attached'
        } else {
          nextStatus = 'orphaned'
        }
      } else {
        nextStatus = 'orphaned'
      }
    }

    result.historyRows += insertHistory(
      database,
      row.thread_id,
      current.section_revision_id,
      current.content_hash,
      nextAnchorJson,
      nextStatus
    )

    const needsUpdate =
      row.anchor_revision_id !== current.section_revision_id ||
      row.current_revision_id !== current.section_revision_id ||
      row.anchor_status !== nextStatus ||
      row.anchor_json !== nextAnchorJson
    if (!needsUpdate) continue

    const updated = database
      .prepare(
        `UPDATE manuscript_comment_threads
         SET anchor_revision_id = ?, current_revision_id = ?, anchor_status = ?,
             anchor_json = ?, version = version + 1, updated_at = ?
         WHERE thread_id = ? AND version = ? AND deleted_at IS NULL`
      )
      .run(
        current.section_revision_id,
        current.section_revision_id,
        nextStatus,
        nextAnchorJson,
        now,
        row.thread_id,
        row.version
      )
    if (updated.changes !== 1) continue

    result.updated += 1
    if (nextStatus === 'attached') result.attached += 1
    else result.orphaned += 1
    if (restored) result.restored += 1
    insertAnchorEvent(database, {
      threadId: row.thread_id,
      type: nextStatus === 'attached' ? 'anchor_rebased' : 'anchor_orphaned',
      revisionId: current.section_revision_id,
      now,
      payload: {
        reason: restored ? 'historical_content_restored' : 'revision_update',
        fromRevisionId: sourceRevisionId,
        toRevisionId: current.section_revision_id
      }
    })
  }

  return result
}

function retainedDocument(row: SectionRevisionRow | undefined): BlockNoteDocument | null {
  if (row === undefined || Number(row.content_body_retained) !== 1) return null
  return decodeStoredSectionContent(row.content_json, row.content_schema_version, row.section_id)
}

function inferSourceStatus(
  row: CommentThreadRow,
  source: SectionRevisionRow | undefined
): 'attached' | 'orphaned' {
  // The 0044 trigger marks a row orphaned as soon as the section pointer moves.
  // When its anchor still belongs to the prior revision, the prior state was
  // attached unless history already says it was explicitly orphaned.
  if (source !== undefined && source.section_revision_id !== row.current_revision_id) {
    return 'attached'
  }
  return row.anchor_status
}

function insertHistory(
  database: NativeDatabase,
  threadId: string,
  revisionId: string,
  contentHash: string | undefined,
  anchorJson: string,
  anchorStatus: 'attached' | 'orphaned'
): number {
  if (contentHash === undefined) return 0
  const result = database
    .prepare(
      `INSERT OR IGNORE INTO manuscript_comment_anchor_history
       (thread_id, revision_id, content_hash, anchor_json, anchor_status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(threadId, revisionId, contentHash, anchorJson, anchorStatus)
  return result.changes
}

function insertAnchorEvent(
  database: NativeDatabase,
  input: {
    threadId: string
    type: 'anchor_rebased' | 'anchor_orphaned'
    revisionId: string
    now: string
    payload: object
  }
): void {
  database
    .prepare(
      `INSERT INTO manuscript_comment_events
       (event_id, thread_id, type, actor, section_revision_id, payload_json, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, 'system', ?, ?, ?)`
    )
    .run(input.threadId, input.type, input.revisionId, JSON.stringify(input.payload), input.now)
}

function parseSegments(anchorJson: string): CommentAnchorSegment[] {
  return commentAnchorSegmentSchema.array().parse(JSON.parse(anchorJson))
}

function blockSnapshots(content: BlockNoteDocument): BlockSnapshot[] {
  const snapshots: BlockSnapshot[] = []
  const visit = (blocks: BlockNoteDocument): void => {
    for (const block of blocks) {
      const text = Array.isArray(block.content) ? blockNoteInlinePlainText(block.content) : ''
      snapshots.push({ id: block.id, text, order: snapshots.length })
      if (block.children.length > 0) visit(block.children)
    }
  }
  visit(content)
  return snapshots
}

function mapAnchor(
  oldDocument: BlockNoteDocument,
  newDocument: BlockNoteDocument,
  segments: CommentAnchorSegment[]
): CommentAnchorSegment[] | null {
  const oldBlocks = blockSnapshots(oldDocument)
  const newBlocks = blockSnapshots(newDocument)
  const newById = new Map(newBlocks.map((block) => [block.id, block]))
  const relations = buildBlockRelations(oldBlocks, newBlocks)
  const mapped: CommentAnchorSegment[] = []

  for (const segment of segments) {
    const relation = relations.get(segment.blockId)
    if (relation === undefined) return null
    const oldBlock = oldBlocks.find((block) => block.id === segment.blockId)
    if (oldBlock === undefined || segment.to > oldBlock.text.length) return null

    let mappedForSegment = 0
    if (relation.exact) {
      for (const target of relation.targets) {
        const from = Math.max(segment.from, target.oldFrom)
        const to = Math.min(segment.to, target.oldTo)
        if (from >= to) continue
        mapped.push({
          blockId: target.blockId,
          from: target.newFrom + (from - target.oldFrom),
          to: target.newFrom + (to - target.oldFrom)
        })
        mappedForSegment += 1
      }
      if (mappedForSegment === 0) return null
      continue
    }

    if (relation.targets.length !== 1) return null
    const target = relation.targets[0]
    if (target === undefined || target.blockId !== segment.blockId) return null
    const newBlock = newById.get(target.blockId)
    if (newBlock === undefined) return null
    const mappedRange = mapTextRange(oldBlock.text, newBlock.text, segment.from, segment.to)
    if (mappedRange === null) return null
    mapped.push({ blockId: target.blockId, ...mappedRange })
    mappedForSegment += 1
  }

  if (mapped.length === 0) return null
  mapped.sort((left, right) => {
    const leftOrder =
      newBlocks.find((block) => block.id === left.blockId)?.order ?? Number.MAX_SAFE_INTEGER
    const rightOrder =
      newBlocks.find((block) => block.id === right.blockId)?.order ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.from - right.from
  })
  for (const segment of mapped) {
    const block = newById.get(segment.blockId)
    if (
      block === undefined ||
      segment.from < 0 ||
      segment.to <= segment.from ||
      segment.to > block.text.length
    ) {
      return null
    }
  }
  return mapped
}

function buildBlockRelations(
  oldBlocks: BlockSnapshot[],
  newBlocks: BlockSnapshot[]
): Map<string, BlockRelation> {
  const relations = new Map<string, BlockRelation>()
  const newById = new Map(newBlocks.map((block) => [block.id, block]))

  for (const oldBlock of oldBlocks) {
    const stable = newById.get(oldBlock.id)
    // A block split into several new IDs is provable only when their complete
    // concatenation matches the old canonical block text. Prefer windows that
    // retain the stable ID, which also handles a normal editor split.
    const splitCandidates = exactSplitCandidates(oldBlock, newBlocks, stable?.id)

    // A block merge is the inverse relation: a new block is exactly the
    // concatenation of a contiguous old window. Add the target slice for this
    // old block so each selected range can move into the merged block.
    const mergeCandidates = exactMergeCandidates(oldBlock, oldBlocks, newBlocks, stable?.id)

    const candidates = [...splitCandidates, ...mergeCandidates]
    if (candidates.length === 0 && stable !== undefined) {
      candidates.push({
        exact: false,
        targets: [
          {
            blockId: stable.id,
            oldFrom: 0,
            oldTo: oldBlock.text.length,
            newFrom: 0,
            newTo: stable.text.length
          }
        ]
      })
    }

    const unique = dedupeRelations(candidates)
    if (unique.length === 1) relations.set(oldBlock.id, unique[0] as BlockRelation)
  }
  return relations
}

function exactSplitCandidates(
  oldBlock: BlockSnapshot,
  newBlocks: BlockSnapshot[],
  stableId: string | undefined
): BlockRelation[] {
  const candidates: BlockRelation[] = []
  for (let start = 0; start < newBlocks.length; start += 1) {
    let joined = ''
    for (let end = start; end < Math.min(newBlocks.length, start + MAX_BLOCK_WINDOW); end += 1) {
      joined += newBlocks[end]?.text ?? ''
      if (joined.length > oldBlock.text.length) break
      if (joined !== oldBlock.text) continue
      const window = newBlocks.slice(start, end + 1)
      if (window.length <= 1) continue
      if (stableId !== undefined && !window.some((block) => block.id === stableId)) continue
      candidates.push({ exact: true, targets: exactTargetsForSplit(window) })
    }
  }
  return candidates
}

function exactTargetsForSplit(window: BlockSnapshot[]): BlockTarget[] {
  const targets: BlockTarget[] = []
  let offset = 0
  for (const block of window) {
    targets.push({
      blockId: block.id,
      oldFrom: offset,
      oldTo: offset + block.text.length,
      newFrom: 0,
      newTo: block.text.length
    })
    offset += block.text.length
  }
  return targets
}

function exactMergeCandidates(
  oldBlock: BlockSnapshot,
  oldBlocks: BlockSnapshot[],
  newBlocks: BlockSnapshot[],
  stableId: string | undefined
): BlockRelation[] {
  const oldIndex = oldBlock.order
  const candidates: BlockRelation[] = []
  for (const newBlock of newBlocks) {
    if (stableId !== undefined && newBlock.id !== stableId) continue
    for (let start = Math.max(0, oldIndex - MAX_BLOCK_WINDOW + 1); start <= oldIndex; start += 1) {
      let joined = ''
      for (let end = start; end < Math.min(oldBlocks.length, start + MAX_BLOCK_WINDOW); end += 1) {
        const block = oldBlocks[end]
        if (block === undefined) continue
        joined += block.text
        if (joined.length > newBlock.text.length) break
        if (end < oldIndex || joined !== newBlock.text) continue
        if (end === start) continue
        const window = oldBlocks.slice(start, end + 1)
        if (!window.some((candidate) => candidate.id === oldBlock.id)) continue
        let newOffset = 0
        const target = window
          .map((candidate) => {
            const candidateTarget = {
              blockId: newBlock.id,
              oldFrom: 0,
              oldTo: candidate.text.length,
              newFrom: newOffset,
              newTo: newOffset + candidate.text.length
            }
            newOffset += candidate.text.length
            return { candidate, candidateTarget }
          })
          .find(({ candidate }) => candidate.id === oldBlock.id)?.candidateTarget
        if (target === undefined) continue
        candidates.push({ exact: true, targets: [target] })
      }
    }
  }
  return candidates
}

function dedupeRelations(candidates: BlockRelation[]): BlockRelation[] {
  const byValue = new Map<string, BlockRelation>()
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.targets)
    byValue.set(key, candidate)
  }
  return [...byValue.values()]
}

function mapTextRange(
  oldText: string,
  newText: string,
  from: number,
  to: number
): { from: number; to: number } | null {
  const quote = oldText.slice(from, to)
  if (quote.length === 0) return null
  if (
    oldText !== newText &&
    (countOccurrences(oldText, quote) > 1 || countOccurrences(newText, quote) > 1)
  )
    return null

  const chunks = diffText(oldText, newText)
  let outputFrom: number | undefined
  let outputTo: number | undefined
  let touched = false
  let removed = false

  for (const chunk of chunks) {
    if (chunk.type === 'unknown' && rangesOverlap(from, to, chunk.oldStart, chunk.oldEnd)) {
      return null
    }
    if (chunk.type === 'delete' && rangesOverlap(from, to, chunk.oldStart, chunk.oldEnd)) {
      removed = true
    }
    if (chunk.type === 'equal' && rangesOverlap(from, to, chunk.oldStart, chunk.oldEnd)) {
      const start = chunk.newStart + Math.max(from, chunk.oldStart) - chunk.oldStart
      const end = chunk.newStart + Math.min(to, chunk.oldEnd) - chunk.oldStart
      outputFrom = outputFrom === undefined ? start : Math.min(outputFrom, start)
      outputTo = outputTo === undefined ? end : Math.max(outputTo, end)
      touched = true
    }
  }

  for (const chunk of chunks) {
    if (chunk.type !== 'insert') continue
    const isInside = chunk.oldStart > from && chunk.oldStart < to
    const isReplacement = removed && chunk.oldStart >= from && chunk.oldStart <= to
    if (isInside || isReplacement) {
      outputFrom = outputFrom === undefined ? chunk.newStart : Math.min(outputFrom, chunk.newStart)
      outputTo = outputTo === undefined ? chunk.newEnd : Math.max(outputTo, chunk.newEnd)
      touched = true
    }
  }

  if (!touched || outputFrom === undefined || outputTo === undefined || outputTo <= outputFrom) {
    return null
  }
  if (
    removed &&
    !chunks.some(
      (chunk) =>
        chunk.type === 'insert' &&
        chunk.oldStart >= from &&
        chunk.oldStart <= to &&
        chunk.newEnd > chunk.newStart
    ) &&
    !chunks.some(
      (chunk) => chunk.type === 'equal' && rangesOverlap(from, to, chunk.oldStart, chunk.oldEnd)
    )
  ) {
    return null
  }
  return { from: outputFrom, to: outputTo }
}

function rangesOverlap(
  leftFrom: number,
  leftTo: number,
  rightFrom: number,
  rightTo: number
): boolean {
  return leftFrom < rightTo && rightFrom < leftTo
}

function countOccurrences(text: string, query: string): number {
  if (query.length === 0) return 0
  let count = 0
  for (let index = text.indexOf(query); index >= 0; index = text.indexOf(query, index + 1))
    count += 1
  return count
}

function diffText(oldText: string, newText: string): DiffChunk[] {
  let prefix = 0
  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText.charCodeAt(oldText.length - suffix - 1) ===
      newText.charCodeAt(newText.length - suffix - 1)
  ) {
    suffix += 1
  }

  const oldMiddle = oldText.slice(prefix, oldText.length - suffix)
  const newMiddle = newText.slice(prefix, newText.length - suffix)
  const raw: RawDiff[] = []
  if (prefix > 0) raw.push({ type: 'equal', oldLength: prefix, newLength: prefix })
  raw.push(...myersRawDiff(oldMiddle, newMiddle))
  if (suffix > 0) raw.push({ type: 'equal', oldLength: suffix, newLength: suffix })

  const chunks: DiffChunk[] = []
  let oldOffset = 0
  let newOffset = 0
  for (const item of mergeRawDiff(raw)) {
    chunks.push({
      type: item.type,
      oldStart: oldOffset,
      oldEnd: oldOffset + item.oldLength,
      newStart: newOffset,
      newEnd: newOffset + item.newLength
    })
    oldOffset += item.oldLength
    newOffset += item.newLength
  }
  return chunks
}

function myersRawDiff(oldText: string, newText: string): RawDiff[] {
  const oldLength = oldText.length
  const newLength = newText.length
  if (oldLength === 0 && newLength === 0) return []
  if (oldLength === 0) return [{ type: 'insert', oldLength: 0, newLength }]
  if (newLength === 0) return [{ type: 'delete', oldLength, newLength: 0 }]
  if (oldLength * newLength > MAX_DIFF_CELLS) {
    // A bounded fallback never guesses inside a large changed middle. Ranges
    // wholly before or after it can still be shifted safely by the known
    // prefix and suffix chunks in diffText.
    return [{ type: 'unknown', oldLength, newLength }]
  }

  const width = newLength + 1
  const lcs = new Uint32Array((oldLength + 1) * width)
  for (let oldIndex = oldLength - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLength - 1; newIndex >= 0; newIndex -= 1) {
      const index = oldIndex * width + newIndex
      if (oldText.charCodeAt(oldIndex) === newText.charCodeAt(newIndex)) {
        lcs[index] = lcs[(oldIndex + 1) * width + newIndex + 1] + 1
      } else {
        lcs[index] = Math.max(
          lcs[(oldIndex + 1) * width + newIndex],
          lcs[oldIndex * width + newIndex + 1]
        )
      }
    }
  }

  const raw: RawDiff[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLength && newIndex < newLength) {
    if (oldText.charCodeAt(oldIndex) === newText.charCodeAt(newIndex)) {
      raw.push({ type: 'equal', oldLength: 1, newLength: 1 })
      oldIndex += 1
      newIndex += 1
    } else if (lcs[(oldIndex + 1) * width + newIndex] >= lcs[oldIndex * width + newIndex + 1]) {
      raw.push({ type: 'delete', oldLength: 1, newLength: 0 })
      oldIndex += 1
    } else {
      raw.push({ type: 'insert', oldLength: 0, newLength: 1 })
      newIndex += 1
    }
  }
  if (oldIndex < oldLength)
    raw.push({ type: 'delete', oldLength: oldLength - oldIndex, newLength: 0 })
  if (newIndex < newLength)
    raw.push({ type: 'insert', oldLength: 0, newLength: newLength - newIndex })
  return raw
}

function mergeRawDiff(items: RawDiff[]): RawDiff[] {
  const merged: RawDiff[] = []
  for (const item of items) {
    if (item.oldLength === 0 && item.newLength === 0) continue
    const previous = merged.at(-1)
    if (previous?.type === item.type) {
      previous.oldLength += item.oldLength
      previous.newLength += item.newLength
    } else {
      merged.push({ ...item })
    }
  }
  return merged
}
