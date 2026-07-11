import { describe, expect, test } from 'bun:test';
import type { SectionNodeRecord, WritingPatch } from '../../src/shared/types.js';
import { createPatchDiff } from '../../src/main/harness/patchDiff.js';
import { markdownAfterWritingPatch } from '../../src/main/harness/patchApplier.js';
import { parseLlmPatchProposal } from '../../src/main/harness/patchProtocol.js';
import { hashText, normalizeLineEndings, scanCitations, scanNumbers, wordCount } from '../../src/main/harness/patchScanners.js';
import { validateWritingPatch } from '../../src/main/harness/patchValidator.js';

function makeSection(markdownContent: string, markdownHash = hashText(markdownContent)): SectionNodeRecord {
  return {
    id: 'section-1',
    kind: 'section',
    parentId: null,
    title: 'Section',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    intent: null,
    activeMainNodeId: null,
    markdownPath: 'sections/section-1.md',
    markdownContent,
    markdownHash,
    metadata: {},
    citationSources: []
  };
}

function selectionPatch(
  section: SectionNodeRecord,
  before: string,
  after: string,
  overrides: Partial<WritingPatch> = {}
): WritingPatch {
  const startOffset = section.markdownContent.indexOf(before);
  return {
    id: 'patch-1',
    kind: 'replace_selection',
    status: 'proposed',
    origin: { source: 'system', createdAt: '2026-01-01T00:00:00.000Z' },
    target: {
      workspaceId: 'workspace-1',
      sectionId: section.id,
      targetMode: 'section_markdown_file',
      location: {
        type: 'text_range',
        startOffset,
        endOffset: startOffset + before.length,
        selectedText: before
      }
    },
    anchors: {
      baseSectionHash: section.markdownHash,
      beforeText: before,
      beforeTextHash: hashText(before),
      anchorStrategy: 'hash_and_range'
    },
    operation: { type: 'replace', before, after },
    metadata: { actionType: 'revise' },
    ...overrides
  } as WritingPatch;
}

function sectionEndPatch(section: SectionNodeRecord, text: string): WritingPatch {
  return {
    id: 'patch-append',
    kind: 'insert_at_cursor',
    status: 'proposed',
    origin: { source: 'system', createdAt: '2026-01-01T00:00:00.000Z' },
    target: {
      workspaceId: 'workspace-1',
      sectionId: section.id,
      targetMode: 'section_markdown_file',
      location: { type: 'insertion', mode: 'section_end', offset: section.markdownContent.length }
    },
    anchors: { baseSectionHash: section.markdownHash, anchorStrategy: 'hash_and_range' },
    operation: { type: 'insert', text, position: 'at' },
    metadata: { actionType: 'draft' }
  } as WritingPatch;
}

