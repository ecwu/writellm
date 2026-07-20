import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectOpeningIndicator } from './project-opening-indicator'

describe('project opening indicator', () => {
  it('renders an accessible indeterminate spinner without fake progress', () => {
    const html = renderToStaticMarkup(<ProjectOpeningIndicator />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Opening project')
    expect(html).toContain('animate-spin')
    expect(html).not.toContain('role="progressbar"')
    expect(html).not.toMatch(/aria-valuenow|\d+%/)
  })
})
