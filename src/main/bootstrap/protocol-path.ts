import { isAbsolute, relative, resolve } from 'node:path'
import { isApplicationUrl } from '../../shared/security/urls'

export function resolveRendererAsset(rendererRoot: string, requestUrl: string): string | null {
  if (!isApplicationUrl(requestUrl)) return null
  const rawPathStart = requestUrl.indexOf('/', requestUrl.indexOf('://') + 3)
  const rawPath = rawPathStart === -1 ? '/' : requestUrl.slice(rawPathStart).split(/[?#]/, 1)[0]
  if (/%(?![0-9a-f]{2})/i.test(rawPath)) return null
  const decodedRawPath = decodeURIComponent(rawPath)

  if (
    decodedRawPath.includes('\\') ||
    decodedRawPath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return null
  }

  const url = new URL(requestUrl)
  const pathname = decodeURIComponent(url.pathname)
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1)
  const absolutePath = resolve(rendererRoot, requestedPath)
  const relativePath = relative(rendererRoot, absolutePath)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return absolutePath
}
