import { describe, expect, test } from 'bun:test';
import {
  sectionMarkdownForExport,
  sectionMarkdownForStorage,
  sectionTreeMarkdownForExport,
  stripMarkdownHeadings
} from '../../src/shared/sectionMarkdown.js';
import type { CompositionTreeNode } from '../../src/shared/types.js';

function section(overrides: Partial<CompositionTreeNode> = {}): CompositionTreeNode {
  return {
    id: 'section-1',
    kind: 'section',
    parentId: null,
    title: 'Root',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    intent: null,
    activeMainNodeId: null,
    markdownPath: 'sections/section-1.md',
    markdownContent: 'Root body',
    markdownHash: 'hash',
    metadata: {},
    citationSources: [],
    children: [],
    ...overrides
  };
}

describe('section Markdown serialization', () => {
  test('strips document headings while preserving headings inside fenced code', () => {
    const markdown = '# Intro\r\n\r\nOverview\r\n---\r\n\r\n```md\r\n# Keep this\r\n```\r\n\r\nBody';

    expect(stripMarkdownHeadings(markdown)).toBe('```md\n# Keep this\n```\n\nBody');
    expect(sectionMarkdownForStorage(markdown)).toBe('```md\n# Keep this\n```\n\nBody');
  });

  test('creates normalized, depth-bounded export headings', () => {
    expect(sectionMarkdownForExport('  Intro   title ', '# Existing heading\n\nBody', 20)).toBe(
      '###### Intro title\n\nBody'
    );
    expect(sectionMarkdownForExport('', '', -3)).toBe('# Untitled section');
  });

  test('exports the complete section tree in preorder', () => {
    const root = section({
      title: 'Introduction',
      markdownContent: '# Introduction\n\nRoot body',
      children: [section({
        id: 'section-2',
        parentId: 'section-1',
        title: '',
        markdownContent: 'Child body'
      })]
    });

    expect(sectionTreeMarkdownForExport(root)).toBe(
      '# Introduction\n\nRoot body\n\n## Untitled section\n\nChild body'
    );
  });
});
