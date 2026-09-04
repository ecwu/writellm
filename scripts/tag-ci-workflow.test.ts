import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

describe('tag CI workflow', () => {
  it('keeps tag-only four-platform builds and retains failed-stage timing artifacts', () => {
    const config = parse(workflow)
    expect(config.on).toEqual({ push: { tags: ['*'] } })
    expect(config.jobs.platform.strategy.matrix.include.map((entry) => entry.target)).toEqual([
      'windows-x64',
      'macos-arm64',
      'macos-x64',
      'linux-x64'
    ])
    expect(
      config.jobs.platform.steps.find((step) => step.name === 'Native platform build').run
    ).toBe('pnpm package --target=$' + '{{ matrix.target }}')
    const upload = config.jobs.platform.steps.find(
      (step) => step.name === 'Upload verification timings'
    )
    expect(upload.if).toBe('always()')
    expect(upload.with['include-hidden-files']).toBe(true)
    expect(config.jobs.timing.needs).toEqual(['static', 'platform'])
    expect(config.jobs.timing.permissions.actions).toBe('read')
  })
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
