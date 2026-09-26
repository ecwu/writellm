import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = process.env.GITHUB_REPOSITORY
const runId = process.env.SOURCE_RUN_ID
const tag = process.env.RELEASE_TAG
const planOnly = process.argv.includes('--plan')
assert(repo && /^[\w.-]+\/[\w.-]+$/.test(repo), 'Expected a repository')
assert(runId && /^\d+$/.test(runId), 'Expected a numeric source run ID')
assert(tag && /^v\d+\.\d{4}\.\d+\.\d+$/.test(tag), 'Expected a release tag')
const version = tag.slice(1)
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
const api = (path) => JSON.parse(gh('api', `repos/${repo}/${path}`))
async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function tagRevision() {
  let object = api(`git/ref/tags/${encodeURIComponent(tag)}`).object
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
    object = api(`git/tags/${object.sha}`).object
  }
  assert.equal(object.type, 'commit', 'Tag must resolve to a commit')
  return object.sha
}
const run = api(`actions/runs/${runId}`)
const workflow = api('actions/workflows/ci.yml')
assert.equal(run.repository.full_name, repo)
assert.equal(run.head_repository.full_name, repo)
assert.equal(run.workflow_id, workflow.id)
assert.equal(run.path, '.github/workflows/ci.yml')
assert.equal(run.event, 'push')
assert.equal(run.status, 'completed')
assert.equal(run.conclusion, 'success')
assert.equal(run.head_branch, tag)
assert.equal(tagRevision(), run.head_sha, 'Tag changed since the source build')
const repository = api('')
assert.equal(
  api(`compare/${run.head_sha}...${encodeURIComponent(repository.default_branch)}`)
    .merge_base_commit.sha,
  run.head_sha,
  'Release source must be on the default branch'
)
const sourcePackage = api(`contents/package.json?ref=${run.head_sha}`)
const metadata = JSON.parse(Buffer.from(sourcePackage.content, 'base64').toString('utf8'))
assert.equal(metadata.release.version, version)
const jobs = api(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`).jobs
for (const name of [
  'Static and fixture gate',
  'Windows x64 build',
  'macOS arm64 build',
  'macOS x64 build',
  'Linux x64 build'
]) {
  const matches = jobs.filter((job) => job.name === name)
  assert.equal(matches.length, 1, `Expected one ${name}`)
  assert.equal(matches[0].conclusion, 'success', name)
}
const targets = [
  ['windows-x64', 'win32-x64', 'x64', 'pe', 'NSIS', `WriteLLM-${version}-x64-setup.exe`],
  ['macos-arm64', 'darwin-arm64', 'arm64', 'mach-o', 'DMG', `WriteLLM-${version}-arm64.dmg`],
  ['macos-x64', 'darwin-x64', 'x64', 'mach-o', 'DMG', `WriteLLM-${version}-x64.dmg`],
  ['linux-x64', 'linux-x64', 'x64', 'elf', 'AppImage', `WriteLLM-${version}-x64.AppImage`]
]
const artifacts = api(`actions/runs/${runId}/artifacts?per_page=100`).artifacts
for (const [target] of targets) {
  const matches = artifacts.filter((a) => a.name === `writellm-${target}-${run.head_sha}`)
  assert.equal(matches.length, 1, `Expected one artifact for ${target}`)
  assert.equal(matches[0].expired, false, target)
  assert.equal(matches[0].workflow_run.id, Number(runId))
  assert.equal(matches[0].workflow_run.head_sha, run.head_sha)
}
process.stdout.write(
  `${JSON.stringify({ tag, runId, revision: run.head_sha, source: 'verified' })}\n`
)
if (!planOnly) {
  // Artifact data is isolated from checkout, never imported, sourced, or executed.
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'writellm-release-'))
  const assets = []
  for (const [target, host, arch, format, installer, name] of targets) {
    const directory = join(root, target)
    await mkdir(directory)
    gh(
      'run',
      'download',
      runId,
      '--repo',
      repo,
      '--name',
      `writellm-${target}-${run.head_sha}`,
      '--dir',
      directory
    )
    const evidence = JSON.parse(await readFile(join(directory, 'package-evidence.json'), 'utf8'))
    assert.equal(evidence.sourceRevision, run.head_sha, target)
    assert.equal(evidence.releaseVersion, version, target)
    assert.equal(evidence.packageVersion, metadata.version, target)
    assert.equal(evidence.buildNumber, version.split('.').at(-1), target)
    assert.equal(evidence.host, host, target)
    assert.equal(evidence.target, target)
    assert.equal(evidence.verificationMode, 'build-only', target)
    assert.equal(evidence.inventory.target, target)
    for (const native of ['betterSqlite3', 'sqliteVec']) {
      assert.equal(evidence.inventory[native].arch, arch, target)
      assert.equal(evidence.inventory[native].format, format, target)
    }
    for (const stage of [
      'production-build',
      'package-application',
      'package-inventory',
      'package-installers',
      'artifact-checksums'
    ]) {
      assert.equal(
        evidence.stages.filter((s) => s.name === stage && s.status === 'passed').length,
        1,
        `${target}: ${stage}`
      )
    }
    assert(
      evidence.stages.every((s) => s.status === 'passed'),
      target
    )
    const matches = evidence.artifacts.filter((a) => a.format === installer && a.file === name)
    assert.equal(matches.length, 1, name)
    const path = join(directory, name)
    const stat = await lstat(path)
    assert(stat.isFile() && !stat.isSymbolicLink(), name)
    assert.equal(stat.size, matches[0].bytes, name)
    const digest = await sha256(path)
    assert.equal(digest, matches[0].sha256, name)
    assets.push({ path, name, bytes: stat.size, digest: `sha256:${digest}` })
  }
  assert.equal(tagRevision(), run.head_sha, 'Tag changed before publication')
  let notes = `Source changes for WriteLLM ${version}.`
  try {
    notes = await readFile(`docs/releases/${version}.md`, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  notes += `\n\nSource: \`${run.head_sha}\`. [Successful four-platform build](${run.html_url}).\n\nDownloads: Windows x64 EXE, macOS Apple Silicon DMG, macOS Intel DMG, Linux x64 AppImage. Only these four packages are attached.\n\nDistribution is unsigned; macOS packages are not notarized. Hosted CI checks native builds and package inventory; it does not run runtime tests. JSON evidence and alternative archives remain in the source CI run.\n`
  const notesPath = join(root, 'notes.md')
  await writeFile(notesPath, notes)
  // A failed upload leaves a draft. Retry only adds missing matching assets; never replaces them.
  const findRelease = () =>
    JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`))
      .flat()
      .find((r) => r.tag_name === tag)
  let release = findRelease()
  if (!release) {
    gh(
      'release',
      'create',
      tag,
      '--repo',
      repo,
      '--verify-tag',
      '--draft',
      '--title',
      `WriteLLM ${version}`,
      '--notes-file',
      notesPath
    )
    release = findRelease()
    assert(release, 'Created draft must be visible to publisher')
  }
  assert.equal(release.prerelease, false, 'Existing release must not be a prerelease')
  const checkAssets = (uploaded, complete) => {
    assert(
      uploaded.every((a) => assets.some((expected) => expected.name === a.name)),
      'Unexpected release attachment'
    )
    assert.equal(new Set(uploaded.map((a) => a.name)).size, uploaded.length)
    if (complete) assert.equal(uploaded.length, 4)
    for (const a of uploaded) {
      const expected = assets.find((item) => item.name === a.name)
      assert.equal(a.size, expected.bytes, a.name)
      assert.equal(a.digest, expected.digest, a.name)
      assert.equal(a.state, 'uploaded', a.name)
    }
  }
  checkAssets(release.assets, !release.draft)
  if (release.draft) {
    for (const asset of assets) {
      if (!release.assets.some((a) => a.name === asset.name)) {
        gh('release', 'upload', tag, asset.path, '--repo', repo)
      }
    }
    checkAssets(api(`releases/${release.id}`).assets, true)
    assert.equal(tagRevision(), run.head_sha, 'Tag changed before publishing draft')
    gh(
      'release',
      'edit',
      tag,
      '--repo',
      repo,
      '--draft=false',
      '--prerelease=false',
      '--latest',
      '--notes-file',
      notesPath
    )
  }
  release = api(`releases/${release.id}`)
  assert.equal(release.draft, false)
  assert.equal(release.prerelease, false)
  checkAssets(release.assets, true)
  const summary = `Published [WriteLLM ${version}](${release.html_url}) from [build ${runId}](${run.html_url}) with four verified packages.\n`
  process.stdout.write(summary)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
}
