import { describe, expect, it } from 'vitest'
import { workbenchLayoutSchema } from './workbench'
const sectionId = '019d0000-0000-7000-8000-000000000421'
const layout = {
  version: 1,
  tabs: [{ kind: 'section', sectionId }, { kind: 'knowledge' }],
  activeTabId: `section:${sectionId}`,
  tools: null
}
describe('Workbench persistence boundary', () => {
  it('accepts only bounded local presentation state', () => {
    expect(workbenchLayoutSchema.parse(layout)).toEqual(layout)
    for (const extra of [
      { body: 'private' },
      { projectSessionId: sectionId },
      { path: '/private/file' }
    ])
      expect(workbenchLayoutSchema.safeParse({ ...layout, ...extra }).success).toBe(false)
    expect(
      workbenchLayoutSchema.safeParse({
        ...layout,
        tabs: [{ kind: 'notebook', notebookId: sectionId }]
      }).success
    ).toBe(false)
    expect(workbenchLayoutSchema.safeParse({ ...layout, version: 2 }).success).toBe(false)
    expect(
      workbenchLayoutSchema.safeParse({ ...layout, tabs: [...layout.tabs, layout.tabs[0]] }).success
    ).toBe(false)
    expect(workbenchLayoutSchema.safeParse({ ...layout, activeTabId: 'missing' }).success).toBe(
      false
    )
  })
  it('rejects content/tool mixing, duplicate tools and unknown view payloads', () => {
    const tools = {
      root: { type: 'leaf', data: { id: 'main', views: ['content'] } },
      width: 1200,
      height: 800,
      orientation: 'HORIZONTAL'
    }
    expect(workbenchLayoutSchema.safeParse({ ...layout, tools }).success).toBe(true)
    for (const views of [
      ['content', 'agent'],
      ['agent', 'agent'],
      ['content', 'unknown']
    ])
      expect(
        workbenchLayoutSchema.safeParse({
          ...layout,
          tools: { ...tools, root: { ...tools.root, data: { id: 'main', views } } }
        }).success
      ).toBe(false)
  })
})
