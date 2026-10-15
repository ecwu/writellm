import { afterEach, expect, it, vi } from 'vitest'
import { manuscriptFailureMessage, reportRendererOperationError } from './diagnostics'

afterEach(() => vi.unstubAllGlobals())

it('preserves a bounded local cause chain without private paths or credentials', () => {
  const reportRendererError = vi.fn()
  vi.stubGlobal('window', { desktop: { diagnostics: { reportRendererError } } })
  const original = new Error('Clipboard unavailable', {
    cause: new Error('API_KEY=secret at /private/document.md')
  })
  reportRendererOperationError(original, 'renderer.copy')
  expect(reportRendererError).toHaveBeenCalledOnce()
  expect(reportRendererError.mock.calls[0]?.[0]).toMatchObject({
    source: 'renderer.copy',
    diagnostic: {
      message: 'Clipboard unavailable',
      causes: [expect.objectContaining({ name: 'Error' })]
    }
  })
  expect(JSON.stringify(reportRendererError.mock.calls)).not.toContain('API_KEY=secret')
  expect(JSON.stringify(reportRendererError.mock.calls)).not.toContain('/private/document.md')
})

it('leaves native IPC rejection reporting to Main', () => {
  const reportRendererError = vi.fn()
  vi.stubGlobal('window', { desktop: { diagnostics: { reportRendererError } } })
  reportRendererOperationError(
    new Error("Error invoking remote method 'editor:save': Error: Conflict"),
    'renderer.save'
  )
  expect(reportRendererError).not.toHaveBeenCalled()
})

it('keeps UI recovery independent from a failed diagnostic channel', () => {
  vi.stubGlobal('window', {
    desktop: {
      diagnostics: {
        reportRendererError: () => {
          throw new Error('Channel closed')
        }
      }
    }
  })
  expect(() =>
    reportRendererOperationError(new Error('Local failure'), 'renderer.local')
  ).not.toThrow()
})

it('shows a conflict hint only for a Main version rejection and retains the safe fallback for other failures', () => {
  const message =
    "Error invoking remote method 'manuscript:update-section': Error: [outline_version_conflict] The manuscript outline has changed"
  expect(manuscriptFailureMessage(new Error(message), 'Update failed')).toBe(
    'The manuscript changed elsewhere. Refresh and try again.'
  )
  expect(manuscriptFailureMessage(new Error('Disk failed'), 'Update failed')).toBe('Update failed')
})
