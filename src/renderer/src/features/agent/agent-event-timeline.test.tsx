import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentPreflightFailure, AgentToolActivity } from './agent-view-model'
import {
  AgentDiagnosticDetails,
  CompactionFailureMessage,
  PreflightFailureMessage,
  ToolActivityRow
} from './agent-event-timeline'

const preflightMessage = 'Expected operations; received a missing field.'

const preflightDiagnostic = {
  schemaVersion: 1 as const,
  stage: 'tool.preflight',
  name: 'ZodError',
  message: preflightMessage,
  code: 'invalid_arguments',
  causes: [
    {
      name: 'ZodIssue',
      message: 'Required field operations is missing.'
    }
  ],
  stack: 'ZodError: Expected operations; received a missing field.\n    at preflight.ts:12:3'
}

const failure: AgentPreflightFailure = {
  toolName: 'submit_section_change',
  code: 'invalid_arguments',
  message: preflightMessage,
  details: preflightDiagnostic,
  paths: ['/operations/1', '/operations/1/type'],
  durationMs: 0
}

describe('PreflightFailureMessage', () => {
  it('shows the concrete preflight message in the collapsed marker', () => {
    const html = renderToStaticMarkup(<PreflightFailureMessage failure={failure} />)

    expect(html).toContain(failure.message)
    expect(html).toContain('data-state="closed"')
    expect(html).not.toContain('Tool execution failed')
    expect(html).not.toContain('Show diagnostic details')
    expect(html).not.toContain('/operations/1/type')
  })

  it('expands the bounded diagnostic with cause and stack details', () => {
    const html = renderToStaticMarkup(<PreflightFailureMessage failure={failure} defaultOpen />)

    expect(html).toContain('data-state="open"')
    expect(html).toContain(failure.toolName)
    expect(html).toContain(failure.code)
    expect(html).toContain(failure.message)
    expect(html).toContain('Show diagnostic details')
    expect(html).toContain(preflightDiagnostic.stage)
    expect(html).toContain(preflightDiagnostic.causes[0].message)
    expect(html).toContain(preflightDiagnostic.stack)
    expect(html).toContain('/operations/1/type')
    expect(html).toContain('Failed before dispatch · 0s')
  })
})

const compactionDiagnostic = {
  schemaVersion: 1 as const,
  stage: 'compaction.summary',
  name: 'ProviderError',
  message: 'The summary provider returned HTTP 503.',
  code: 'provider_unavailable',
  httpStatus: 503,
  causes: [{ name: 'HttpError', message: 'Service unavailable.' }],
  stack: 'ProviderError: The summary provider returned HTTP 503.\n    at compact.ts:18:5'
}

const compactionPayload = {
  schemaVersion: 2 as const,
  compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc501',
  trigger: 'manual' as const,
  code: 'compaction_failed',
  retryable: true,
  aborted: false,
  diagnostic: compactionDiagnostic,
  timestamp: 1
}
const legacyCompactionPayload = {
  schemaVersion: compactionPayload.schemaVersion,
  compactionId: compactionPayload.compactionId,
  trigger: compactionPayload.trigger,
  code: compactionPayload.code,
  retryable: compactionPayload.retryable,
  aborted: compactionPayload.aborted,
  timestamp: compactionPayload.timestamp
}

describe('CompactionFailureMessage', () => {
  it('shows the concrete diagnostic and keeps its details expandable', () => {
    const html = renderToStaticMarkup(
      <CompactionFailureMessage payload={compactionPayload} onNew={() => undefined} />
    )

    expect(html).toContain(compactionDiagnostic.message)
    expect(html).toContain('original history preserved')
    expect(html).toContain('Show diagnostic details')
    expect(html).toContain('data-testid="agent-diagnostic-details"')
  })

  it('keeps the historical fallback for payloads without a diagnostic', () => {
    const html = renderToStaticMarkup(
      <CompactionFailureMessage payload={legacyCompactionPayload} onNew={() => undefined} />
    )

    expect(html).toContain('Conversation summary failed')
    expect(html).not.toContain('Show diagnostic details')
    expect(html).not.toContain(compactionDiagnostic.message)
  })
})

const diagnostic = {
  schemaVersion: 1 as const,
  stage: 'provider.request',
  name: 'ProviderError',
  message: 'The provider returned a concrete diagnostic.',
  code: 'provider_timeout',
  httpStatus: 504,
  causes: [
    {
      name: 'TimeoutError',
      message: 'The upstream request timed out.'
    }
  ],
  stack: 'ProviderError: The provider returned a concrete diagnostic.'
}

const failedTool: AgentToolActivity = {
  eventId: '019c6a5c-8d34-7a8e-a602-3d37a52dc501',
  runId: null,
  call: {
    toolCallId: 'tool-diagnostic',
    toolName: 'read_section',
    contractVersion: 1,
    args: {},
    timestamp: 1
  },
  result: {
    toolCallId: 'tool-diagnostic',
    toolName: 'read_section',
    contractVersion: 1,
    isError: true,
    result: null,
    error: {
      code: 'internal',
      category: 'internal',
      message: diagnostic.message,
      details: diagnostic
    },
    citationIds: [],
    knowledgeItemIds: [],
    parseRevisionIds: [],
    timestamp: 2
  },
  durationMs: 1,
  stopped: false
}

describe('Agent diagnostics', () => {
  it('keeps the concrete tool message visible and makes safe details expandable', () => {
    const html = renderToStaticMarkup(<ToolActivityRow tool={failedTool} stopped={false} />)

    expect(html).toContain(diagnostic.message)
    expect(html).toContain('Show diagnostic details')
    expect(html).toContain('data-state="closed"')
    expect(html).not.toContain('at most 1 retry')
  })

  it('renders stage, code, causes, status, and redacted stack when expanded', () => {
    const html = renderToStaticMarkup(
      <AgentDiagnosticDetails diagnostic={diagnostic} defaultOpen />
    )

    expect(html).toContain('data-state="open"')
    expect(html).toContain('provider.request')
    expect(html).toContain('provider_timeout')
    expect(html).toContain('>504<')
    expect(html).toContain('TimeoutError: The upstream request timed out.')
    expect(html).toContain(diagnostic.stack)
  })
})
