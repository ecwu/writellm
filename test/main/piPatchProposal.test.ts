import { describe, expect, test } from 'bun:test';
import type { SectionNodeRecord, WritingPatch } from '../../src/shared/types.js';
import {
  buildPiWritingPatch,
  createPiPatchProposal,
  type PiPatchDatabase
} from '../../src/main/agent/patchProposal.js';
import type { PatchProposalRequest } from '../../src/main/agent/writeLlmTools.js';

function section(): SectionNodeRecord {
  return {
    id: 'section-1',
    kind: 'section',
    parentId: null,
    title: 'Introduction',
    intent: null,
    activeMainNodeId: null,
    markdownPath: 'sections/introduction.md',
    markdownContent: 'Existing text.',
    markdownHash: 'base-hash',
    metadata: {},
    citationSources: [],
    sortOrder: 0,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z'
  };
}

function request(overrides: Partial<PatchProposalRequest> = {}): PatchProposalRequest {
  return {
    runId: 'run-1',
    sectionId: 'section-1',
    patchTarget: 'replace_section',
    replacementMarkdown: 'Replacement grounded in evidence [a1b2c3d.c1].',
    rationale: 'Improve clarity with retrieved evidence.',
    evidenceRefs: ['a1b2c3d.c1'],
    evidenceManifest: [{
      runId: 'run-1',
      toolCallId: 'tool-1',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      itemId: 'item-1',
      chunkId: 'chunk-1',
      publicRef: 'a1b2c3d.c1',
      itemPublicRef: 'source-1',
      title: 'Source',
      snippet: 'Evidence',
      score: 0.9,
      retrievalMethod: 'hybrid',
      retrievalReason: 'Rank 1.'
    }],
    ...overrides
  };
}

describe('Pi patch proposal bridge', () => {
  test('reuses WritingPatch validation and records Pi run/evidence provenance without mutating Markdown', async () => {
    const original = section();
    let saved: WritingPatch | null = null;
    const db: PiPatchDatabase = {
      workspacePath: '/workspace.writellm',
      getSection: () => original,
      createWritingPatch: (patch) => {
        saved = patch;
        return { id: patch.id } as never;
      }
    };

    const result = await createPiPatchProposal(db, request(), new AbortController().signal);
    expect(result.proposalId).toBe(saved?.id);
    expect(saved).toMatchObject({
      kind: 'replace_section',
      status: 'needs_review',
      origin: { actionId: 'run-1' },
      metadata: {
        provenance: {
          piRunId: 'run-1',
          retrievedChunkIds: ['chunk-1'],
          evidencePublicRefs: ['a1b2c3d.c1']
        }
      }
    });
    expect(original.markdownContent).toBe('Existing text.');
  });

  test('blocks a newly introduced citation that was not retrieved in the active Pi run', () => {
    const patch = buildPiWritingPatch('/workspace.writellm', section(), request({
      replacementMarkdown: 'Unsupported claim [b2c3d4e.c1].'
    }));

    expect(patch).toMatchObject({
      status: 'blocked',
      validation: {
        ok: false,
        errors: [expect.objectContaining({ code: 'UNRESOLVED_CITATION' })]
      }
    });
  });

  test('maps cursor continuation and section append to existing insertion patch semantics', () => {
    const original = section();
    const cursorPatch = buildPiWritingPatch('/workspace.writellm', original, request({
      patchTarget: 'insert_at_cursor',
      selection: { start: 8, end: 8 },
      replacementMarkdown: 'continued text'
    }));
    const appendPatch = buildPiWritingPatch('/workspace.writellm', original, request({
      patchTarget: 'append_to_section',
      replacementMarkdown: 'appendix'
    }));

    expect(cursorPatch).toMatchObject({ kind: 'insert_at_cursor', target: { location: { type: 'insertion', mode: 'cursor', offset: 8 } } });
    expect(appendPatch).toMatchObject({ kind: 'insert_at_cursor', target: { location: { type: 'insertion', mode: 'section_end' } } });
  });
});
