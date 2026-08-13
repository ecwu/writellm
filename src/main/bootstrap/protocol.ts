import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { APP_SCHEME } from '../../shared/security/urls'
import { resolveRendererAsset } from './protocol-path'

export { APP_SCHEME } from '../../shared/security/urls'
export const PDF_ASSET_SCHEME = 'writellm-pdf-asset'

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    },
    {
      scheme: PDF_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false
      }
    }
  ])
}

export function registerAppProtocol(
  rendererRoot: string,
  resolvePreview?: (request: Request) => Promise<Response | null>
): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const preview = await resolvePreview?.(request)
    if (preview !== undefined && preview !== null) return preview
    const assetPath = resolveRendererAsset(rendererRoot, request.url)
    if (assetPath === null) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(assetPath).toString())
  })
}