describe('patch scanners and diffing', () => {
  test('normalizes input before hashing and recognizes supported citation formats', () => {
    expect(normalizeLineEndings('one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
    expect(hashText('one\r\ntwo')).toBe(hashText('one\ntwo'));

    expect(scanCitations('Native [A3F91C8.C1], \\citep{Smith2020, Doe2021}, and [@pandoc-key].')).toEqual(
      ['Doe2021', 'Smith2020', 'a3f91c8.c1', 'pandoc-key']
    );
  });

  test('scans numbers and counts Unicode words', () => {
    expect(scanNumbers('Top@10 fell from 1,234.5 ms to -2% across 3 pages.')).toEqual([
      'Top@10',
      '1,234.5 ms',
      '-2%',
      '3 pages'
    ]);
    expect(scanNumbers('Citation [a3f91c8.c1] is not a numeric claim.')).toEqual([]);
    expect(wordCount('One café 東京_test')).toBe(3);
  });

  test('reports patch statistics and a reviewable unified diff', () => {
    const diff = createPatchDiff('Kept 10 [a3f91c8.c1]', 'Kept 12 [b7e12aa.c2] added');

    expect(diff.stats).toMatchObject({
      wordsAdded: 1,
      wordsRemoved: 0,
      citationsAdded: 1,
      citationsRemoved: 1,
      numbersChanged: 1
    });
    expect(diff.unifiedDiff).toContain('-Kept 10 [a3f91c8.c1]');
    expect(diff.unifiedDiff).toContain('+Kept 12 [b7e12aa.c2] added');
  });
});

describe('LLM patch proposal parsing', () => {
  test('fills backward-compatible defaults and accepts legacy citation strings', () => {
    expect(parseLlmPatchProposal(JSON.stringify({
      afterText: 'Replacement',
      warnings: null,
      changedClaims: null,
      affectedCitations: ['[S1]']
    }))).toEqual({
      afterText: 'Replacement',
      rationale: '',
      affectedCitations: [{ citation: '[S1]', changeType: 'unknown', requiresReview: true }]
    });
  });

  test('rejects invalid proposal shapes', () => {
    expect(() => parseLlmPatchProposal('{"rationale":"missing replacement"}')).toThrow();
    expect(() => parseLlmPatchProposal('not json')).toThrow();
  });
});

describe('patch application and validation', () => {
  test('applies selection and semantic end insertions with readable spacing', () => {
    const section = makeSection('Alpha beta gamma');
    const replacement = selectionPatch(section, 'beta', 'delta');

    expect(markdownAfterWritingPatch(replacement, section.markdownContent)).toBe('Alpha delta gamma');
    expect(markdownAfterWritingPatch(sectionEndPatch(makeSection('Body\n'), 'Appendix'), 'Body\n')).toBe('Body\n\nAppendix');
  });

  test('rejects unsupported direct application', () => {
    const section = makeSection('Body');
    const candidate = {
      ...selectionPatch(section, 'Body', 'Ignored'),
      kind: 'create_content_candidate',
      operation: { type: 'create_candidate', content: 'Candidate' }
    } as WritingPatch;

    expect(() => markdownAfterWritingPatch(candidate, section.markdownContent)).toThrow('cannot be applied directly');
  });

  test('accepts an anchored replacement with no safety findings', () => {
    const section = makeSection('Claim [a3f91c8.c1] remains at 10%.');
    const patch = selectionPatch(
      section,
      section.markdownContent,
      'Revised claim [a3f91c8.c1] remains at 10%.'
    );

    expect(validateWritingPatch(patch, section)).toMatchObject({
      ok: true,
      status: 'valid',
      riskLevel: 'low',
      errors: [],
      warnings: []
    });
  });

  test('blocks stale patches and malformed Markdown', () => {
    const original = makeSection('Original text');
    const stalePatch = selectionPatch(original, 'Original', 'Replacement');
    const staleSection = makeSection('Original text', 'different-hash');
    const stale = validateWritingPatch(stalePatch, staleSection);

    expect(stale.ok).toBeFalse();
    expect(stale.errors.map((issue) => issue.code)).toContain('BASE_SECTION_HASH_MISMATCH');

    const malformed = validateWritingPatch(selectionPatch(original, 'Original', '```ts\nconst value = 1;'), original);
    expect(malformed.ok).toBeFalse();
    expect(malformed.errors.map((issue) => issue.code)).toContain('MARKDOWN_BROKEN');
  });

  test('keeps stale section-end suggestions reviewable but warns on risky changes', () => {
    const original = makeSection('The method is 10% effective [a3f91c8.c1].');
    const risky = selectionPatch(original, original.markdownContent, 'Prove.');
    const riskyResult = validateWritingPatch(risky, original);

    expect(riskyResult).toMatchObject({ ok: true, status: 'valid_with_warnings', riskLevel: 'high' });
    expect(riskyResult.warnings.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SUSPICIOUSLY_SHORT_OUTPUT',
      'CITATION_REMOVED',
      'NUMBER_CHANGED',
      'CLAIM_STRENGTH_INCREASED'
    ]));

    const changedSection = makeSection(`${original.markdownContent}\nUser edit.`, 'changed-hash');
    const append = validateWritingPatch(sectionEndPatch(original, 'New paragraph.'), changedSection);
    expect(append).toMatchObject({ ok: true, status: 'valid_with_warnings', riskLevel: 'medium' });
    expect(append.warnings.map((issue) => issue.code)).toContain('BASE_SECTION_HASH_MISMATCH');
  });
});
