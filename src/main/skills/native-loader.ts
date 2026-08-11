import {
  ExecutionError,
  FileError,
  loadSourcedSkills,
  type ExecutionEnv,
  type FileInfo,
  type Result,
  type Skill
} from '@earendil-works/pi-agent-core'
import { posix } from 'node:path'

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
const fileErr = <T>(
  code: ConstructorParameters<typeof FileError>[0],
  path: string
): Result<T, FileError> => ({
  ok: false,
  error: new FileError(code, 'Virtual Writing Skill access denied', path)
})

/** Pi loader adapter whose entire namespace is one already-verified manifest entrypoint. */
export async function loadManifestSkillWithPi(input: {
  name: string
  document: string
  virtualUri: string
}): Promise<Skill> {
  const directory = `/skills/${input.name}`
  const entrypoint = `${directory}/SKILL.md`
  const env = virtualEnv(directory, entrypoint, input.document)
  const loaded = await loadSourcedSkills(
    env,
    [{ path: directory, source: input.virtualUri }],
    (skill) => ({ ...skill, filePath: input.virtualUri })
  )
  if (loaded.diagnostics.length > 0 || loaded.skills.length !== 1) {
    throw new Error('Pi rejected the Writing Skill manifest entrypoint')
  }
  const result = loaded.skills[0]
  if (result === undefined) throw new Error('Pi did not return the Writing Skill')
  return result.skill
}

function virtualEnv(directory: string, entrypoint: string, document: string): ExecutionEnv {
  const normalize = (path: string): string =>
    posix.normalize(path.startsWith('/') ? path : posix.join(directory, path))
  const info = (path: string): FileInfo | undefined => {
    const normalized = normalize(path)
    if (normalized === directory) {
      return {
        name: posix.basename(directory),
        path: directory,
        kind: 'directory',
        size: 0,
        mtimeMs: 0
      }
    }
    if (normalized === entrypoint) {
      return {
        name: 'SKILL.md',
        path: entrypoint,
        kind: 'file',
        size: Buffer.byteLength(document),
        mtimeMs: 0
      }
    }
    return undefined
  }
  const denied = async <T>(path: string): Promise<Result<T, FileError>> =>
    fileErr('permission_denied', normalize(path))
  return {
    cwd: directory,
    async absolutePath(path) {
      const normalized = normalize(path)
      return info(normalized) === undefined ? fileErr('not_found', normalized) : ok(normalized)
    },
    async joinPath(parts) {
      const normalized = normalize(posix.join(...parts))
      return normalized === directory || normalized.startsWith(`${directory}/`)
        ? ok(normalized)
        : fileErr('permission_denied', normalized)
    },
    async readTextFile(path) {
      const normalized = normalize(path)
      return normalized === entrypoint ? ok(document) : fileErr('not_found', normalized)
    },
    async readTextLines(path, options) {
      const normalized = normalize(path)
      if (normalized !== entrypoint) return fileErr('not_found', normalized)
      return ok(document.split(/\r?\n/).slice(0, options?.maxLines))
    },
    readBinaryFile: denied,
    writeFile: denied,
    appendFile: denied,
    async fileInfo(path) {
      const normalized = normalize(path)
      const value = info(normalized)
      return value === undefined ? fileErr('not_found', normalized) : ok(value)
    },
    async listDir(path) {
      const normalized = normalize(path)
      const value = info(entrypoint)
      return normalized === directory && value !== undefined
        ? ok([value])
        : fileErr('not_directory', normalized)
    },
    async canonicalPath(path) {
      const normalized = normalize(path)
      return info(normalized) === undefined ? fileErr('not_found', normalized) : ok(normalized)
    },
    async exists(path) {
      return ok(info(normalize(path)) !== undefined)
    },
    createDir: denied,
    remove: denied,
    async createTempDir() {
      return fileErr('not_supported', directory)
    },
    async createTempFile() {
      return fileErr('not_supported', directory)
    },
    async exec() {
      return {
        ok: false,
        error: new ExecutionError('shell_unavailable', 'Writing Skills cannot execute commands')
      }
    },
    async cleanup() {}
  }
}
