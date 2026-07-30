import { createHash } from 'node:crypto'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const logoDirectory = resolve(root, 'src/renderer/src/assets/provider-logos')
const manifestPath = resolve(root, 'src/shared/models-dev-provider-logos.generated.ts')
const catalogUrl = 'https://models.dev/api.json'
const logoBaseUrl = 'https://models.dev/logos'
const maximumCatalogBytes = 16 * 1_024 * 1_024
const maximumLogoBytes = 100 * 1_024
const providerIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/

const forbiddenSvgPatterns = [
  /<!doctype/i,
  /<!entity/i,
  /<script[\s>]/i,
  /<foreignObject[\s>]/i,
  /<(?:iframe|object|embed|image|audio|video)[\s>]/i,
  /<style[\s>]/i,
  /\son[a-z0-9:_-]*\s*=/i,
  /\s(?:href|xlink:href)\s*=\s*["'](?!#)/i,
  /url\(\s*["']?(?!#)/i
]

const catalogResponse = await fetch(catalogUrl, {
  headers: { accept: 'application/json' },
  redirect: 'error'
})
if (!catalogResponse.ok) {
  throw new Error(`models.dev catalog returned HTTP ${catalogResponse.status}`)
}
const catalogText = await readBoundedText(catalogResponse, maximumCatalogBytes)
const catalog = JSON.parse(catalogText)
if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
  throw new Error('models.dev catalog is not an object')
}

const defaultLogo = await fetchLogo('__writellm_missing_provider__')
const defaultLogoHash = sha256(defaultLogo)
const skipped = []
const entries = []

await mkdir(logoDirectory, { recursive: true })
for (const filename of await readdir(logoDirectory)) {
  if (filename.endsWith('.svg')) await unlink(resolve(logoDirectory, filename))
}

const providers = Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right))
for (const [catalogKey, rawProvider] of providers) {
  const provider = parseProvider(catalogKey, rawProvider)
  if (provider === null) {
    skipped.push({ id: catalogKey, reason: 'invalid provider metadata' })
    continue
  }
  try {
    const svg = await fetchLogo(provider.id)
    const hash = sha256(svg)
    if (hash === defaultLogoHash) {
      skipped.push({ id: provider.id, reason: 'default logo' })
      continue
    }
    validateSvg(svg)
    await writeFile(resolve(logoDirectory, `${provider.id}.svg`), `${svg.trim()}\n`, 'utf8')
    entries.push({ ...provider, sha256: hash })
  } catch (error) {
    skipped.push({
      id: provider.id,
      reason: error instanceof Error ? error.message : 'unknown logo error'
    })
  }
}

const generatedAt = new Date().toISOString()
await writeFile(manifestPath, generatedModule(entries, generatedAt), 'utf8')
process.stdout.write(
  `${JSON.stringify({ generatedAt, included: entries.length, skipped }, null, 2)}\n`
)

async function fetchLogo(providerId) {
  const response = await fetch(`${logoBaseUrl}/${encodeURIComponent(providerId)}.svg`, {
    headers: { accept: 'image/svg+xml' },
    redirect: 'error'
  })
  if (!response.ok) throw new Error(`logo returned HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('image/svg+xml')) {
    throw new Error(`unexpected logo content type: ${contentType || 'missing'}`)
  }
  return readBoundedText(response, maximumLogoBytes)
}

async function readBoundedText(response, maximumBytes) {
  if (response.body === null) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maximumBytes) throw new Error('response is too large')
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      throw new Error('response is too large')
    }
    chunks.push(value)
  }
  const combined = Buffer.alloc(total)
  let offset = 0
  for (const chunk of chunks) {
    Buffer.from(chunk).copy(combined, offset)
    offset += chunk.byteLength
  }
  return combined.toString('utf8')
}

function parseProvider(catalogKey, value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.id !== 'string' ||
    value.id !== catalogKey ||
    !providerIdPattern.test(value.id) ||
    typeof value.name !== 'string' ||
    value.name.trim() === '' ||
    value.name.length > 200
  ) {
    return null
  }
  let api = null
  if (value.api !== undefined) {
    if (typeof value.api !== 'string' || value.api.length > 2_048) return null
    if (value.api.includes('${')) return { id: value.id, name: value.name.trim(), api }
    try {
      const parsed = new URL(value.api)
      if (parsed.protocol === 'https:') api = normalizeUrl(parsed)
    } catch {
      api = null
    }
  }
  return { id: value.id, name: value.name.trim(), api }
}

function validateSvg(svg) {
  if (Buffer.byteLength(svg) > maximumLogoBytes) throw new Error('logo is too large')
  if (!/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    throw new Error('logo does not contain one SVG root')
  }
  const forbidden = forbiddenSvgPatterns.find((pattern) => pattern.test(svg))
  if (forbidden !== undefined) throw new Error(`logo contains forbidden SVG markup: ${forbidden}`)
}

function normalizeUrl(url) {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  return `${url.origin}${path}`
}

function sha256(value) {
  return createHash('sha256').update(value.trim()).digest('hex')
}

function generatedModule(entries, generatedAt) {
  return `// Generated by scripts/sync-models-dev-logos.mjs. Do not edit by hand.
// Source: ${catalogUrl} and ${logoBaseUrl}/{provider}.svg

export const MODELS_DEV_PROVIDER_LOGO_GENERATED_AT = ${JSON.stringify(generatedAt)}

export const MODELS_DEV_PROVIDER_LOGOS = ${JSON.stringify(entries, null, 2)} as const

export type ModelsDevProviderLogoId = (typeof MODELS_DEV_PROVIDER_LOGOS)[number]['id']
`
}
