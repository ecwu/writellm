export type ProjectAssetResolver = (input: {
  projectSessionId: string
  assetId: string
}) => Promise<{ url: string }>

export async function resolveProjectAssetUrl(
  url: string,
  projectSessionId: string,
  resolveAsset: ProjectAssetResolver
): Promise<string> {
  if (url === '') return ''
  const result = await resolveAsset({
    projectSessionId,
    assetId: logicalAssetId(url)
  })
  return result.url
}

export function logicalAssetId(url: string): string {
  const match =
    /^writellm-asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
      url
    )
  if (match?.[1] === undefined) throw new Error('Image URL is not a project asset')
  return match[1]
}
