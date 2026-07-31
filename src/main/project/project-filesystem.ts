import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { Logger } from 'pino'
import { normalizeProjectRelativePath, resolveProjectPath } from './project-paths'

export type ProjectFilesystemEntryKind = 'file' | 'directory' | 'any'

export class ProjectFilesystemError extends Error {
  constructor(
    readonly code:
      | 'path_missing'
      | 'path_not_directory'
      | 'path_not_file'
      | 'path_symbolic_link'
      | 'path_escape'
      | 'path_exists',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ProjectFilesystemError'
  }
}

/**
 * Main-only authority for managed project paths.
 *
 * This boundary protects against a portable project containing pre-existing symbolic links or
 * junctions. It does not claim to close same-user path-replacement races between validation and a
 * later operating-system call.
 */
export class ProjectFilesystem {
  readonly #root: string
  readonly #log?: Pick<Logger, 'warn'>

  constructor(canonicalProjectRoot: string, log?: Pick<Logger, 'warn'>) {
    this.#root = resolve(canonicalProjectRoot)
    this.#log = log
  }

  get canonicalRoot(): string {
    return this.#root
  }

  async assertExistingRegularFile(relativePath: string): Promise<string> {
    return this.#assertExisting(relativePath, 'file')
  }

  async assertExistingDirectory(relativePath: string): Promise<string> {
    return this.#assertExisting(relativePath, 'directory')
  }

  async assertExistingEntry(relativePath: string): Promise<string> {
    return this.#assertExisting(relativePath, 'any')
  }

