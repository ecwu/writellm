import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentPreflightFailure } from './agent-view-model'
import { PreflightFailureMessage } from './agent-event-timeline'

const failure: AgentPreflightFailure = {
  toolName: 'submit_section_change',
  code: 'invalid_arguments',
  message:
    'Arguments for submit_section_change failed preflight at /operations/1/type. Fix the named fields and retry once.',
  paths: ['/operations/1', '/operations/1/type'],
  durationMs: 0
}

describe('PreflightFailureMessage', () => {
  it('keeps non-blocking tool failures to one quiet line by default', () => {
    const html = renderToStaticMarkup(<PreflightFailureMessage failure={failure} />)

    expect(html).toContain('Tool execution failed')
    expect(html).toContain('data-state="closed"')
    expect(html).not.toContain(failure.message)
    expect(html).not.toContain('/operations/1/type')
  })

  it('keeps the bounded diagnostic available when expanded', () => {
    const html = renderToStaticMarkup(<PreflightFailureMessage failure={failure} defaultOpen />)

    expect(html).toContain('data-state="open"')
    expect(html).toContain(failure.toolName)
    expect(html).toContain(failure.code)
    expect(html).toContain(failure.message)
    expect(html).toContain('/operations/1/type')
    expect(html).toContain('Failed before dispatch · 0s')
  })
})
