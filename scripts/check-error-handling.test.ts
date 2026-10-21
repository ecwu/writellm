import { describe, expect, it } from 'vitest'
import { scanSourceText } from './check-error-handling.mjs'

describe('error-handling guard', () => {
  it('rejects a mutation that swallows a rejected Promise', () => {
    const findings = scanSourceText(
      `async function run(task: Promise<void>) {
  await task.catch(() => undefined)
}`,
      'mutation.ts'
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      filePath: 'mutation.ts',
      kind: 'swallowed-promise',
      line: 2
    })
  })

  it('accepts an explicitly owned Promise rejection with a documented cause', () => {
    const findings = scanSourceText(
      `async function run(task: Promise<void>) {
  // error-handling: allow owner=queue cause=previous-failure-is-recovered
  await task.catch(() => undefined)
}`,
      'documented.ts'
    )

    expect(findings).toEqual([])
  })

  it('requires the same marker for an empty catch and ignores comments and strings', () => {
    const findings = scanSourceText(
      `const text = 'catch {} .catch(() => undefined)'
// catch {}
try {
  work()
} catch {}
try {
  parse()
}
// error-handling: allow owner=parser cause=invalid-input-is-reported
catch { /* safe parser fallback */ }`,
      'parser.ts'
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'empty-catch', line: 5 })
  })

  it('scans template expressions while ignoring regex text', () => {
    const findings = scanSourceText(
      [
        String.raw`const pattern = /\.catch\(\(\) => undefined\)/u`,
        'const rendered = `$' + '{task.catch(() => undefined)}`'
      ].join('\n'),
      'template.ts'
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'swallowed-promise', line: 2 })
  })

  it('keeps executable expressions after JSX closing tags visible', () => {
    const findings = scanSourceText(
      'const el = <><div>text</div>{promise.catch(() => undefined)}</>',
      'jsx.tsx'
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'swallowed-promise', line: 1 })
  })

  it('does not treat a less-than regex literal as a JSX closing tag', () => {
    const findings = scanSourceText(
      'const result = value </div>.catch(() => undefined)/u.test(value)',
      'regex.ts'
    )

    expect(findings).toEqual([])
  })

  it('keeps nested template expressions visible while ignoring their regex literals', () => {
    const findings = scanSourceText(
      [
        'const el = <><div>text</div>{',
        '  `nested $' +
          '{/\\.catch\\(\\(\\) => undefined\\)/u.test(value) ? promise.catch(() => undefined) : Promise.resolve()}`',
        '}</>'
      ].join('\n'),
      'nested-jsx.tsx'
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'swallowed-promise', line: 2 })
  })
})
