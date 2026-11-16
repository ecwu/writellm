import { SpeechFailure } from '../../shared/speech-errors'
import { systemPreferences, type BrowserWindow } from 'electron'
import { isTrustedRendererUrl } from '../../shared/security/urls'

const existingPermissions = new Set([
  'clipboard-sanitized-write',
  'deprecated-sync-clipboard-read',
  'fullscreen'
])
export function allowWindowPermission(input: {
  trustedWindow: boolean
  isMainFrame: boolean
  requestingUrl: string | undefined
  permission: string
  mediaTypes?: readonly string[]
  developmentUrl?: string
}): boolean {
  if (
    !input.trustedWindow ||
    !input.isMainFrame ||
    input.requestingUrl === undefined ||
    !isTrustedRendererUrl(input.requestingUrl, input.developmentUrl)
  )
    return false
  if (input.permission === 'media')
    return input.mediaTypes?.length === 1 && input.mediaTypes[0] === 'audio'
  return existingPermissions.has(input.permission)
}
export function installWindowPermissions(window: BrowserWindow, developmentUrl?: string): void {
  const session = window.webContents.session
  session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowWindowPermission({
      trustedWindow: contents === window.webContents && !window.isDestroyed(),
      isMainFrame: details.isMainFrame,
      requestingUrl: details.requestingUrl,
      permission,
      mediaTypes: details.mediaType === undefined ? undefined : [details.mediaType],
      developmentUrl
    })
  )
  session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      allowWindowPermission({
        trustedWindow: contents === window.webContents && !window.isDestroyed(),
        isMainFrame: details.isMainFrame,
        requestingUrl: details.requestingUrl,
        permission,
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
        developmentUrl
      })
    )
  )
}
export async function prepareMicrophoneAccess(
  platform = process.platform,
  preferences: Pick<
    typeof systemPreferences,
    'getMediaAccessStatus' | 'askForMediaAccess'
  > = systemPreferences
): Promise<void> {
  if (platform !== 'darwin') return
  let status = preferences.getMediaAccessStatus('microphone')
  if (status === 'not-determined') {
    await preferences.askForMediaAccess('microphone')
    status = preferences.getMediaAccessStatus('microphone')
  }
  if (status !== 'granted')
    throw new SpeechFailure(
      'Microphone access is blocked. Enable WriteLLM in System Settings → Privacy & Security → Microphone.'
    )
}
