import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ManuscriptBrief, Section } from '../../../../shared/contracts/manuscript'
import { briefTextFields } from './brief-fields'
import {
  briefPreviewGroups,
  MetadataPreview,
  outlinePreviewGroups,
  previewGroupsToText
} from './metadata-preview'

const brief = Object.fromEntries(
  briefTextFields.map(({ key }) => [key, ''])
) as unknown as ManuscriptBrief
const section = (
  sectionId: string,
  parentSectionId: string | null,
  position: number,
  title: string,
  objective: string | null = null,
  status: Section['status'] = 'planned'
): Section => ({ sectionId, parentSectionId, position, title, objective, status }) as Section

describe('metadata preview', () => {
  it('includes all ten fields in form order, excluding internal metadata and extensions', () => {
    const groups = briefPreviewGroups({
      ...brief,
      title: '中文 title',
      extensible: { private: 'hidden' }
    })
    expect(groups[0].fields.map(({ label }) => label)).toEqual([
      'Title',
      'Purpose',
      'Topic and coverage',
      'Audience',
      'Language',
      'Style and tone',
      'Scope and exclusions',
      'Target length',
      'Citation requirements',
      'Additional instructions'
    ])
    expect(previewGroupsToText(groups)).toContain('Title:\n中文 title\n\nPurpose:\n')
    expect(previewGroupsToText(groups)).not.toContain('hidden')
  })
  it('keeps empty field labels in copied text but only displays the empty placeholder', () => {
    const groups = briefPreviewGroups(brief)
    expect(
      renderToStaticMarkup(<MetadataPreview groups={groups} />).match(/Not specified/g)
    ).toHaveLength(10)
    expect(previewGroupsToText(groups)).not.toContain('Not specified')
    expect(previewGroupsToText(groups)).toContain('Purpose:\n\n\nTopic and coverage:')
  })
  it('preserves multiline, Unicode, whitespace and long literal content without parsing HTML', () => {
    const value = `中文\n  **literal** <script>alert(1)</script>\n${'x'.repeat(32_000)}`
    const groups = briefPreviewGroups({ ...brief, description: value })
    expect(previewGroupsToText(groups)).toContain(value)
    const html = renderToStaticMarkup(<MetadataPreview groups={groups} />)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('x'.repeat(32_000))
  })
  it('sorts siblings, numbers complete nested outlines and includes goals and status', () => {
    const groups = outlinePreviewGroups([
      section('b', null, 1, 'Second', '目标\nnext', 'completed'),
      section('a1a', 'a1', 0, 'Grandchild'),
      section('a1', 'a', 0, 'Child', '', 'drafting'),
      section('a', null, 0, 'First')
    ])
    expect(groups.map(({ title }) => title)).toEqual([
      '1 First',
      '1.1 Child',
      '1.1.1 Grandchild',
      '2 Second'
    ])
    expect(previewGroupsToText(groups)).toBe(
      '1 First\n\nObjective:\n\n\nStatus:\nPlanned\n\n1.1 Child\n\nObjective:\n\n\nStatus:\nDrafting\n\n1.1.1 Grandchild\n\nObjective:\n\n\nStatus:\nPlanned\n\n2 Second\n\nObjective:\n目标\nnext\n\nStatus:\nCompleted'
    )
  })
  it('produces no copy payload for an empty outline', () => {
    expect(outlinePreviewGroups([])).toEqual([])
    expect(previewGroupsToText([])).toBe('')
  })
})
