import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingFlow } from './onboarding-flow'

const baseProps = {
  projectName: '',
  projectNameError: null,
  projectTemplates: [],
  selectedTemplateId: 'blank',
  creatingProject: false,
  onStateChange: vi.fn(async () => undefined),
  onProjectNameChange: vi.fn(),
  onTemplateChange: vi.fn(),
  onDeleteSelectedTemplate: vi.fn(),
  onCreateProject: vi.fn(async () => undefined),
  onOpenProject: vi.fn(async () => undefined),
  onError: vi.fn()
}

describe('OnboardingFlow', () => {
  it('introduces the optional six-step setup and local-first boundary', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        {...baseProps}
        state={{ schemaVersion: 1, status: 'pending', step: 'welcome' }}
      />
    )

    for (const label of [
      'Welcome',
      'Agent LLM',
      'Embedding',
      'Reranking',
      'MinerU',
      'First project'
    ]) {
      expect(html).toContain(label)
    }
    expect(html).toContain('everything is optional')
    expect(html).toContain('Reviewable Agent changes')
    expect(html).toContain('Local-first by design')
    expect(html).toContain('Skip setup')
    expect(html).toContain('Start setup')
  })

  it('ends with the real project name and template fields while preserving dismissal', () => {
    const html = renderToStaticMarkup(
      <OnboardingFlow
        {...baseProps}
        projectName='Field notes'
        state={{ schemaVersion: 1, status: 'pending', step: 'project' }}
      />
    )

    expect(html).toContain('Create your first writing project')
    expect(html).toContain('Field notes')
    expect(html).toContain('.writellm')
    expect(html).toContain('Starting template')
    expect(html).toContain('Maybe later')
    expect(html).toContain('Choose location &amp; create')
    expect(html).toContain('Open an existing project')
  })
})
