import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { PROJECT_MANIFEST_FILE } from './project-paths'

export const PROJECT_FORMAT = 'writellm-project'
export const SUPPORTED_PROJECT_FORMAT_VERSION = 1

const projectManifestShape = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    formatVersion: z.number().int().positive(),
    projectId: z.uuid(),
    createdAt: z.iso.datetime()
  })
  .strict()

export type ProjectManifest = z.infer<typeof projectManifestShape>

export function createProjectManifest(options?: {
  projectId?: string
  createdAt?: string
}): ProjectManifest {
  return parseProjectManifest({
    format: PROJECT_FORMAT,
    formatVersion: SUPPORTED_PROJECT_FORMAT_VERSION,
    projectId: options?.projectId ?? randomUUID(),
    createdAt: options?.createdAt ?? new Date().toISOString()
  })
}

export function parseProjectManifest(value: unknown): ProjectManifest {
  const manifest = projectManifestShape.parse(value)
  if (manifest.formatVersion !== SUPPORTED_PROJECT_FORMAT_VERSION) {
    throw new Error(`Unsupported project format version ${manifest.formatVersion}`)
  }
  return manifest
}

export async function writeProjectManifest(
  projectRoot: string,
  manifest: ProjectManifest
): Promise<void> {
  const destination = join(projectRoot, PROJECT_MANIFEST_FILE)
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(parseProjectManifest(manifest), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    await rename(temporary, destination)
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw new Error('Failed to write project manifest', { cause: err })
  }
}

export async function readProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  let text: string
  try {
    text = await readFile(join(projectRoot, PROJECT_MANIFEST_FILE), 'utf8')
  } catch (err) {
    throw new Error('Failed to read project manifest', { cause: err })
  }

  try {
    return parseProjectManifest(JSON.parse(text) as unknown)
  } catch (err) {
    throw new Error('Invalid project manifest', { cause: err })
  }
}
