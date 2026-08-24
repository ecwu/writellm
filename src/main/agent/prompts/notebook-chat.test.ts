import { describe, expect, it } from 'vitest'
import { formatNotebookChatPrompt, NOTEBOOK_CHAT_SYSTEM_PROMPT } from './notebook-chat'

describe('Notebook chat prompt', () => {
  it('defines the selected-source tool workflow and keeps only the question actionable', () => {
    const prompt = formatNotebookChatPrompt({ question: 'What does <source> say?' })

    expect(NOTEBOOK_CHAT_SYSTEM_PROMPT).toContain('search_knowledge')
    expect(NOTEBOOK_CHAT_SYSTEM_PROMPT).toContain('read_citations')
    expect(NOTEBOOK_CHAT_SYSTEM_PROMPT).toContain('citationOrdinal')
    expect(NOTEBOOK_CHAT_SYSTEM_PROMPT).toContain('selected Knowledge sources')
    expect(prompt).toContain('<CurrentQuestion instructionSemantics="true">')
    expect(prompt).toContain('What does &lt;source&gt; say?')
    expect(prompt).not.toContain('<NotebookEvidence')
  })
})
