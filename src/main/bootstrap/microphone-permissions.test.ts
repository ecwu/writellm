import { describe, expect, it, vi } from 'vitest'
import { allowWindowPermission, prepareMicrophoneAccess } from './microphone-permissions'
const trusted = {
  trustedWindow: true,
  isMainFrame: true,
  requestingUrl: 'writellm://bundle/',
  permission: 'media',
  mediaTypes: ['audio']
}
describe('microphone permissions', () => {
  it('allows audio only for the trusted top-level window', () => {
    expect(allowWindowPermission(trusted)).toBe(true)
    for (const override of [
      { trustedWindow: false },
      { isMainFrame: false },
      { requestingUrl: 'https://evil.example' },
      { mediaTypes: ['video'] },
      { mediaTypes: ['audio', 'video'] },
      { mediaTypes: [] },
      { mediaTypes: undefined },
      { permission: 'display-capture' },
      { permission: 'clipboard-read' }
    ])
      expect(allowWindowPermission({ ...trusted, ...override })).toBe(false)
  })
  it('preserves explicit clipboard and fullscreen rules, denying unknown permissions', () => {
    for (const permission of [
      'clipboard-sanitized-write',
      'deprecated-sync-clipboard-read',
      'fullscreen'
    ]) {
      expect(allowWindowPermission({ ...trusted, permission, mediaTypes: undefined })).toBe(true)
      expect(allowWindowPermission({ ...trusted, permission, isMainFrame: false })).toBe(false)
    }
    expect(allowWindowPermission({ ...trusted, permission: 'notifications' })).toBe(false)
  })
  it('accepts the configured development origin only', () => {
    expect(
      allowWindowPermission({
        ...trusted,
        requestingUrl: 'http://localhost:5173/',
        developmentUrl: 'http://localhost:5173'
      })
    ).toBe(true)
    expect(
      allowWindowPermission({
        ...trusted,
        requestingUrl: 'http://localhost:5174/',
        developmentUrl: 'http://localhost:5173'
      })
    ).toBe(false)
  })
  it('asks once only when undetermined and rechecks the returned status', async () => {
    const getMediaAccessStatus = vi
      .fn()
      .mockReturnValueOnce('not-determined')
      .mockReturnValue('granted')
    const askForMediaAccess = vi.fn(async () => true)
    await prepareMicrophoneAccess('darwin', { getMediaAccessStatus, askForMediaAccess })
    expect(getMediaAccessStatus).toHaveBeenCalledTimes(2)
    expect(askForMediaAccess).toHaveBeenCalledExactlyOnceWith('microphone')
  })
  it('does not repeatedly prompt when denied/restricted and rechecks on next attempt', async () => {
    for (const status of ['denied', 'restricted']) {
      const preferences = {
        getMediaAccessStatus: vi.fn().mockReturnValue(status),
        askForMediaAccess: vi.fn()
      }
      await expect(prepareMicrophoneAccess('darwin', preferences)).rejects.toThrow(
        'System Settings'
      )
      expect(preferences.askForMediaAccess).not.toHaveBeenCalled()
      preferences.getMediaAccessStatus.mockReturnValue('granted')
      await expect(prepareMicrophoneAccess('darwin', preferences)).resolves.toBeUndefined()
    }
  })
})
