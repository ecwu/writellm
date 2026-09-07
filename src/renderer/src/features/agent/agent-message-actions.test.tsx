import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MessageCopyButton, MessageEditButton, MessageEditor } from './agent-message-actions'

describe('Agent message actions', () => {
  it('offers an accessible copy button without placing private text in the button label', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <MessageCopyButton content={'**Private**\nBody'} />
      </TooltipProvider>
    )
    expect(html).toContain('aria-label="Copy message"')
    expect(html).not.toContain('Private')
    expect(html).toContain('role="status"')
  })
  it('keeps an unavailable edit action focusable with an explicit disabled state', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <MessageEditButton reason='Stop the Agent before editing.' onEdit={() => undefined} />
      </TooltipProvider>
    )
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-label="Edit message"')
  })
  it.each(['', '   \n', 'Message'])(
    'retains the draft and disables saving when it is empty or blocked: %j',
    (content) => {
      const html = renderToStaticMarkup(
        <MessageEditor
          content={content}
          busy={false}
          reason='Project content was changed.'
          onCancel={() => undefined}
          onSave={async () => false}
        />
      )
      expect(html).toContain('aria-label="Edit sent message"')
      expect(html).toContain('Project content was changed.')
      expect(html).toMatch(/disabled=""[^>]*>Save and restart/)
      expect(html).toContain('>Cancel<')
    }
  )
  it('uses a multiline editor and preserves Markdown and line breaks', () => {
    const html = renderToStaticMarkup(
      <MessageEditor
        content={'**Heading**\nSecond line'}
        busy={false}
        reason={null}
        onCancel={() => undefined}
        onSave={async () => true}
      />
    )
    expect(html).toContain('**Heading**\nSecond line')
    expect(html).toContain('maxLength="262144"')
    expect(html).not.toContain('disabled=""')
  })
})
