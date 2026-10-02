import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Match better-sqlite3 13's default loader order, including source-build fallback.
export function resolveBetterSqlite3Binary(root, target, musl = false) {
  const platform = target.platform === 'linux' && musl ? 'linuxmusl' : target.platform
  const candidates = [
    join(root, 'prebuilds', `${platform}-${target.arch}.node`),
    join(root, 'build', 'Debug', 'better_sqlite3.node'),
    join(root, 'build', 'Release', 'better_sqlite3.node')
  ]
  const binary = candidates.find((candidate) => existsSync(candidate))
  if (binary === undefined) throw new Error('better-sqlite3 has no native binary for this target')
  return binary
}

export function isLinuxMusl() {
  return process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
}
