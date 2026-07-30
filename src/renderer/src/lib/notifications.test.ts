import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastError
  }
}))

import { ACTION_ERROR_TOAST_DURATION_MS, notifyActionError } from './notifications'

describe('notifyActionError', () => {
  beforeEach(() => {
    toastError.mockReset()
  })

  it('uses the shared error presentation and eight-second lifetime', () => {
    notifyActionError('Provider sign-in did not complete.')

    expect(ACTION_ERROR_TOAST_DURATION_MS).toBe(8_000)
    expect(toastError).toHaveBeenCalledWith('Action failed', {
      id: 'action-error:Provider sign-in did not complete.',
      description: 'Provider sign-in did not complete.',
      duration: 8_000,
      closeButton: true
    })
  })

  it('reuses a stable id for repeated messages', () => {
    notifyActionError('The provider configuration could not be removed.')
    notifyActionError('The provider configuration could not be removed.')

    expect(toastError.mock.calls.map((call) => call[1]?.id)).toEqual([
      'action-error:The provider configuration could not be removed.',
      'action-error:The provider configuration could not be removed.'
    ])
  })
})
