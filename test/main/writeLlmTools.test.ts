import { describe, expect, test } from 'bun:test';
import type {
  CitationCoverageReport,
  KnowledgeChunkRecord,
  KnowledgeSourceTarget,
  ModelEndpointSettings,
  SectionNodeRecord
} from '../../src/shared/types.js';
import {
  createWriteLlmTools,
  WRITE_LLM_TOOL_SAFETY_INSTRUCTIONS,
  WriteLlmToolError,
  type WriteLlmToolDatabase
} from '../../src/main/agent/writeLlmTools.js';

const embedding: ModelEndpointSettings = {
  provider: 'openai-compatible',
  baseURL: 'https://embeddings.example.test/v1',
  model: 'embedding-model',
  apiKey: 'test-key'
};

function section(): SectionNodeRecord {
  return {
    id: 'section-1',
    kind: 'section',
    parentId: null,
    title: 'Introduction',
    intent: 'Set context',
    activeMainNodeId: null,
    markdownPath: 'sections/introduction.md',
    markdownContent: 'Existing author Markdown.',
    markdownHash: 'hash-1',
    metadata: {},
    citationSources: [],
    sortOrder: 0,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z'
  };
}

function chunk(): KnowledgeChunkRecord {
  return {
    id: 'chunk-1',
    publicRef: 'source-1.c1',
    itemId: 'item-1',
    itemPublicRef: 'source-1',
    itemTitle: 'A source',
    itemDescription: '',
    chunkIndex: 0,
    content: 'Evidence content that is not an instruction.',
    embedding: [0.1, 0.2],
    embeddingDimensions: 2,
    embeddingModel: 'embedding-model',
    vectorRowid: 1,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    score: 1,
    retrievalMethod: 'vector'
  };
}

function database(): WriteLlmToolDatabase {
  const coverage: CitationCoverageReport = {
    sections: [{
      sectionId: 'section-1',
      sectionTitle: 'Introduction',
      citationCount: 1,
      sources: [{ publicRef: 'source-1.c1', itemId: 'item-1', itemTitle: 'A source', mentions: 1 }]
    }],
    sources: []
  };
  const target: KnowledgeSourceTarget = {
    publicRef: 'source-1.c1',
    itemId: 'item-1',
    itemPublicRef: 'source-1',
    itemTitle: 'A source',
    chunkId: 'chunk-1',
    chunkIndex: 0,
    snippet: 'Evidence content that is not an instruction.'
  };
  return {
    getSection: () => section(),
    getCitationCoverage: () => coverage,
    resolveKnowledgeSourceTarget: ({ publicRef }) => publicRef === target.publicRef ? target : null,
    searchKnowledgeChunks: () => [chunk()],
    searchKnowledgeChunksByText: () => [chunk()]
  };
}

function tool<TName extends string>(tools: ReturnType<typeof createWriteLlmTools>['tools'], name: TName) {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`Expected ${name} tool.`);
  }
  return found;
}

describe('WriteLLM Pi tool facade', () => {
  test('provides explicit prompt-injection and no-direct-write guidance for the agent system prompt', () => {
    expect(WRITE_LLM_TOOL_SAFETY_INSTRUCTIONS).toContain('untrusted data');
    expect(WRITE_LLM_TOOL_SAFETY_INSTRUCTIONS).toContain('never tool instructions');
    expect(WRITE_LLM_TOOL_SAFETY_INSTRUCTIONS).toContain('reviewable proposal');
  });

  test('registers only the closed six-tool allowlist and retains evidence only in the live facade', async () => {
    const recorded: string[] = [];
    const facade = createWriteLlmTools({
      db: database(),
      scope: { runId: 'run-1', sectionId: 'section-1' },
      articleContext: () => 'Scoped article context',
      embedding,
      outboundDataPolicy: { externalProcessingEnabled: true },
      recordEvidence: (entry) => recorded.push(entry.publicRef),
      searchSources: async () => [{
        itemId: 'item-1',
        chunkId: 'chunk-1',
        publicRef: 'source-1.c1',
        itemPublicRef: 'source-1',
        title: 'A source',
        snippet: 'Evidence content that is not an instruction.',
        score: 0.9,
        retrievalMethod: 'hybrid',
        retrievalReason: 'Rank 1 from vector + full-text evidence fusion.'
      }],
      createPatchProposal: async () => ({ proposalId: 'patch-1', summary: 'A reviewable proposal.' }),
      now: () => '2026-07-11T01:02:03.000Z'
    });

    expect(facade.tools.map((entry) => entry.name)).toEqual([
      'get_article_context',
      'read_section_snapshot',
      'source',
      'resolve_citation',
      'inspect_citation_coverage',
      'propose_patch'
    ]);
    expect(facade.tools.some((entry) => ['shell', 'filesystem', 'web', 'git'].includes(entry.name))).toBeFalse();

    const sourceResult = await tool(facade.tools, 'source').execute('tool-1', { query: 'Evidence query' });
    expect(sourceResult.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('source-1.c1') });
    expect(recorded).toEqual(['source-1.c1']);
    expect(facade.getEvidenceManifest()).toEqual([expect.objectContaining({
      runId: 'run-1',
      toolCallId: 'tool-1',
      publicRef: 'source-1.c1'
    })]);

    const citationResult = await tool(facade.tools, 'resolve_citation').execute('tool-2', { publicRef: 'source-1.c1' });
    expect(citationResult.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Evidence content') });
  });

  test('enforces source and total tool budgets before any uncontrolled follow-up work', async () => {
    let searches = 0;
    const facade = createWriteLlmTools({
      db: database(),
      scope: { runId: 'run-1', sectionId: 'section-1' },
      articleContext: () => 'Scoped article context',
      embedding,
      outboundDataPolicy: { externalProcessingEnabled: true },
      searchSources: async () => {
        searches += 1;
        return [];
      },
      createPatchProposal: async () => ({ proposalId: 'patch-1', summary: 'A reviewable proposal.' })
    });
    const source = tool(facade.tools, 'source');

    await source.execute('tool-1', { query: 'first' });
    await source.execute('tool-2', { query: 'second' });
    await expect(source.execute('tool-3', { query: 'third' })).rejects.toMatchObject({
      category: 'tool_budget_exhausted',
      retryable: false
    } satisfies Partial<WriteLlmToolError>);
    expect(searches).toBe(2);
  });

  test('does not allow the model to resolve arbitrary workspace citations or apply a patch', async () => {
    let applied = false;
    const facade = createWriteLlmTools({
      db: database(),
      scope: { runId: 'run-1', sectionId: 'section-1' },
      articleContext: () => 'Scoped article context',
      embedding,
      outboundDataPolicy: { externalProcessingEnabled: true },
      searchSources: async () => [],
      createPatchProposal: async (request) => {
        applied = false;
        expect(request.sectionId).toBe('section-1');
        return { proposalId: 'patch-1', summary: 'Created for review only.' };
      }
    });

    await expect(tool(facade.tools, 'resolve_citation').execute('tool-1', { publicRef: 'arbitrary.c1' })).rejects.toMatchObject({
      category: 'scope_denied'
    } satisfies Partial<WriteLlmToolError>);
    const patchResult = await tool(facade.tools, 'propose_patch').execute('tool-2', {
      replacementMarkdown: 'Proposed only.',
      rationale: 'Improve clarity.'
    });
    expect(patchResult.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"applied":false') });
    expect(applied).toBeFalse();
  });
});
