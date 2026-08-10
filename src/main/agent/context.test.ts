import { describe, expect, it } from 'vitest'
import type { AgentEditorContext } from '../../shared/contracts/agent'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import { AgentContextBuilder } from './context'

const editorContext: AgentEditorContext = {
  activeSectionId: null,
  activeBlockId: null,
  selectedBlockIds: []
}

function createBuilder(): AgentContextBuilder {
  const manuscript = {
    assemble: () => ({
      manuscriptId: 'manuscript-1',
      outlineVersion: 1,
      brief: {
        version: 1,
        title: 'Title',
        description: '',
        topic: '',
        targetAudience: '',
        language: 'en',
        styleTone: '',
        scopeExclusions: '',
        targetLength: '',
        citationRequirements: '',
        additionalInstructions: ''
      },
      wordCount: 0,
      characterCount: 0,
      sections: []
    })
  }
  return new AgentContextBuilder(manuscript as unknown as ManuscriptService)
}

describe('AgentContextBuilder skill prompt section', () => {
  it('omits the skill companion note when no skill is active', () => {
    const built = createBuilder().build({ prompt: 'Write a paragraph.', editorContext })
    expect(built.systemPrompt).not.toContain('writellm_skill_companion')
    expect(built.systemPrompt).toContain('<TRUSTED_WRITING_REQUIREMENTS')
  })

  it('includes the companion note and skill block when a skill is active', () => {
    const built = createBuilder().build({
      prompt: 'Write a paragraph.',
      editorContext,
      skillPrompt: {
        mode: 'explicit',
        mandatory: '<skill name="demo" location="writellm://skills/demo">\nBody\n</skill>',
        references: []
      }
    })
    expect(built.systemPrompt).toContain('writellm_skill_companion')
    expect(built.systemPrompt).toContain('<skill name="demo"')
    expect(
      built.systemPrompt.indexOf('writellm_skill_companion') <
        built.systemPrompt.indexOf('<TRUSTED_WRITING_REQUIREMENTS')
    ).toBe(true)
  })
})
