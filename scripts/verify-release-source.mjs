import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyReleaseSource } from './verify-release-evidence.mjs'

export function verifyCurrentReleaseSource({ tag, revision }) {
  const packageVersion = verifyReleaseSource({ tag, revision, requireClean: true })
  return { tag, revision, packageVersion }
}

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${executable} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === currentFile) {
  const values = new Map(
    process.argv
      .slice(2)
      .map((argument) => argument.match(/^--([a-z-]+)=(.+)$/u))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]])
  )
  const tag = values.get('tag')
  const revision = values.get('revision') ?? command('git', ['rev-parse', 'HEAD'])
  if (tag === undefined) {
    throw new Error('Usage: verify-release-source.mjs --tag=<tag> [--revision=<sha>]')
  }
  process.stdout.write(`${JSON.stringify(verifyCurrentReleaseSource({ tag, revision }))}\n`)
}
