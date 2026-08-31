import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import type { CitationFormatterCluster } from '../../shared/contracts/citation-formatting'
import {
  formattedReferenceSnapshotSchema,
  type FormattedReferenceSnapshot
} from '../../shared/contracts/references'
import { findDocumentCitationOccurrences } from '../../shared/readable-citation'
import type { ProjectContext } from '../project/project-context'
import type { CitationFormatterClient } from './citation-formatter-client'

const CACHE_LIMIT = 32

export class CitationFormattingService {
  readonly #client: CitationFormatterClient
  readonly #log: Pick<Logger, 'info' | 'error'>
  readonly #cache = new Map<string, FormattedReferenceSnapshot>()
  readonly #active = new Map<string, AbortController>()

  constructor(options: {
    client: CitationFormatterClient
    log: Pick<Logger, 'info' | 'error'>
  }) {
    this.#client = options.client
    this.#log = options.log
  }

  async format(context: ProjectContext): Promise<FormattedReferenceSnapshot> {
    const assembly = context.manuscript.assemble()
    const occurrences = assembly.sections.flatMap(({ section, revision }) =>
      findDocumentCitationOccurrences({
        sectionId: section.sectionId,
        sectionRevisionId: revision.sectionRevisionId,
        content: revision.content
      })
    )
    const clusters = clustersFromOccurrences(occurrences)
    const referenceByKey = new Map(
      context.references.list().map((reference) => [reference.citationKey, reference])
    )
    const completeClusters = clusters.filter((cluster) =>
      cluster.items.every((item) => referenceByKey.has(item.citationKey))
    )
    const citedKeys = new Set(
      completeClusters.flatMap((cluster) => cluster.items.map((item) => item.citationKey))
    )
    const references = [...citedKeys]
      .map((key) => referenceByKey.get(key))
      .filter((reference) => reference !== undefined)
      .sort((left, right) => left.citationKey.localeCompare(right.citationKey))
    const settings = context.references.formattingSettings()
    const customXml =
      settings.customStyleRelativePath === null
        ? undefined
        : await readFile(
            await context.filesystem.assertExistingRegularFile(settings.customStyleRelativePath),
            'utf8'
          )
    const snapshotHash = sha256(
      canonicalJson({
        styleId: settings.styleId,
        locale: settings.locale,
        items: references.map((reference) => reference.csl),
        clusters: completeClusters
      })
    )
    const cached = this.#cache.get(snapshotHash)
    if (cached !== undefined) {
      this.#cache.delete(snapshotHash)
      this.#cache.set(snapshotHash, cached)
      this.#log.info(
        {
          event: 'reference.formatter_cache.hit',
          projectId: context.manifest.projectId,
          snapshotHash
        },
        'Citation formatter cache hit'
      )
      return cached
    }

    this.#active.get(context.manifest.projectId)?.abort()
    const controller = new AbortController()
    this.#active.set(context.manifest.projectId, controller)
    await debounce(controller.signal)
    const startedAt = Date.now()
    try {
      const result = await this.#client.format(
        {
          projectSessionId: context.projectSessionId,
          snapshotHash,
          style: {
            styleId: settings.styleId,
            ...(customXml === undefined ? {} : { customXml })
          },
          locale: settings.locale,
          items: references.map((reference) => reference.csl),
          clusters: completeClusters.map(({ raw: _raw, ...cluster }) => cluster)
        },
        controller.signal
      )
      if (this.#active.get(context.manifest.projectId) !== controller) {
        throw abortError()
      }
      const rawByClusterId = new Map(
        completeClusters.map((cluster) => [cluster.clusterId, cluster.raw])
      )
      const snapshot = formattedReferenceSnapshotSchema.parse({
        snapshotHash: result.snapshotHash,
        styleId: settings.styleId,
        locale: settings.locale,
        citations: result.citations.map((citation) => ({
          ...citation,
          raw: rawByClusterId.get(citation.clusterId)
        })),
        bibliography: result.bibliography
      })
      this.#cache.set(snapshotHash, snapshot)
      while (this.#cache.size > CACHE_LIMIT) {
        const oldest = this.#cache.keys().next().value
        if (oldest === undefined) break
        this.#cache.delete(oldest)
      }
      this.#log.info(
        {
          event: 'reference.formatter.completed',
          projectId: context.manifest.projectId,
          snapshotHash,
          citationCount: snapshot.citations.length,
          bibliographyEntryCount: snapshot.bibliography.length,
          durationMs: Date.now() - startedAt
        },
        'Citation snapshot formatted'
      )
      return snapshot
    } catch (err) {
      this.#log.error(
        {
          event: 'reference.formatter.failed',
          err,
          projectId: context.manifest.projectId,
          snapshotHash,
          durationMs: Date.now() - startedAt
        },
        'Citation snapshot formatting failed'
      )
      throw new Error('Citation formatting failed', { cause: err })
    } finally {
      if (this.#active.get(context.manifest.projectId) === controller) {
        this.#active.delete(context.manifest.projectId)
      }
    }
  }

  close(): void {
    for (const controller of this.#active.values()) controller.abort()
    this.#active.clear()
    this.#cache.clear()
  }
}

interface OrderedFormatterCluster extends CitationFormatterCluster {
  readonly raw: string
}

function clustersFromOccurrences(
  occurrences: ReturnType<typeof findDocumentCitationOccurrences>
): OrderedFormatterCluster[] {
  const clusters = new Map<string, OrderedFormatterCluster>()
  for (const occurrence of occurrences) {
    if (occurrence.citationKey === undefined || occurrence.clusterId === undefined) continue
    const clusterId = `${occurrence.sectionId}:${occurrence.clusterId}`
    const existing = clusters.get(clusterId)
    const item = {
      citationKey: occurrence.citationKey,
      ...(occurrence.pageIndex === undefined
        ? {}
        : {
            locator: {
              label: 'page' as const,
              startPageIndex: occurrence.pageIndex,
              endPageIndex: occurrence.pageEndIndex ?? occurrence.pageIndex
            }
          })
    }
    if (existing === undefined) {
      clusters.set(clusterId, { clusterId, raw: occurrence.raw, items: [item] })
    } else {
      clusters.set(clusterId, { ...existing, items: [...existing.items, item] })
    }
  }
  return [...clusters.values()]
}

function debounce(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 300)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(abortError())
      },
      { once: true }
    )
  })
}

function abortError(): Error {
  const error = new Error('Citation formatting was superseded')
  error.name = 'AbortError'
  return error
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )
    .join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
