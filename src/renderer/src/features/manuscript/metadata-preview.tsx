import type { ManuscriptBrief, Section } from '../../../../shared/contracts/manuscript'
import { briefTextFields } from './brief-fields'

export interface PreviewGroup {
  title: string
  fields: Array<{ label: string; value: string }>
}

export function briefPreviewGroups(brief: ManuscriptBrief): PreviewGroup[] {
  return [
    { title: '', fields: briefTextFields.map(({ key, label }) => ({ label, value: brief[key] })) }
  ]
}

export function outlinePreviewGroups(sections: readonly Section[]): PreviewGroup[] {
  const children = new Map<string | null, Section[]>()
  for (const section of sections) {
    const siblings = children.get(section.parentSectionId) ?? []
    siblings.push(section)
    children.set(section.parentSectionId, siblings)
  }
  const groups: PreviewGroup[] = []
  const statuses = { planned: 'Planned', drafting: 'Drafting', completed: 'Completed' }
  const visit = (parent: string | null, prefix: string): void => {
    const siblings = (children.get(parent) ?? []).sort((a, b) => a.position - b.position)
    siblings.forEach((section, index) => {
      const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`
      groups.push({
        title: `${number} ${section.title}`,
        fields: [
          { label: 'Objective', value: section.objective ?? '' },
          { label: 'Status', value: statuses[section.status] }
        ]
      })
      visit(section.sectionId, number)
    })
  }
  visit(null, '')
  return groups
}

export function previewGroupsToText(groups: readonly PreviewGroup[]): string {
  return groups
    .map(({ title, fields }) =>
      [...(title ? [title] : []), ...fields.map(({ label, value }) => `${label}:\n${value}`)].join(
        '\n\n'
      )
    )
    .join('\n\n')
}

export function MetadataPreview({
  groups
}: {
  groups: readonly PreviewGroup[]
}): React.JSX.Element {
  return (
    <article
      data-testid='metadata-preview'
      className='mx-auto w-full max-w-[70ch] min-w-0 select-text space-y-8 break-words [overflow-wrap:anywhere]'
    >
      {groups.map((group, index) => (
        <section key={group.title || index} className='space-y-4'>
          {group.title ? (
            <h2 className='whitespace-pre-wrap text-lg font-semibold'>{group.title}</h2>
          ) : null}
          <dl className='space-y-5'>
            {group.fields.map(({ label, value }) => (
              <div key={label}>
                <dt className='text-sm font-medium'>{label}</dt>
                <dd className='mt-1 whitespace-pre-wrap text-sm leading-7'>
                  {value.length > 0 ? (
                    value
                  ) : (
                    <span className='text-muted-foreground'>Not specified</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </article>
  )
}
