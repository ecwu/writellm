import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AgentContextSnapshot } from './agent-view-model'
import {
  AgentContextUsageIndicator,
  agentContextUsageDisplay
} from './agent-context-usage-indicator'

const snapshot: AgentContextSnapshot = {
  agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc424',
  used: 115_000,
  estimated: false,
  contextWindowTokens: 258_000,
  percent: (115_000 / 258_000) * 100
}

describe('AgentContextUsageIndicator', () => {
  it('formats the Codex-style used, left, and compact token labels', () => {
    expect(agentContextUsageDisplay(snapshot)).toMatchObject({
      usedPercent: 45,
      leftPercent: 55,
      percentageLabel: '45% used (55% left)',
      tokensLabel: '115k / 258k tokens used'
    })
  })

  it('marks estimated values and clamps percentages above the context window', () => {
    expect(
      agentContextUsageDisplay({
        ...snapshot,
        used: 300_000,
        estimated: true,
        percent: 116.3
      })
    ).toMatchObject({
      usedPercent: 100,
      leftPercent: 0,
      percentageLabel: '~100% used (~0% left)',
      tokensLabel: '~300k / 258k tokens used'
    })
  })

  it('is absent without trustworthy usage and exposes keyboard-readable progress otherwise', () => {
    expect(
      renderToStaticMarkup(
        <TooltipProvider>
          <AgentContextUsageIndicator snapshot={null} />
        </TooltipProvider>
      )
    ).toBe('')

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AgentContextUsageIndicator snapshot={snapshot} />
      </TooltipProvider>
    )
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-label="Context window"')
    expect(html).toContain('aria-valuenow="45"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('115,000 of 258,000 tokens used')
  })
})
