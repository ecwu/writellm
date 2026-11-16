import { mineruRawManifestSchema } from '../../shared/contracts/mineru'
import { sha256 } from '../../shared/hash'
import type { ParseRevisionTable } from '../project/database-types'
import type { ProjectFilesystem } from '../project/project-filesystem'
import { readBounded } from '../storage/durable-sync'

const MAX_RAW_MANIFEST_BYTES = 10 * 1024 * 1024

export type RawManifestRevision = Pick<
  ParseRevisionTable,
  'relative_path' | 'parse_revision_id' | 'knowledge_item_id' | 'source_sha256' | 'manifest_sha256'
>

export async function readMineruRawManifest(
  filesystem: ProjectFilesystem,
  revision: RawManifestRevision,
  mode: 'published' | 'publication-recovery' = 'published'
) {
  if (revision.manifest_sha256 === null && mode === 'published') {
    throw new Error('Published raw parse manifest hash is missing')
  }
  const path = await filesystem.assertExistingRegularFile(`${revision.relative_path}/manifest.json`)
  const bytes = await readBounded(path, MAX_RAW_MANIFEST_BYTES)
  const manifestHash = sha256(bytes)
  if (revision.manifest_sha256 !== null && revision.manifest_sha256 !== manifestHash) {
    throw new Error('Raw parse manifest hash does not match the database')
  }
  const manifest = mineruRawManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  if (
    manifest.parseRevisionId !== revision.parse_revision_id ||
    manifest.knowledgeItemId !== revision.knowledge_item_id ||
    manifest.sourceSha256 !== revision.source_sha256
  ) {
    throw new Error('Raw parse manifest provenance does not match the revision')
  }
  return { manifest, manifestHash }
}
