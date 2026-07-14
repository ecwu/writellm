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
        supportFetchAPI: true
      }
    }
  ])
}

export function registerAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const assetPath = resolveRendererAsset(rendererRoot, request.url)
    if (assetPath === null) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(assetPath).toString())
  })
}
