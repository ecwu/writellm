export const APP_SCHEME = 'writellm'
export const APP_HOST = 'bundle'
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`

export function isApplicationUrl(url: string): boolean {
  if (!URL.canParse(url)) return false
  const candidate = new URL(url)
  return (
    candidate.protocol === `${APP_SCHEME}:` &&
    candidate.hostname === APP_HOST &&
    candidate.port === ''
  )
}

export function isTrustedRendererUrl(url: string, developmentUrl?: string): boolean {
  if (isApplicationUrl(url)) return true

  return (
    developmentUrl !== undefined &&
    URL.canParse(url) &&
    URL.canParse(developmentUrl) &&
    new URL(url).origin === new URL(developmentUrl).origin
  )
}

export function isAllowedExternalUrl(url: string): boolean {
  if (!URL.canParse(url)) return false
  const protocol = new URL(url).protocol
  return protocol === 'https:' || protocol === 'http:'
}
