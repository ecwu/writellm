import type { ManuscriptAssembly, Section } from '../../shared/contracts/manuscript'
import type { ParsedManuscriptSearchInput } from '../../shared/contracts/manuscript-search'
import type { SearchableSection } from '../../shared/manuscript-search'

export function selectSearchableSections(
  assembly: ManuscriptAssembly,
  input: Pick<ParsedManuscriptSearchInput, 'scope' | 'statuses'>
): SearchableSection[] {
  const sections = assembly.sections.filter(({ section }) => {
    if (input.statuses.length > 0 && !input.statuses.includes(section.status)) return false
    if (input.scope.type === 'manuscript') return true
    if (input.scope.type === 'sections') return input.scope.sectionIds.includes(section.sectionId)
    let current: Section | undefined = section
    while (current !== undefined) {
      if (current.sectionId === input.scope.rootSectionId) return true
      current = assembly.sections.find(
        (entry) => entry.section.sectionId === current?.parentSectionId
      )?.section
    }
    return false
  })
  return sections.map(toSearchable)
}

export function toSearchable(entry: ManuscriptAssembly['sections'][number]): SearchableSection {
  return {
    sectionId: entry.section.sectionId,
    revisionId: entry.revision.sectionRevisionId,
    title: entry.section.title,
    objective: entry.section.objective,
    status: entry.section.status,
    content: entry.revision.content
  }
}

export function manuscriptHeadingPath(assembly: ManuscriptAssembly, section: Section): string[] {
  const path: string[] = []
  let current: Section | undefined = section
  while (current !== undefined) {
    path.unshift(current.title)
    current = assembly.sections.find(
      (entry) => entry.section.sectionId === current?.parentSectionId
    )?.section
  }
  return path
}