  async resolveForCreation(relativePath: string): Promise<string> {
    const normalized = normalizeProjectRelativePath(relativePath)
    await this.#assertDirectorySegments(dirname(normalized).replaceAll('\\', '/'))
    return resolveProjectPath(this.#root, normalized)
  }

  async ensureDirectory(relativePath: string): Promise<string> {
    const normalized = normalizeProjectRelativePath(relativePath)
    let current = this.#root
    for (const segment of normalized.split('/')) {
      current = resolve(current, segment)
      try {
        const metadata = await lstat(current)
        if (metadata.isSymbolicLink()) this.#reject('path_symbolic_link', normalized)
        if (!metadata.isDirectory()) this.#reject('path_not_directory', normalized)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        try {
          await mkdir(current, { mode: 0o700 })
        } catch (mkdirErr) {
          if ((mkdirErr as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirErr
        }
        const created = await lstat(current)
        if (created.isSymbolicLink()) this.#reject('path_symbolic_link', normalized)
        if (!created.isDirectory()) this.#reject('path_not_directory', normalized)
      }
    }
    await this.#assertContainedRealpath(current, normalized)
    return current
  }

  async createExclusiveFile(
    relativePath: string,
    mode: number = 0o600
  ): Promise<{ path: string; handle: FileHandle }> {
    const path = await this.resolveForCreation(relativePath)
    return { path, handle: await open(path, 'wx', mode) }
  }

  async removeFile(relativePath: string): Promise<void> {
    const normalized = normalizeProjectRelativePath(relativePath)
    try {
      await this.#assertDirectorySegments(dirname(normalized).replaceAll('\\', '/'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    const path = resolveProjectPath(this.#root, normalized)
    let metadata: Awaited<ReturnType<typeof lstat>>
    try {
      metadata = await lstat(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    if (metadata.isSymbolicLink()) this.#reject('path_symbolic_link', normalized)
    if (!metadata.isFile()) this.#reject('path_not_file', normalized)
    await unlink(path)
  }

  async removeTree(relativePath: string): Promise<void> {
    const normalized = normalizeProjectRelativePath(relativePath)
    try {
      await this.#assertDirectorySegments(dirname(normalized).replaceAll('\\', '/'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    const path = resolveProjectPath(this.#root, normalized)
    let metadata: Awaited<ReturnType<typeof lstat>>
    try {
      metadata = await lstat(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    if (metadata.isSymbolicLink()) this.#reject('path_symbolic_link', normalized)
    if (!metadata.isDirectory()) {
      await unlink(path)
      return
    }
    await removeDirectoryNoFollow(path)
  }

  async publish(relativeSource: string, relativeDestination: string): Promise<string> {
    const source = await this.assertExistingEntry(relativeSource)
    const normalizedDestination = normalizeProjectRelativePath(relativeDestination)
    await this.#assertDirectorySegments(dirname(normalizedDestination).replaceAll('\\', '/'))
    const destination = resolveProjectPath(this.#root, normalizedDestination)
    try {
      const metadata = await lstat(destination)
      if (metadata.isSymbolicLink()) {
        this.#reject('path_symbolic_link', normalizedDestination)
      }
      this.#reject('path_exists', normalizedDestination)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    await rename(source, destination)
    return destination
  }

  async createFreshDirectory(relativePath: string): Promise<string> {
    const normalized = normalizeProjectRelativePath(relativePath)
    const parent = dirname(normalized).replaceAll('\\', '/')
    if (parent !== '.') await this.ensureDirectory(parent)
    await this.removeTree(normalized)
    const path = resolveProjectPath(this.#root, normalized)
    await mkdir(path, { mode: 0o700 })
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) this.#reject('path_symbolic_link', normalized)
    if (!metadata.isDirectory()) this.#reject('path_not_directory', normalized)
    return path
  }

  async #assertExisting(
    relativePath: string,
    expectedKind: ProjectFilesystemEntryKind
  ): Promise<string> {
    const normalized = normalizeProjectRelativePath(relativePath)
    let current = this.#root
    for (const [index, segment] of normalized.split('/').entries()) {
      current = resolve(current, segment)
      let metadata: Awaited<ReturnType<typeof lstat>>
      try {
        metadata = await lstat(current)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.#reject('path_missing', normalized, err)
        }
        throw err
      }
      if (metadata.isSymbolicLink()) this.#reject('path_symbolic_link', normalized)
      const isLast = index === normalized.split('/').length - 1
      if (!isLast && !metadata.isDirectory()) this.#reject('path_not_directory', normalized)
      if (isLast && expectedKind === 'file' && !metadata.isFile()) {
        this.#reject('path_not_file', normalized)
      }
      if (isLast && expectedKind === 'directory' && !metadata.isDirectory()) {
        this.#reject('path_not_directory', normalized)
      }
    }
    await this.#assertContainedRealpath(current, normalized)
    return current
  }

  async #assertDirectorySegments(relativeDirectory: string): Promise<void> {
    if (relativeDirectory === '.' || relativeDirectory === '') return
    const normalized = normalizeProjectRelativePath(relativeDirectory)
    let current = this.#root
    for (const segment of normalized.split('/')) {
      current = resolve(current, segment)
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink()) this.#reject('path_symbolic_link', normalized)
      if (!metadata.isDirectory()) this.#reject('path_not_directory', normalized)
    }
    await this.#assertContainedRealpath(current, normalized)
  }

  async #assertContainedRealpath(path: string, normalized: string): Promise<void> {
    const canonical = await realpath(path)
    const canonicalRoot = await realpath(this.#root)
    const fromRoot = relative(canonicalRoot, canonical)
    if (fromRoot.startsWith('..') || resolve(canonicalRoot, fromRoot) !== canonical) {
      this.#reject('path_escape', normalized)
    }
  }

  #reject(code: ProjectFilesystemError['code'], relativePath: string, cause?: unknown): never {
    this.#log?.warn(
      {
        subsystem: 'project',
        component: 'filesystem-boundary',
        event: 'security.project_path_rejected',
        code,
        relativePath
      },
      'Rejected an unsafe project filesystem path'
    )
    throw new ProjectFilesystemError(code, 'Project filesystem path is unsafe', {
      ...(cause === undefined ? {} : { cause })
    })
  }
}

async function removeDirectoryNoFollow(path: string): Promise<void> {
  for (const name of await readdir(path)) {
    const child = resolve(path, name)
    const metadata = await lstat(child)
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      await removeDirectoryNoFollow(child)
    } else {
      await unlink(child)
    }
  }
  await rmdir(path)
}
