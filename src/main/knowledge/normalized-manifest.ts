import { normalizedKnowledgeManifestSchema } from '../../shared/contracts/knowledge'
import { sha256 } from '../../shared/hash'
import { readBounded } from '../storage/durable-sync'

const MAX_MANIFEST_BYTES = 10 * 1024 * 1024

export async function readNormalizedManifest(
  path: string,
  expected: {
    knowledgeItemId: string
    parseRevisionId: string
    normalizationRunId: string
    manifestSha256: string | null
  },
  mode: 'published' | 'publication-recovery' = 'published'
) {
  if (expected.manifestSha256 === null && mode === 'published') {
    throw new Error('Published normalized manifest hash is missing')
  }
  const bytes = await readBounded(path, MAX_MANIFEST_BYTES)
  const manifestHash = sha256(bytes)
  if (expected.manifestSha256 !== null && manifestHash !== expected.manifestSha256) {
    throw new Error('Normalized manifest hash does not match')
  }
  const manifest = normalizedKnowledgeManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  if (
    manifest.knowledgeItemId !== expected.knowledgeItemId ||
    manifest.parseRevisionId !== expected.parseRevisionId ||
    manifest.normalizationRunId !== expected.normalizationRunId
  ) {
    throw new Error('Normalized manifest provenance does not match')
  }
  return { manifest, manifestHash }
}
