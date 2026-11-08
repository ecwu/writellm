import type { IndexSource } from './contracts/indexing'
import { sha256 } from './hash'

export const INDEX_GENERATION_PREFIX = 'generation-v2-'

type IndexSourceIdentity = Pick<
  IndexSource,
  'knowledgeItemId' | 'extension' | 'parseRevisionId' | 'normalizationRunId' | 'manifestSha256'
>

export function hashSourceSet(
  sources: readonly IndexSourceIdentity[],
  chunkerVersion: number
): string {
  return sha256(
    Buffer.from(
      JSON.stringify({
        chunkerVersion,
        sources: [...sources]
          .sort((a, b) => a.knowledgeItemId.localeCompare(b.knowledgeItemId))
          .map((source) => ({
            knowledgeItemId: source.knowledgeItemId,
            extension: source.extension,
            parseRevisionId: source.parseRevisionId,
            normalizationRunId: source.normalizationRunId,
            manifestSha256: source.manifestSha256
          }))
      })
    )
  )
}

export function generationIdFor(sourceSetSha256: string, chunkerVersion: number): string {
  return `${INDEX_GENERATION_PREFIX}${sha256(Buffer.from(`${chunkerVersion}\0${sourceSetSha256}`)).slice(0, 40)}`
}
