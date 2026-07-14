import type { WebFrameMain } from 'electron'
import { isTrustedRendererUrl } from '../../shared/security/urls'

export { isTrustedRendererUrl } from '../../shared/security/urls'

export function authorizeSender(
  frame: WebFrameMain | null,
  developmentUrl?: string
): asserts frame is WebFrameMain {
  if (frame === null || !isTrustedRendererUrl(frame.url, developmentUrl)) {
    throw new Error('Unauthorized IPC sender')
  }
}
