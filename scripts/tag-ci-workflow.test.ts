import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

describe('tag CI workflow', () => {
  it('verifies immutable release provenance before dependency installation and platform builds', () => {
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("- '*'")
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('RELEASE_TAG: $' + '{{ github.ref_name }}')
    expect(workflow).toContain('RELEASE_REVISION: $' + '{{ github.sha }}')
    expect(workflow).toContain('node scripts/verify-release-source.mjs')
    expect(workflow).toContain('"--tag=$' + '{RELEASE_TAG}"')
    expect(workflow).toContain('"--revision=$' + '{RELEASE_REVISION}"')

    const verifyIndex = workflow.indexOf('node scripts/verify-release-source.mjs')
    expect(verifyIndex).toBeGreaterThan(workflow.indexOf('name: Static and fixture gate'))
    expect(verifyIndex).toBeLessThan(workflow.indexOf('name: Frozen dependency install'))
    expect(verifyIndex).toBeLessThan(workflow.indexOf('name: Native platform build'))
  })
})
