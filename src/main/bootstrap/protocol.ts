import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { APP_SCHEME } from '../../shared/security/urls'
import { resolveRendererAsset } from './protocol-path'

export { APP_SCHEME } from '../../shared/security/urls'

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
    }
  ])
}

export function registerAppProtocol(
  rendererRoot: string,
  resolvePreview?: (request: Request) => Promise<Response | null>
): void {
  protocol.handle(APP_SCHEME, (request) => {
    if (resolvePreview !== undefined && request.url.includes('/project-pdf/')) {
      return resolvePreview(request).then(
        (response) => response ?? new Response('Not found', { status: 404 })
      )
    }
    const assetPath = resolveRendererAsset(rendererRoot, request.url)
    if (assetPath === null) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(assetPath).toString())
  })
}
