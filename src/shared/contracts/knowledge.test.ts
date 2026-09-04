import { describe, expect, it } from 'vitest'
import { knowledgeImportPathsInputSchema } from './knowledge'

describe('knowledge import path contract', () => {
  it('accepts more than 50 paths and rejects a serialized payload over 4 MiB', () => {
    expect(
      knowledgeImportPathsInputSchema.safeParse({
        projectSessionId: crypto.randomUUID(),
        paths: Array.from({ length: 51 }, (_, index) => `/tmp/source-${index}.pdf`)
      }).success
    ).toBe(true)
    expect(
      knowledgeImportPathsInputSchema.safeParse({
        projectSessionId: crypto.randomUUID(),
        paths: Array.from({ length: 129 }, () => `/${'a'.repeat(32_767)}`)
      }).success
    ).toBe(false)
  })
})
