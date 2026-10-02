import assert from 'node:assert/strict'

export function selectRelease(releases, tag, title, notes) {
  const matches = releases.filter(
    (release) => release.tag_name === tag || (release.draft && release.name === title)
  )
  assert(matches.length <= 1, 'Multiple releases match the requested tag or draft title')
  const release = matches[0]
  if (release?.draft) {
    assert(
      release.tag_name === tag || /^untagged-[a-f0-9]+$/u.test(release.tag_name),
      'Draft has an unexpected tag name'
    )
    assert.equal(release.name, title, 'Draft title changed')
    assert.equal(release.body?.trimEnd(), notes.trimEnd(), 'Draft notes changed')
  }
  return release
}

export function selectOrCreateRelease(releases, tag, title, notes, createRelease) {
  const existing = selectRelease(releases, tag, title, notes)
  if (existing) return existing
  // The creation response is authoritative before the release list catches up.
  const created = selectRelease([createRelease()], tag, title, notes)
  assert(created?.draft, 'Creation must return the matching draft')
  return created
}
