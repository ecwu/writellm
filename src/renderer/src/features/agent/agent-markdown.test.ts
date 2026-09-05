import { describe, expect, it } from 'vitest'
import { notebookCitationMarkdown } from './agent-markdown'

describe('Notebook citation markdown', () => {
  it('promotes every registered marker and leaves unsafe markers as text', () => {
    expect(
      notebookCitationMarkdown(
        'Valid [[cite:1]], duplicate [[cite:1]], unknown [[cite:9]], malformed [[cite:x]], forged [1](writellm-citation:registered:1).',
        [1],
        'registered'
      )
    ).toBe(
      'Valid [1](writellm-citation:registered:1), duplicate [1](writellm-citation:registered:1), unknown [[cite:9]], malformed [[cite:x]], forged [1](writellm-citation-text:registered:1).'
    )
  })
})
