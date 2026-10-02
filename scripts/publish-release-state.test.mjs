import assert from 'node:assert/strict'
import { test } from 'vitest'
import { selectRelease, selectOrCreateRelease } from './publish-release-state.mjs'

const tag = 'v0.2026.9.10'
const title = 'WriteLLM 0.2026.9.10'
const notes = 'Release notes\n\nSource: `revision`.\n'

test('resumes a draft whose API tag is an untagged placeholder', () => {
  const draft = { tag_name: 'untagged-2b9971bb4f992d78ed0f', name: title, body: notes, draft: true }
  assert.equal(selectRelease([draft], tag, title, notes), draft)
})

test('finds the published release by its final tag', () => {
  const published = { tag_name: tag, name: title, body: notes, draft: false }
  assert.equal(selectRelease([published], tag, title, notes), published)
})

test('rejects edited or ambiguous drafts before uploading', () => {
  const draft = {
    tag_name: 'untagged-2b9971bb4f992d78ed0f',
    name: title,
    body: 'changed',
    draft: true
  }
  assert.throws(() => selectRelease([draft], tag, title, notes), /Draft notes changed/u)
  assert.throws(
    () => selectRelease([draft, { ...draft, tag_name: tag }], tag, title, notes),
    /Multiple releases/u
  )
})

test('uses the creation response when the release list does not contain the new draft', () => {
  const created = { id: 123, tag_name: tag, name: title, body: notes, draft: true }
  let creations = 0
  assert.equal(
    selectOrCreateRelease([], tag, title, notes, () => {
      creations++
      return created
    }),
    created
  )
  assert.equal(creations, 1)
  assert.equal(
    selectOrCreateRelease([created], tag, title, notes, () => {
      throw new Error('An existing draft must be reused')
    }),
    created
  )
})

test('rejects a creation response that does not match the requested draft', () => {
  const created = { tag_name: tag, name: title, body: notes, draft: false }
  assert.throws(
    () => selectOrCreateRelease([], tag, title, notes, () => created),
    /matching draft/u
  )
  assert.throws(
    () => selectOrCreateRelease([], tag, title, notes, () => ({ ...created, tag_name: 'other' })),
    /matching draft/u
  )
})
