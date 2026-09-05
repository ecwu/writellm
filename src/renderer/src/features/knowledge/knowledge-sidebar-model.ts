import type { KnowledgeIndexStatus, KnowledgeItem } from '../../../../shared/contracts/knowledge'
import type { ReferenceItem } from '../../../../shared/contracts/references'
import type { JobStatus, ListJobsInput } from '../../../../shared/contracts/jobs'

const activeParseStates = new Set([
  'queued',
  'allocating',
  'awaiting_upload',
  'polling',
  'downloading',
  'extracting',
  'publishing'
])
export function isParseInProgress(state: string | null | undefined): boolean {
  return activeParseStates.has(state ?? '')
}
export function hasActiveKnowledgeWorkForItem(item: KnowledgeItem): boolean {
  return (
    item.state === 'importing' ||
    isParseInProgress(item.parseState) ||
    (item.parseState === 'succeeded' && item.normalizationState === 'staging')
  )
}
export function itemNeedsAttention(item: KnowledgeItem): boolean {
  return (
    item.state === 'failed' || item.parseState === 'failed' || item.normalizationState === 'failed'
  )
}
export function referenceNeedsAttention(reference: ReferenceItem, items: KnowledgeItem[]): boolean {
  return (
    reference.metadataCompleteness !== 'complete' ||
    ['changed', 'relink_required', 'source_unavailable'].includes(reference.syncStatus) ||
    items.some(itemNeedsAttention)
  )
}
export function referenceMatches(reference: ReferenceItem, query: string): boolean {
  const fields = [
    reference.title,
    reference.citationKey,
    reference.containerTitle,
    reference.issuedYear?.toString(),
    ...reference.creators.flatMap((c) => [c.given, c.family, c.literal])
  ]
  return fields.some((value) =>
    value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )
}
export function libraryEntries(
  references: ReferenceItem[],
  items: KnowledgeItem[],
  query: string,
  attention: boolean,
  recent: boolean
) {
  const byId = new Map(items.map((item) => [item.knowledgeItemId, item]))
  const linked = new Set(references.flatMap((reference) => reference.knowledgeItemIds))
  const entries = references.map((reference) => {
    const attachments = reference.knowledgeItemIds.flatMap((id) => byId.get(id) ?? [])
    return { reference, attachments, attention: referenceNeedsAttention(reference, attachments) }
  })
  const unlinked = items.filter((item) => !linked.has(item.knowledgeItemId))
  return {
    attentionCount:
      entries.filter((entry) => entry.attention).length +
      unlinked.filter(itemNeedsAttention).length,
    unlinkedCount: unlinked.length,
    references: entries
      .filter(
        (entry) => (!attention || entry.attention) && referenceMatches(entry.reference, query)
      )
      .sort((a, b) =>
        recent
          ? b.reference.createdAt.localeCompare(a.reference.createdAt)
          : a.reference.title.localeCompare(b.reference.title)
      ),
    unlinked: unlinked
      .filter(
        (item) =>
          (!attention || itemNeedsAttention(item)) &&
          [item.displayName, item.originalName].some((name) =>
            name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
          )
      )
      .sort((a, b) =>
        recent ? b.createdAt.localeCompare(a.createdAt) : a.displayName.localeCompare(b.displayName)
      )
  }
}
export function itemStatus(
  item: KnowledgeItem,
  index: KnowledgeIndexStatus | undefined,
  unavailable = false
): string {
  const readable = item.activeParseRevisionId !== null
  const capability = readable
    ? index?.readiness === 'available' && index.indexed
      ? 'Searchable'
      : unavailable || index?.readiness === 'unavailable'
        ? 'Readable · Search unavailable'
        : 'Readable · Search preparing'
    : ''
  let stage = ''
  if (item.state === 'importing') stage = 'Importing file…'
  else if (item.state === 'failed') stage = 'Import failed'
  else if (item.state === 'cancelled') stage = 'Import cancelled'
  else if (item.parseState === 'queued') stage = 'Waiting to parse'
  else if (isParseInProgress(item.parseState)) stage = 'Parsing file…'
  else if (item.normalizationState === 'staging') stage = 'Preparing parsed content…'
  else if (itemNeedsAttention(item)) stage = readable ? 'Update failed' : 'Processing failed'
  else if (item.parseState === 'cancelled') stage = 'Processing cancelled'
  else if (!readable) stage = 'Not parsed yet'
  return [capability, stage].filter(Boolean).join(' · ')
}
export function referenceStatus(
  reference: ReferenceItem,
  items: KnowledgeItem[],
  index: KnowledgeIndexStatus | undefined,
  unavailable = false
): string {
  let status =
    items.length === 0
      ? 'Citation only · No attachment'
      : items.length === 1
        ? `${items[0].extension?.toUpperCase() ?? 'File'} · ${itemStatus(items[0], index, unavailable)}`
        : `${items.length} attachments · ${items.filter((item) => item.activeParseRevisionId !== null).length} readable` +
          (items.some(itemNeedsAttention)
            ? ' · Processing failed'
            : items.some(hasActiveKnowledgeWorkForItem)
              ? ' · Processing'
              : '')
  if (reference.metadataCompleteness !== 'complete') status += ' · Citation details incomplete'
  if (reference.syncStatus === 'changed') status += ' · Metadata update available'
  if (reference.syncStatus === 'relink_required') status += ' · Relink required'
  if (reference.syncStatus === 'source_unavailable') status += ' · Bibliography unavailable'
  return status
}
export function canRetryItem(item: KnowledgeItem): boolean {
  return item.state === 'stored' && itemNeedsAttention(item) && !hasActiveKnowledgeWorkForItem(item)
}
export function jobLabel(type: JobStatus['type']): string {
  const labels: Record<JobStatus['type'], string> = {
    mineru_parse: 'Parsing file',
    normalize_parse_revision: 'Preparing parsed content',
    build_index_generation: 'Building search index',
    build_embedding_generation: 'Updating semantic index',
    remove_index_item: 'Removing from search',
    rebuild_index: 'Rebuilding search index',
    artifact_cleanup: 'Cleaning up files'
  }
  return labels[type]
}
export function jobProgress(job: JobStatus): string {
  if (job.state === 'succeeded') return 'Completed'
  if (job.state === 'cancelled') return 'Cancelled'
  if (job.state === 'failed') return 'Failed'
  if (job.state === 'queued') return 'Queued'
  if (job.cancellationRequested) return 'Stopping…'
  const { completed, total } = job.progress ?? {}
  return completed !== undefined && total !== undefined && total > 0 && completed <= total
    ? `${Math.round((completed / total) * 100)}%`
    : 'Running'
}
export function jobSubjectKey(job: JobStatus): string {
  return job.subject.kind === 'file' ? job.subject.knowledgeItemId : job.subject.kind
}
export function jobSubjectLabel(job: JobStatus, items: KnowledgeItem[]): string {
  if (job.subject.kind === 'file') {
    const id = job.subject.knowledgeItemId
    return items.find((item) => item.knowledgeItemId === id)?.displayName ?? 'Deleted file'
  }
  return job.subject.kind === 'project'
    ? 'Project search'
    : job.subject.kind === 'maintenance'
      ? 'Project maintenance'
      : 'File no longer available'
}
export function currentActivity(jobs: JobStatus[], items: KnowledgeItem[]): JobStatus[] {
  const newest = new Map<string, JobStatus>()
  for (const job of jobs) {
    const key = `${jobSubjectKey(job)}:${job.type}`
    const previous = newest.get(key)
    if (
      !previous ||
      job.createdAt > previous.createdAt ||
      (job.createdAt === previous.createdAt && job.updatedAt > previous.updatedAt)
    )
      newest.set(key, job)
  }
  return jobs.filter((job) => {
    if (job.state === 'queued' || job.state === 'running') return true
    if (
      job.state !== 'failed' ||
      newest.get(`${jobSubjectKey(job)}:${job.type}`)?.jobId !== job.jobId
    )
      return false
    if (job.subject.kind === 'file') {
      const id = job.subject.knowledgeItemId
      const item = items.find((item) => item.knowledgeItemId === id)
      if (!item) return false
      if (job.type === 'mineru_parse' || job.type === 'normalize_parse_revision')
        return itemNeedsAttention(item)
    }
    return job.subject.kind !== 'unknown'
  })
}
export async function loadJobs(input: ListJobsInput): Promise<JobStatus[]> {
  const jobs = new Map<string, JobStatus>()
  let cursor = input.cursor
  do {
    const page = await window.desktop.jobs.list({ ...input, cursor })
    for (const job of page.jobs) jobs.set(job.jobId, job)
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
  return [...jobs.values()]
}
