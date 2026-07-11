import { describe, expect, test } from 'bun:test';
import type {
  CompositionTreeNode,
  ContentNodeRecord,
  RetrievedKnowledgeSource,
  SectionNodeRecord
} from '../../src/shared/types.js';
import {
  buildArticleSectionContextFromDb,
  buildCompositionTreeFromSections,
  buildContextPrompt,
  buildKnowledgeRetrievalQueries,
  buildProjectBriefPromptContext,
  formatArticleStructure
} from '../../src/main/generationContext.js';

function section(id: string, title: string, parentId: string | null, sortOrder: number): SectionNodeRecord {
  return {
    id,
    kind: 'section',
    parentId,
    title,
    sortOrder,
    createdAt: `2026-01-0${sortOrder + 1}T00:00:00.000Z`,
    updatedAt: '2026-01-10T00:00:00.000Z',
    intent: `${title} intent`,
    activeMainNodeId: null,
    markdownPath: `sections/${id}.md`,
    markdownContent: `${title} body`,
    markdownHash: id,
    metadata: {},
    citationSources: []
  };
}

function content(title: string, body: string, flags: Partial<Pick<ContentNodeRecord, 'isMain' | 'isLlm'>> = {}): ContentNodeRecord {
  return {
    id: title.toLowerCase().replaceAll(' ', '-'),
    kind: 'content',
    parentId: 'section-1',
    title,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    content: body,
    isMain: false,
    isLlm: false,
    metadata: {},
    ...flags
  };
}

describe('generation context', () => {
  test('builds a stable nested article tree and marks focus and target sections', () => {
    const root = section('root', 'Root', null, 1);
    const first = section('first', 'First', null, 0);
    const child = section('child', 'Child', 'first', 0);
    const tree = buildCompositionTreeFromSections([root, child, first]);

    expect(tree.map((node) => node.id)).toEqual(['first', 'root']);
    expect(tree[0].children.map((node) => node.id)).toEqual(['child']);
    expect(formatArticleStructure(tree, 'child', 'root')).toBe(
      '- First\n  - Child (focused section)\n- Root (generation target)'
    );
  });

  test('constructs section context from the database-facing interface', () => {
    const focus = section('focus', 'Literature review', null, 0);
    const target = section('target', 'Methods', null, 1);
    const db = { listSectionsForContext: () => [focus, target] };

    const prompt = buildArticleSectionContextFromDb(db as never, target.id, focus.id);
    expect(prompt).toContain('Focused section context:\n- Section title: Literature review');
    expect(prompt).toContain('Generation target section context:\n- Section title: Methods');
  });

  test('includes sources, selected content, and citation instructions in prompts', () => {
    const source: RetrievedKnowledgeSource = {
      label: '[S1]',
      publicRef: 'a3f91c8.c1',
      itemId: 'item-1',
      itemPublicRef: 'a3f91c8',
      itemTitle: 'Relevant source',
      chunkId: 'chunk-1',
      chunkIndex: 0,
      snippet: 'A useful finding.',
      score: 0.9
    };
    const prompt = buildContextPrompt(
      'Write a synthesis.',
      [content('Outline', '  A concise outline.  ', { isMain: true })],
      'Article context',
      [source]
    );

    expect(prompt).toContain('Retrieved knowledge sources:');
    expect(prompt).toContain('[a3f91c8.c1] Relevant source');
    expect(prompt).toContain('Inline citations are required');
    expect(prompt).toContain('[1] Outline (main)\nA concise outline.');
    expect(prompt).toEndWith('User prompt:\nWrite a synthesis.');
  });

  test('derives retrieval queries from only relevant section fields and selected content', () => {
    const queries = buildKnowledgeRetrievalQueries(
      'How does retrieval improve academic writing?',
      ['Article structure:', '- Other: ignored', '- Section title: Methods', '- Section intent: Compare approaches', '- Current Markdown: Draft text'].join('\n'),
      [content('Notes', '  Compare hybrid retrieval with keyword search.  ')]
    );

    expect(queries).toHaveLength(3);
    expect(queries[1]).toContain('- Section title: Methods');
    expect(queries[1]).not.toContain('Other: ignored');
    expect(queries[2]).toContain('Notes\nCompare hybrid retrieval with keyword search.');
  });

  test('formats only meaningful project brief guidance', () => {
    const emptyDb = {
      getProjectBrief: () => ({
        glossary: { entries: [], notes: '' },
        motivation: { audience: '', problem: '', thesis: '', contribution: '', desiredReaderAction: '', constraints: '', notes: '' },
        framework: { narrativeArc: '', sectionPlan: [], notes: '' }
      })
    };
    expect(buildProjectBriefPromptContext(emptyDb as never)).toBe('');

    const populatedDb = {
      getProjectBrief: () => ({
        glossary: {
          entries: [{ id: 'term', term: 'retrieval', aliases: ['RAG'], definition: 'Evidence lookup', preferredUsage: '', avoidUsage: 'search', examples: [] }],
          notes: ''
        },
        motivation: { audience: 'Researchers', problem: '', thesis: 'Ground writing in evidence.', contribution: '', desiredReaderAction: '', constraints: '', notes: '' },
        framework: { narrativeArc: 'Question to answer', sectionPlan: [], notes: '' }
      })
    };
    const prompt = buildProjectBriefPromptContext(populatedDb as never);
    expect(prompt).toContain('canonical: retrieval | aliases for understanding: RAG');
    expect(prompt).toContain('- Thesis: Ground writing in evidence.');
    expect(prompt).toContain('Narrative arc: Question to answer');
  });
});
