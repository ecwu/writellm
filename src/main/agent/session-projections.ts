export function extractToolProvenance(data: unknown): {
  citationIds: string[]
  knowledgeItemIds: string[]
  parseRevisionIds: string[]
} {
  if (data === null || typeof data !== 'object') {
    return { citationIds: [], knowledgeItemIds: [], parseRevisionIds: [] }
  }
  const record = data as Record<string, unknown>
  const preview =
    record.preview !== null && typeof record.preview === 'object'
      ? (record.preview as Record<string, unknown>)
      : undefined
  const values = Array.isArray(record.hits)
    ? record.hits
    : Array.isArray(record.citations)
      ? record.citations
      : Array.isArray(preview?.citedSources)
        ? preview.citedSources
        : []
  const entries = values.filter(
    (value): value is Record<string, unknown> => value !== null && typeof value === 'object'
  )
  return {
    citationIds: uniqueStrings(entries.map((entry) => entry.citationId)),
    knowledgeItemIds: uniqueStrings(entries.map((entry) => entry.knowledgeItemId)),
    parseRevisionIds: uniqueStrings(entries.map((entry) => entry.parseRevisionId))
  }
}

export function skillResultProjection(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object') return {}
  const value = data as Record<string, unknown>
  const project = (entry: unknown): Record<string, unknown> | null => {
    if (entry === null || typeof entry !== 'object') return null
    const record = entry as Record<string, unknown>
    return {
      skillId: record.skillId,
      displayName: record.displayName,
      commit: record.commit,
      relativePath: record.relativePath,
      sha256: record.sha256,
      byteSize: record.byteSize
    }
  }
  return {
    ...project(value),
    references: Array.isArray(value.references)
      ? value.references.map(project).filter((entry) => entry !== null)
      : [],
    dependencies: Array.isArray(value.dependencies)
      ? value.dependencies
          .map((entry) => {
            const projected = project(entry)
            if (projected === null) return null
            const record = entry as Record<string, unknown>
            return {
              ...projected,
              references: Array.isArray(record.references)
                ? record.references.map(project).filter((reference) => reference !== null)
                : []
            }
          })
          .filter((entry) => entry !== null)
      : []
  }
}

export function safeSkillActivityProjection(
  uri: string,
  displayName: string
): { displayName: string; relativePath: string } {
  const match = /^writellm:\/\/skills\/[^/]+\/[a-f0-9]{40}\/(.+)$/u.exec(uri)
  const relativePath =
    match?.[1]
      ?.split('/')
      .map((part) => {
        try {
          return decodeURIComponent(part)
        } catch {
          return part
        }
      })
      .join('/') ?? 'SKILL.md'
  return { displayName, relativePath }
}

export function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))].slice(
    0,
    20
  )
}
