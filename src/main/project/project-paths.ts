import { isAbsolute, relative, resolve, win32 } from 'node:path'
import { realpath } from 'node:fs/promises'

export const PROJECT_MANIFEST_FILE = 'writellm.project.json'
export const WRITELLM_INTERNAL_DIRECTORY = '.writellm'
export const PROJECT_DATABASE_RELATIVE_PATH = '.writellm/project.sqlite'
export const INDEX_DATABASE_RELATIVE_PATH = '.writellm/index.sqlite'
export const PROJECT_LOCK_RELATIVE_PATH = '.writellm/write.lock'
export const PROJECT_TEMP_DIRECTORY = '.writellm/temp'
export const PROJECT_BACKUPS_DIRECTORY = '.writellm/backups'
export const PROJECT_RECOVERY_DIRECTORY = '.writellm/recovery'
export const MANUSCRIPT_SECTIONS_DIRECTORY = 'manuscript/sections'
export const MANUSCRIPT_ASSETS_DIRECTORY = 'manuscript/assets'
export const MANUSCRIPT_EXPORTS_DIRECTORY = 'manuscript/exports'
export const KNOWLEDGE_ORIGINALS_DIRECTORY = 'knowledge/originals'
export const KNOWLEDGE_PARSED_DIRECTORY = 'knowledge/parsed'

export function normalizeProjectRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new Error('Project path must be a normalized relative path')
  }

  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('Project path contains an invalid segment')
  }
  return segments.join('/')
}

export function resolveProjectPath(projectRoot: string, relativePath: string): string {
  const normalized = normalizeProjectRelativePath(relativePath)
  const root = resolve(projectRoot)
  const target = resolve(root, ...normalized.split('/'))
  const fromRoot = relative(root, target)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Project path escapes the project root')
  }
  return target
}

export async function resolveExistingProjectPath(
  projectRoot: string,
  relativePath: string
): Promise<string> {
  const root = await realpath(projectRoot)
  const target = await realpath(resolveProjectPath(root, relativePath))
  const fromRoot = relative(root, target)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Project path escapes the project root through a symbolic link')
  }
  return target
}
