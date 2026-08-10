import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentThinkingPicker, thinkingLevelLabel } from './agent-thinking-picker'

describe('AgentThinkingPicker', () => {
  it('renders a disabled Off control when the model exposes no reasoning capability', () => {
    const html = renderToStaticMarkup(
      <AgentThinkingPicker levels={['off']} value='off' disabled={false} onSelect={vi.fn()} />
    )

    expect(html).toContain('aria-label="Thinking level: Off"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Thinking controls are unavailable for this model')
  })

  it('keeps a supported Thinking control enabled and uses human-readable labels', () => {
    const html = renderToStaticMarkup(
      <AgentThinkingPicker
        levels={['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']}
        value='xhigh'
        disabled={false}
        onSelect={vi.fn()}
      />
    )

    expect(html).toContain('aria-label="Thinking level: Extra high"')
    expect(html).not.toContain('disabled=""')
    expect(thinkingLevelLabel('minimal')).toBe('Minimal')
    expect(thinkingLevelLabel('max')).toBe('Max')
  })
})
