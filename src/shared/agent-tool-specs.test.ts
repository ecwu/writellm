import { describe, expect, it } from 'vitest'
import {
  activeAgentToolSetAllows,
  agentModelVisibleToolSpecs,
  WRITING_CORE_TOOL_NAMES,
  WRITING_TOOL_GROUP_TOOL_NAMES
} from './agent-tool-specs'

const names = (
  mode: 'ask' | 'plan' | 'write',
  groups: Parameters<typeof agentModelVisibleToolSpecs>[1] = []
) => agentModelVisibleToolSpecs('writing', groups, mode).map((tool) => tool.name)

describe('Agent interaction ModePolicy', () => {
  it('advertises only the read-only Ask ceiling', () => {
    expect(names('ask').toSorted()).toEqual(
      [
        'get_writing_context',
        'read_outline',
        'read_section',
        'search_manuscript',
        'search_knowledge',
        'read_citations'
      ].toSorted()
    )
    expect(names('ask', ['section', 'image', 'review'])).toEqual(names('ask'))
    expect(activeAgentToolSetAllows('writing', ['section'], 'submit_section_change', 'ask')).toBe(
      false
    )
  })

  it('adds planning metadata and read-only review tools without mutation authority', () => {
    expect(names('plan').toSorted()).toEqual(
      [
        'get_writing_context',
        'read_outline',
        'read_section',
        'search_manuscript',
        'search_knowledge',
        'read_citations',
        'read_writing_skill',
        'ask_user',
        'inspect_change',
        'check_draft',
        'list_review_issues',
        'get_writing_task',
        'create_writing_task',
        'update_writing_task'
      ].toSorted()
    )
    expect(names('plan')).not.toContain('activate_tool_groups')
    expect(names('plan')).not.toContain('record_review_issues')
    expect(names('plan')).not.toContain('submit_section_change')
  })

  it('preserves the existing Write and Notebook tool sets', () => {
    expect(names('write').toSorted()).toEqual([...WRITING_CORE_TOOL_NAMES].toSorted())
    expect(names('write', ['review', 'section']).toSorted()).toEqual(
      [
        ...WRITING_CORE_TOOL_NAMES,
        ...WRITING_TOOL_GROUP_TOOL_NAMES.review,
        ...WRITING_TOOL_GROUP_TOOL_NAMES.section
      ].toSorted()
    )
    expect(
      agentModelVisibleToolSpecs('notebook_knowledge', ['section'], 'ask').map((tool) => tool.name)
    ).toEqual(['search_knowledge', 'read_citations'])
  })
})
