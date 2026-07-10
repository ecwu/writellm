import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');

if (!process.versions.electron) {
  const electronBin = path.join(
    projectRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );
  if (!existsSync(electronBin)) {
    throw new Error('Electron binary not found. Run the project install before electron smoke tests.');
  }

  const result = spawnSync(electronBin, [scriptPath, ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 1);
}

const [
  { default: Database },
  { default: JSZip },
  { WriteLLMDatabase },
  { exportLatex },
  gitSession,
  { indexKnowledgeItem, retrieveKnowledgeSourcesV2 },
  knowledgeIngest,
  { extractKnowledgeFileText },
  { restoreSectionVersion },
  { unzipBuffer },
  citations,
  patchDiff,
  patchValidator,
  patchApplier,
  patchScanners
] = await Promise.all([
  import('better-sqlite3'),
  import('jszip'),
  import('../dist-electron/main/database.js'),
  import('../dist-electron/main/exportLatex.js'),
  import('../dist-electron/main/gitSession.js'),
  import('../dist-electron/main/knowledgeIndex.js'),
  import('../dist-electron/main/knowledgeIngest.js'),
  import('../dist-electron/main/knowledgeTextExtract.js'),
  import('../dist-electron/main/sectionHistory.js'),
  import('../dist-electron/main/zip.js'),
  import('../dist-electron/shared/citations.js'),
  import('../dist-electron/main/harness/patchDiff.js'),
  import('../dist-electron/main/harness/patchValidator.js'),
  import('../dist-electron/main/harness/patchApplier.js'),
  import('../dist-electron/main/harness/patchScanners.js')
]);

const {
  createGitCheckpoint,
  ensureGitSession,
  getGitDiff,
  getGitStatus,
  getSectionVersion,
  listGitHistory
} = gitSession;
const { enqueueKnowledgeFiles, processKnowledgeIngestJob } = knowledgeIngest;
const { citationGroupsFromText, citationRefsFromText } = citations;
const { createPatchDiff } = patchDiff;
const { validateWritingPatch } = patchValidator;
const { markdownAfterWritingPatch } = patchApplier;
const { hashText } = patchScanners;

const workspacePath = mkdtempSync(path.join(os.tmpdir(), 'writellm-smoke-'));

try {
  assertCitationParsing();

  const db = new WriteLLMDatabase(workspacePath);
  const rootId = db.rootNodeId;
  ensureGitSession(workspacePath);
  const gitStatus = getGitStatus(workspacePath);
  if (!gitStatus.branch?.startsWith('session/') || !existsSync(path.join(workspacePath, '.git'))) {
    throw new Error('Git session was not initialized on a session branch.');
  }
  const initialHistory = listGitHistory(workspacePath);
  if (!initialHistory.some((entry) => entry.subject === 'Initial workspace')) {
    throw new Error('Initial workspace checkpoint was not created.');
  }
  const intro = db.createNode({
    kind: 'section',
    parentId: rootId,
    title: 'Intro',
    intent: ''
  });
  if (intro.kind !== 'section') {
    throw new Error('Child section was not created.');
  }
  if (!intro.markdownPath || !intro.markdownHash) {
    throw new Error('Section did not receive Markdown metadata.');
  }
  const introMarkdownPath = path.join(workspacePath, intro.markdownPath);
  if (!existsSync(introMarkdownPath)) {
    throw new Error('Section Markdown file was not created.');
  }
  const manifestPath = path.join(workspacePath, '.writellm-manifest.json');
  if (!existsSync(manifestPath) || !readFileSync(manifestPath, 'utf8').includes(intro.id)) {
    throw new Error('Workspace manifest was not written.');
  }
  db.updateSectionMarkdown(intro.id, '# Intro\n\nHello **Markdown** world.\n');
  const updatedIntro = db.getSection(intro.id);
  if (
    !updatedIntro ||
    updatedIntro.markdownContent !== 'Hello **Markdown** world.\n' ||
    readFileSync(introMarkdownPath, 'utf8') !== updatedIntro.markdownContent
  ) {
    throw new Error('Section Markdown DB/file sync failed.');
  }
  const initialBrief = db.getProjectBrief();
  if (initialBrief.glossary.entries.length !== 0 || initialBrief.createdAt !== null || initialBrief.updatedAt !== null) {
    throw new Error('Project brief did not initialize as an empty workspace-level record.');
  }
  const savedBrief = db.updateProjectBrief({
    glossary: {
      entries: [{
        id: 'term_smoke',
        term: 'canonical smoke term',
        aliases: ['smoke alias'],
        definition: 'A controlled term for smoke testing.',
        preferredUsage: 'Use the canonical term in generated prose.',
        avoidUsage: 'Avoid the alias in final prose.',
        examples: ['canonical smoke term example']
      }],
      notes: 'Glossary smoke notes.'
    },
    motivation: {
      audience: 'Smoke-test readers',
      problem: 'Project guidance needs workspace-level persistence.',
      thesis: 'A persisted project brief improves generation context.',
      contribution: 'Adds terminology, motivation, and framework guidance.',
      desiredReaderAction: 'Trust the persisted guidance.',
      constraints: 'Keep the record project-scoped.',
      notes: 'Motivation smoke notes.'
    },
    framework: {
      narrativeArc: 'Move from problem to contribution.',
      sectionPlan: [{
        id: 'briefsec_smoke',
        title: intro.title,
        purpose: 'Introduce the smoke-test claim.',
        keyMoves: 'Define the problem and contribution.',
        evidence: 'Use the uploaded source context.'
      }],
      notes: 'Framework smoke notes.'
    }
  });
  const rawBrief = db.db.prepare('SELECT glossary_json, motivation_json, framework_json FROM project_brief WHERE id = ?').get('project');
  if (
    savedBrief.glossary.entries[0]?.term !== 'canonical smoke term' ||
    savedBrief.motivation.thesis !== 'A persisted project brief improves generation context.' ||
    savedBrief.framework.sectionPlan[0]?.title !== intro.title ||
    JSON.parse(rawBrief.glossary_json).entries[0]?.avoidUsage !== 'Avoid the alias in final prose.'
  ) {
    throw new Error('Project brief was not persisted with glossary, motivation, and framework fields.');
  }

  const beforeHashMismatchPatch = makeSelectionPatch(updatedIntro, {
    id: 'wpatch_smoke_before_hash_mismatch',
    before: 'Hello',
    after: 'Hi',
    startOffset: 0,
    endOffset: 5
  });
  beforeHashMismatchPatch.anchors.beforeTextHash = hashText('Different');
  const beforeHashMismatchValidation = validateWritingPatch(beforeHashMismatchPatch, updatedIntro);
  if (
    beforeHashMismatchValidation.ok ||
    !beforeHashMismatchValidation.errors.some((issue) => issue.code === 'BEFORE_TEXT_HASH_MISMATCH')
  ) {
    throw new Error('WritingPatch beforeTextHash mismatch was not blocked.');
  }

  const baseMismatchCurrent = db.updateSectionMarkdown(intro.id, `${updatedIntro.markdownContent}\nUnrelated user edit.\n`);
  const baseMismatchValidation = validateWritingPatch(makeSelectionPatch(updatedIntro, {
    id: 'wpatch_smoke_base_hash_mismatch',
    before: 'Hello',
    after: 'Hi',
    startOffset: 0,
    endOffset: 5
  }), baseMismatchCurrent);
  if (
    baseMismatchValidation.ok ||
    !baseMismatchValidation.errors.some((issue) => issue.code === 'BASE_SECTION_HASH_MISMATCH')
  ) {
    throw new Error('WritingPatch replacement was not blocked on base section hash mismatch.');
  }

  const sectionEndPatch = makeInsertPatch(updatedIntro, {
    id: 'wpatch_smoke_section_end_insert',
    text: 'Appended generated paragraph.',
    mode: 'section_end',
    offset: updatedIntro.markdownContent.length
  });
  const sectionEndValidation = validateWritingPatch(sectionEndPatch, baseMismatchCurrent);
  const sectionEndMarkdown = markdownAfterWritingPatch(sectionEndPatch, baseMismatchCurrent.markdownContent);
  if (
    !sectionEndValidation.ok ||
    !sectionEndValidation.warnings.some((issue) => issue.code === 'BASE_SECTION_HASH_MISMATCH') ||
    !sectionEndMarkdown.endsWith('Unrelated user edit.\n\nAppended generated paragraph.')
  ) {
    throw new Error('Section-end WritingPatch insertion was not treated as a semantic append.');
  }

  const cursorPatch = makeInsertPatch(updatedIntro, {
    id: 'wpatch_smoke_stale_cursor_insert',
    text: 'Cursor insertion.',
    mode: 'cursor',
    offset: updatedIntro.markdownContent.length
  });
  const cursorValidation = validateWritingPatch(cursorPatch, baseMismatchCurrent);
  if (
    cursorValidation.ok ||
    !cursorValidation.errors.some((issue) => issue.code === 'BASE_SECTION_HASH_MISMATCH')
  ) {
    throw new Error('Stale cursor WritingPatch insertion was not blocked.');
  }

  db.updateSectionMarkdown(intro.id, updatedIntro.markdownContent);

  const selectionPatch = makeSelectionPatch(updatedIntro, {
    id: 'wpatch_smoke_selection',
    before: 'Hello',
    after: 'Hi',
    startOffset: 0,
    endOffset: 5
  });
  selectionPatch.validation = validateWritingPatch(selectionPatch, updatedIntro);
  selectionPatch.diff = createPatchDiff('Hello', 'Hi');
  selectionPatch.status = selectionPatch.validation.ok ? 'needs_review' : 'blocked';
  const savedPatch = db.createWritingPatch(selectionPatch);
  if (savedPatch.id !== selectionPatch.id || savedPatch.patch.diff?.stats.wordsRemoved !== 0) {
    throw new Error('WritingPatch was not persisted with its diff metadata.');
  }
  const patchedMarkdown = markdownAfterWritingPatch(selectionPatch, updatedIntro.markdownContent);
  db.updateSectionMarkdown(intro.id, patchedMarkdown);
  const patchedIntro = db.getSection(intro.id);
  if (!patchedIntro?.markdownContent.startsWith('Hi **Markdown** world.')) {
    throw new Error('WritingPatch deterministic selection apply failed.');
  }
  const riskyPatch = makeSelectionPatch(patchedIntro, {
    id: 'wpatch_smoke_risky_patch',
    before: 'Hi **Markdown** world.',
    after: 'Short.',
    startOffset: 0,
    endOffset: 'Hi **Markdown** world.'.length
  });
  riskyPatch.operation.before = 'Hi **Markdown** world [a3f91c8.c1] used 13.33% in 89.07 s.';
  riskyPatch.operation.after = 'Short.';
  riskyPatch.target.location.selectedText = riskyPatch.operation.before;
  riskyPatch.target.location.endOffset = riskyPatch.operation.before.length;
  db.updateSectionMarkdown(intro.id, `${riskyPatch.operation.before}\n`);
  const riskyIntro = db.getSection(intro.id);
  const riskyValidation = validateWritingPatch({
    ...riskyPatch,
    anchors: {
      ...riskyPatch.anchors,
      baseSectionHash: riskyIntro.markdownHash,
      beforeText: riskyPatch.operation.before,
      beforeTextHash: hashText(riskyPatch.operation.before)
    }
  }, riskyIntro);
  if (
    !riskyValidation.ok ||
    riskyValidation.riskLevel !== 'high' ||
    !riskyValidation.warnings.some((issue) => issue.code === 'CITATION_REMOVED') ||
    !riskyValidation.warnings.some((issue) => issue.code === 'NUMBER_CHANGED') ||
    !riskyValidation.warnings.some((issue) => issue.code === 'SUSPICIOUSLY_SHORT_OUTPUT')
  ) {
    throw new Error('WritingPatch high-risk citation, number, and shortening checks failed.');
  }
  const emptyPatch = makeSelectionPatch(riskyIntro, {
    id: 'wpatch_smoke_empty_patch',
    before: riskyPatch.operation.before,
    after: '   ',
    startOffset: 0,
    endOffset: riskyPatch.operation.before.length
  });
  const emptyValidation = validateWritingPatch(emptyPatch, riskyIntro);
  if (emptyValidation.ok || !emptyValidation.errors.some((issue) => issue.code === 'EMPTY_AFTER_TEXT')) {
    throw new Error('Empty WritingPatch replacement was not blocked.');
  }
  db.updateSectionMarkdown(intro.id, patchedIntro.markdownContent);
  const stalePatch = makeSelectionPatch(updatedIntro, {
    id: 'wpatch_smoke_stale',
    before: 'Hello',
    after: 'Hey',
    startOffset: 0,
    endOffset: 5
  });
  const staleValidation = validateWritingPatch(stalePatch, patchedIntro);
  if (staleValidation.ok || !staleValidation.errors.some((issue) => issue.code === 'BASE_SECTION_HASH_MISMATCH')) {
    throw new Error('Stale WritingPatch was not blocked by base section hash validation.');
  }
  const candidatePatch = makeCandidatePatch(patchedIntro, 'Alternative full section candidate.');
  candidatePatch.validation = validateWritingPatch(candidatePatch, patchedIntro);
  const candidateBeforeMarkdown = patchedIntro.markdownContent;
  const candidateBeforeActiveMainNodeId = db.getSection(intro.id)?.activeMainNodeId ?? null;
  const candidateNode = db.createNode({
    kind: 'content',
    parentId: intro.id,
    title: 'Patch candidate',
    content: candidatePatch.operation.content,
    isLlm: true,
    metadata: { writingPatchId: candidatePatch.id }
  });
  const candidateAfterSection = db.getSection(intro.id);
  if (
    candidateNode.kind !== 'content' ||
    candidateAfterSection?.markdownContent !== candidateBeforeMarkdown ||
    candidateAfterSection?.activeMainNodeId !== candidateBeforeActiveMainNodeId
  ) {
    throw new Error('WritingPatch candidate creation mutated section Markdown.');
  }

  const checkpoint = createGitCheckpoint(workspacePath, 'Smoke checkpoint');
  if (!checkpoint?.hash) {
    throw new Error('Git checkpoint was not created for Markdown changes.');
  }
  db.updateSectionMarkdown(intro.id, '# Intro\n\nChanged Markdown.\n');
  const changedCheckpoint = createGitCheckpoint(workspacePath, 'Changed intro');
  if (!changedCheckpoint?.hash) {
    throw new Error('Changed Markdown checkpoint was not created.');
  }
  const sectionHistory = listGitHistory(workspacePath, intro.id);
  if (sectionHistory.length < 2) {
    throw new Error('Section history did not include multiple checkpoints.');
  }
  const diff = getGitDiff(workspacePath, {
    sectionId: intro.id,
    base: checkpoint.hash,
    head: changedCheckpoint.hash
  });
  if (!diff.includes('Changed Markdown')) {
    throw new Error('Git diff did not include section Markdown changes.');
  }
  const checkpointMarkdown = getSectionVersion(workspacePath, intro.id, checkpoint.hash);
  if (!checkpointMarkdown.includes('Hi **Markdown** world.')) {
    throw new Error('Section version lookup did not return checkpoint Markdown.');
  }
  const other = db.createNode({
    kind: 'section',
    parentId: rootId,
    title: 'Other',
    intent: ''
  });
  if (other.kind !== 'section') {
    throw new Error('Second section was not created.');
  }
  db.updateSectionMarkdown(other.id, '# Other\n\nUncheckpointed Markdown.\n');
  restoreSectionVersion(db, intro.id, checkpoint.hash);
  const restoredIntro = db.getSection(intro.id);
  const dirtyOther = db.getSection(other.id);
  if (!restoredIntro?.markdownContent.includes('Hi **Markdown** world.')) {
    throw new Error('Section restore did not restore the requested Markdown.');
  }
  if (!dirtyOther?.markdownContent.includes('Uncheckpointed Markdown.')) {
    throw new Error('Section restore overwrote another section.');
  }

  const source = db.createNode({
    kind: 'content',
    parentId: intro.id,
    title: 'Source note',
    content: 'Background source.'
  });
  if (source.kind !== 'content') {
    throw new Error('Content nodes were not created.');
  }

  const exportPath = exportLatex(db, rootId);
  const output = readFileSync(exportPath, 'utf8');
  if (!exportPath.endsWith('main.md') || !output.includes('Hi **Markdown** world.')) {
    throw new Error('Exported Markdown did not include section Markdown.');
  }

  db.createNodeEdge(source.id, intro.id, 'informs');
  if (db.listEdges().length !== 1) {
    throw new Error('Section process edge was not created.');
  }

  const knowledge = db.createKnowledgeItem('Background source', 'Background source.');
  db.replaceKnowledgeChunks(knowledge.id, [
    {
      content: 'Background source.',
      embedding: [1, 0, 0],
      embeddingModel: 'test-embedding'
    }
  ]);
  const chunks = db.searchKnowledgeChunks({ embedding: [1, 0, 0], maxChunks: 1 });
  if (chunks.length !== 1 || chunks[0].itemId !== knowledge.id) {
    throw new Error('Knowledge chunk search did not return the indexed source.');
  }
  if ((chunks[0].score ?? 0) < 0.99) {
    throw new Error('Knowledge vector search did not preserve high-is-better similarity scores.');
  }
  const otherKnowledge = db.createKnowledgeItem('Other vector source', 'Other vector source.');
  db.replaceKnowledgeChunks(otherKnowledge.id, [
    {
      content: 'Orthogonal source.',
      embedding: [0, 1, 0],
      embeddingModel: 'test-embedding'
    },
    {
      content: 'Different dimensions.',
      embedding: [1, 0],
      embeddingModel: 'test-embedding-2d'
    }
  ]);
  const rankedChunks = db.searchKnowledgeChunks({ embedding: [0, 1, 0], maxChunks: 2 });
  if (rankedChunks[0]?.content !== 'Orthogonal source.' || rankedChunks.some((chunk) => chunk.content === 'Different dimensions.')) {
    throw new Error('Knowledge vector search did not rank by sqlite-vec or isolate dimensions.');
  }
  const excludedChunks = db.searchKnowledgeChunks({
    embedding: [0, 1, 0],
    excludedItemIds: [otherKnowledge.id],
    maxChunks: 2
  });
  if (excludedChunks.some((chunk) => chunk.itemId === otherKnowledge.id)) {
    throw new Error('Knowledge vector search did not honor excluded item IDs.');
  }
  db.saveGenerationCitations(intro.id, [
    {
      publicRef: chunks[0].publicRef,
      knowledgeItemId: knowledge.id,
      knowledgeChunkId: chunks[0].id,
      label: '[S1]',
      snippet: chunks[0].content,
      score: chunks[0].score ?? null
    }
  ]);
  if (db.listGenerationCitations(intro.id).length !== 1) {
    throw new Error('Generation citation was not saved.');
  }
  db.updateSectionMarkdown(intro.id, `Grouped citation [${chunks[0].publicRef}, ${rankedChunks[0].publicRef}] stays grouped.\n`);
  const groupedCitationSection = db.getSection(intro.id);
  const groupedRefs = new Set(groupedCitationSection?.citationSources.map((source) => source.publicRef.toLowerCase()) ?? []);
  if (!groupedRefs.has(chunks[0].publicRef.toLowerCase()) || !groupedRefs.has(rankedChunks[0].publicRef.toLowerCase())) {
    throw new Error('Grouped citation refs were not resolved into section citation sources.');
  }
  const citationCoverage = db.getCitationCoverage();
  const coveredSource = citationCoverage.sources.find((source) => source.itemId === knowledge.id);
  if (!coveredSource || coveredSource.citationCount < 1 || !coveredSource.sectionIds.includes(intro.id)) {
    throw new Error('Citation coverage did not connect a source to the citing section.');
  }

  const txtPath = path.join(workspacePath, 'source.txt');
  const mdPath = path.join(workspacePath, 'notes.md');
  const pdfPath = path.join(workspacePath, 'sample.pdf');
  writeFileSync(txtPath, 'Exact text source.');
  writeFileSync(mdPath, '# Notes\n\nMarkdown source.');
  writeFileSync(pdfPath, createSamplePdf('PDF source text'));

  await enqueueKnowledgeFiles(db, [txtPath, mdPath]);
  const queuedJobs = db.listKnowledgeIngestJobs();
  if (queuedJobs.length !== 2 || queuedJobs.some((job) => job.status !== 'queued')) {
    throw new Error('Batch enqueue did not create queued ingest jobs.');
  }
  const plainjobCount = db.db
    .prepare("SELECT COUNT(*) AS count FROM plainjob_jobs WHERE type = 'knowledge-ingest'")
    .get().count;
  if (plainjobCount !== 2) {
    throw new Error('Batch enqueue did not create plainjob-backed ingest jobs.');
  }

  const fakeEmbeddingSettings = {
    provider: 'openai-compatible',
    baseURL: 'http://localhost',
    model: 'test-embedding',
    apiKey: 'test'
  };
  const embeddingSource = db.createKnowledgeItem(
    'Embedding source',
    Array.from({ length: 28 }, (_, index) => `Section ${index + 1} ${String.fromCharCode(97 + (index % 26)).repeat(1100)}`).join('\n\n')
  );
  const originalEmbeddingFetch = globalThis.fetch;
  let metadataFetchSeen = false;
  let embeddingFetchCount = 0;
  let embeddingVectorIndex = 0;
  try {
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === 'http://localhost/chat/completions') {
        metadataFetchSeen = true;
        const body = JSON.parse(String(init.body));
        if (body.model !== 'test-embedding' || body.response_format?.type !== 'json_schema') {
          throw new Error('Structured metadata request did not include expected model and JSON schema response format.');
        }
        return jsonResponse({
          id: 'chatcmpl-smoke',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  title: 'Structured metadata title',
                  description: 'Structured metadata description.'
                })
              },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        });
      }
      if (String(url) !== 'http://localhost/embeddings') {
        throw new Error(`Unexpected embedding fetch URL: ${String(url)}`);
      }
      const body = JSON.parse(String(init.body));
      if (body.model !== 'test-embedding' || !Array.isArray(body.input) || body.input.length === 0) {
        throw new Error('Embedding request did not include the expected model and chunked input.');
      }
      embeddingFetchCount += 1;
      const batchChars = body.input.reduce((sum, value) => sum + String(value).length, 0);
      if (body.input.length > 64 || batchChars > 64000) {
        throw new Error('Embedding request was not split into bounded batches.');
      }
      return jsonResponse({
        data: body.input.map((_, index) => {
          embeddingVectorIndex += 1;
          return {
            index,
            embedding: [embeddingVectorIndex, 0, 0]
          };
        })
      });
    };
    await indexKnowledgeItem(db, embeddingSource.id, fakeEmbeddingSettings, fakeEmbeddingSettings);
  } finally {
    globalThis.fetch = originalEmbeddingFetch;
  }
  const embeddingItem = db.getKnowledgeItem(embeddingSource.id);
  if (!metadataFetchSeen || embeddingItem?.metadata.knowledgeDisplayMetadata?.title !== 'Structured metadata title') {
    throw new Error('AI SDK structured metadata output was not stored.');
  }
  if (embeddingFetchCount < 2) {
    throw new Error('Embedding requests were not split into multiple batches.');
  }
  const embeddingDebug = db.listKnowledgeDebugItems().find((item) => item.itemId === embeddingSource.id);
  if (!embeddingDebug || embeddingDebug.chunkCount < 2) {
    throw new Error('Packaged text splitter did not create multiple knowledge chunks.');
  }
  if (embeddingDebug.chunks.some((chunk, index) => chunk.embeddingPreview[0] !== index + 1)) {
    throw new Error('AI SDK embedMany result order was not preserved in stored chunks.');
  }
  const sourceV2Item = db.createKnowledgeItem(
    'Source v2 fixture',
    'Alpha evidence.\n\nFollowup evidence.\n\nExcluded evidence.\n\nRound two evidence.\n\nRound three evidence.'
  );
  const sourceV2Chunks = db.replaceKnowledgeChunks(sourceV2Item.id, [
    { content: 'Alpha evidence.', embedding: [1, 0, 0], embeddingModel: 'test-embedding' },
    { content: 'Followup evidence.', embedding: [0, 1, 0], embeddingModel: 'test-embedding' },
    { content: 'Excluded evidence.', embedding: [1, 0, 0], embeddingModel: 'test-embedding' },
    { content: 'Round two evidence.', embedding: [0, 0, 1], embeddingModel: 'test-embedding' },
    { content: 'Round three evidence.', embedding: [0, 0, 2], embeddingModel: 'test-embedding' }
  ]);
  const sourceV2RetrievalSettings = {
    maxRetrievedChunks: 2,
    maxCandidateChunks: 2,
    rerankTopN: 2,
    adjacentChunkRadius: 0,
    maxChunksPerItem: 2,
    chunkTargetChars: 700,
    chunkOverlapChars: 100,
    embeddingBatchSize: 64
  };
  const sourceV2RerankSettings = {
    provider: 'siliconflow-compatible',
    baseURL: 'http://localhost',
    model: 'test-rerank',
    apiKey: '',
    enabled: false
  };
  async function withSourceV2FetchMock(chatResponder, callback) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === 'http://localhost/chat/completions') {
        const body = JSON.parse(String(init.body));
        const response = chatResponder(body);
        if (response instanceof Response) {
          return response;
        }
        return jsonResponse({
          id: 'chatcmpl-sourcev2-smoke',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify(response)
              },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        });
      }
      if (String(url) !== 'http://localhost/embeddings') {
        throw new Error(`Unexpected Source v2 fetch URL: ${String(url)}`);
      }
      const body = JSON.parse(String(init.body));
      return jsonResponse({
        data: body.input.map((value, index) => ({
          index,
          embedding: embeddingForSourceV2Query(String(value))
        }))
      });
    };
    try {
      return await callback();
    } finally {
      globalThis.fetch = previousFetch;
    }
  }
  const stopTrace = [];
  await withSourceV2FetchMock((body) => {
    const ids = chunkIdsFromPrompt(body.messages?.at(-1)?.content ?? '');
    return {
      decision: 'stop',
      reason: 'Alpha is sufficient.',
      selectedChunkIds: ids.slice(0, 1),
      missingEvidence: [],
      nextQueries: []
    };
  }, async () => {
    const sources = await retrieveKnowledgeSourcesV2(db, fakeEmbeddingSettings, fakeEmbeddingSettings, 'alpha evidence', {
      excludedChunkIds: [sourceV2Chunks[2].id],
      maxChunks: 2,
      maxCandidates: 2,
      queries: ['alpha evidence'],
      rerankSettings: sourceV2RerankSettings,
      retrievalSettings: sourceV2RetrievalSettings,
      runId: 'sourcev2-stop-smoke',
      onTrace: (event) => stopTrace.push(event)
    });
    if (sources.some((source) => source.chunkId === sourceV2Chunks[2].id)) {
      throw new Error('Source v2 retrieval did not honor excluded chunk IDs.');
    }
    if (stopTrace.filter((event) => event.type === 'round_evaluation').length !== 1) {
      throw new Error('Source v2 stop decision did not finish after one evaluation round.');
    }
  });
  let plainJsonEvalCalls = 0;
  await withSourceV2FetchMock((body) => {
    plainJsonEvalCalls += 1;
    if (body.response_format) {
      throw new Error('Source v2 evaluator should generate JSON text without response_format.');
    }
    const ids = chunkIdsFromPrompt(body.messages?.at(-1)?.content ?? '');
    return {
      decision: 'stop',
      reason: 'Plain JSON evaluator worked.',
      selectedChunkIds: ids.slice(0, 1),
      missingEvidence: [],
      nextQueries: []
    };
  }, async () => {
    const sources = await retrieveKnowledgeSourcesV2(db, fakeEmbeddingSettings, fakeEmbeddingSettings, 'alpha evidence', {
      excludedChunkIds: [sourceV2Chunks[2].id],
      maxChunks: 2,
      maxCandidates: 2,
      queries: ['alpha evidence'],
      rerankSettings: sourceV2RerankSettings,
      retrievalSettings: sourceV2RetrievalSettings,
      runId: 'sourcev2-text-fallback-smoke'
    });
    if (plainJsonEvalCalls !== 1 || sources[0]?.sourceV2Reason !== 'Plain JSON evaluator worked.') {
      throw new Error('Source v2 did not use plain JSON evaluator output.');
    }
  });
  const continueTrace = [];
  let continueCalls = 0;
  await withSourceV2FetchMock((body) => {
    continueCalls += 1;
    const ids = chunkIdsFromPrompt(body.messages?.at(-1)?.content ?? '');
    return continueCalls === 1
      ? {
          decision: 'continue',
          reason: 'Need followup evidence.',
          selectedChunkIds: ids.slice(0, 1),
          missingEvidence: ['followup'],
          nextQueries: ['followup evidence']
        }
      : {
          decision: 'stop',
          reason: 'Followup evidence found.',
          selectedChunkIds: ids,
          missingEvidence: [],
          nextQueries: []
        };
  }, async () => {
    const sources = await retrieveKnowledgeSourcesV2(db, fakeEmbeddingSettings, fakeEmbeddingSettings, 'alpha evidence', {
      excludedChunkIds: [sourceV2Chunks[2].id],
      maxChunks: 2,
      maxCandidates: 2,
      queries: ['alpha evidence'],
      rerankSettings: sourceV2RerankSettings,
      retrievalSettings: sourceV2RetrievalSettings,
      runId: 'sourcev2-continue-smoke',
      onTrace: (event) => continueTrace.push(event)
    });
    if (!sources.some((source) => source.chunkId === sourceV2Chunks[1].id)) {
      throw new Error('Source v2 continuation did not retrieve the follow-up chunk.');
    }
    if (!continueTrace.some((event) => event.type === 'round_started' && event.round === 2)) {
      throw new Error('Source v2 continuation did not start a second retrieval round.');
    }
  });
  const maxRoundTrace = [];
  let maxRoundCalls = 0;
  await withSourceV2FetchMock((body) => {
    maxRoundCalls += 1;
    const ids = chunkIdsFromPrompt(body.messages?.at(-1)?.content ?? '');
    return {
      decision: 'continue',
      reason: 'Keep searching.',
      selectedChunkIds: ids,
      missingEvidence: ['more'],
      nextQueries: maxRoundCalls === 1 ? ['round two evidence'] : ['round three evidence']
    };
  }, async () => {
    await retrieveKnowledgeSourcesV2(db, fakeEmbeddingSettings, fakeEmbeddingSettings, 'alpha evidence', {
      excludedChunkIds: [sourceV2Chunks[2].id],
      maxChunks: 2,
      maxCandidates: 2,
      maxRounds: 3,
      queries: ['alpha evidence'],
      rerankSettings: sourceV2RerankSettings,
      retrievalSettings: sourceV2RetrievalSettings,
      runId: 'sourcev2-max-smoke',
      onTrace: (event) => maxRoundTrace.push(event)
    });
    if (maxRoundTrace.filter((event) => event.type === 'round_started').length !== 3) {
      throw new Error('Source v2 retrieval did not enforce the configured maximum rounds.');
    }
  });
  const fakeIndexKnowledgeItem = async (database, itemId) => {
    const item = database.getKnowledgeItem(itemId);
    if (!item) {
      throw new Error('Ingest test item was not created.');
    }
    return database.replaceKnowledgeChunks(itemId, [
      {
        content: item.content,
        embedding: [1, 0, 0],
        embeddingModel: 'test-embedding'
      }
    ]);
  };
  const txtJob = queuedJobs.find((job) => job.fileName === 'source.txt');
  if (!txtJob) {
    throw new Error('Text ingest job was not queued.');
  }
  await processKnowledgeIngestJob(db, txtJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, undefined, fakeEmbeddingSettings);
  const txtItemId = db.getKnowledgeIngestJob(txtJob.id)?.knowledgeItemId;
  const txtItem = txtItemId ? db.getKnowledgeItem(txtItemId) : null;
  if (txtItem?.content !== 'Exact text source.' || txtItem.sourceType !== 'file') {
    throw new Error('Text ingest did not store exact extracted source content.');
  }

  const pdfText = await extractKnowledgeFileText(pdfPath, '.pdf');
  if (!pdfText.includes('PDF source text')) {
    throw new Error('PDF extraction did not return expected text.');
  }

  const zipEntries = await unzipBuffer(await createZip({
    'nested/store.txt': 'Stored zip text.',
    'nested/deflate.txt': 'Deflated zip text.',
    '../unsafe.txt': 'Unsafe path text.'
  }));
  if (!zipEntries.some((entry) => entry.path === 'nested/store.txt' && entry.data.toString('utf8') === 'Stored zip text.')) {
    throw new Error('ZIP extraction did not read a nested stored file.');
  }
  if (!zipEntries.some((entry) => entry.path === 'nested/deflate.txt' && entry.data.toString('utf8') === 'Deflated zip text.')) {
    throw new Error('ZIP extraction did not read a deflated file.');
  }
  if (zipEntries.some((entry) => entry.path.includes('..'))) {
    throw new Error('ZIP extraction did not sanitize unsafe relative paths.');
  }
  const corruptZip = Buffer.from(await createZip({ 'broken.txt': 'CRC check text.' }, 'STORE'));
  const corruptOffset = corruptZip.indexOf('CRC check text.');
  if (corruptOffset < 0) {
    throw new Error('ZIP corruption fixture did not include stored text.');
  }
  corruptZip[corruptOffset] = corruptZip[corruptOffset] ^ 0xff;
  let corruptZipRejected = false;
  try {
    await unzipBuffer(corruptZip);
  } catch {
    corruptZipRejected = true;
  }
  if (!corruptZipRejected) {
    throw new Error('ZIP extraction did not reject a corrupted archive.');
  }

  const mineruSettings = {
    pdfExtractionEngine: 'mineru',
    mineru: {
      apiKey: 'mineru-test-key',
      modelVersion: 'vlm',
      language: 'ch',
      isOcr: false,
      enableTable: true,
      enableFormula: true
    }
  };
  process.env.WRITELLM_MINERU_POLL_INTERVAL_MS = '0';
  const originalFetch = globalThis.fetch;
  try {
    const mineruPdfPath = path.join(workspacePath, 'mineru.pdf');
    writeFileSync(mineruPdfPath, createSamplePdf('MinerU PDF source'));
    await enqueueKnowledgeFiles(db, [mineruPdfPath], mineruSettings);
    const mineruJob = db.listKnowledgeIngestJobs().find((job) => job.fileName === 'mineru.pdf');
    if (!mineruJob || mineruJob.metadata.extractionEngine !== 'mineru') {
      throw new Error('MinerU import did not snapshot the extraction engine.');
    }

    let uploadSeen = false;
    let pollCount = 0;
    const mineruZip = await createZip({
      'full.md': '# MinerU Markdown\n\nMarkdown should be primary.\n\n![Figure caption text.](images/fig1.png)',
      'sample_content_list.json': JSON.stringify([
        { type: 'text', text: 'MinerU primary text block.', page_idx: 0 },
        {
          type: 'image',
          img_path: 'images/fig1.png',
          image_caption: ['Figure caption text.'],
          image_footnote: ['Figure footnote text.'],
          page_idx: 0,
          bbox: [1, 2, 3, 4]
        }
      ]),
      'images/fig1.png': Buffer.from([137, 80, 78, 71])
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        const body = JSON.parse(String(init.body));
        if (body.files?.[0]?.data_id !== mineruJob.id || body.model_version !== 'vlm') {
          throw new Error('MinerU batch request did not include expected task data.');
        }
        return jsonResponse({
          code: 0,
          data: {
            batch_id: 'batch-smoke',
            file_urls: ['https://upload.mineru.test/file.pdf']
          }
        });
      }
      if (href === 'https://upload.mineru.test/file.pdf') {
        if (init.method !== 'PUT') {
          throw new Error('MinerU upload did not use PUT.');
        }
        uploadSeen = true;
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-smoke')) {
        pollCount += 1;
        return jsonResponse({
          code: 0,
          data: {
            extract_result: [
              pollCount === 1
                ? {
                    data_id: mineruJob.id,
                    state: 'running',
                    progress: 50,
                    extract_progress: {
                      extracted_pages: 1,
                      total_pages: 2,
                      start_time: '2026-05-04 10:00:00'
                    }
                  }
                : { data_id: mineruJob.id, state: 'done', progress: 100, full_zip_url: 'https://download.mineru.test/result.zip' }
            ]
          }
        });
      }
      if (href === 'https://download.mineru.test/result.zip') {
        return new Response(mineruZip, { status: 200 });
      }
      throw new Error(`Unexpected MinerU fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, mineruJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings, fakeEmbeddingSettings);
    const mineruItemId = db.getKnowledgeIngestJob(mineruJob.id)?.knowledgeItemId;
    const mineruItem = mineruItemId ? db.getKnowledgeItem(mineruItemId) : null;
    if (!uploadSeen || pollCount !== 2) {
      throw new Error('MinerU import did not upload and poll as expected.');
    }
    const mineruJobAfter = db.getKnowledgeIngestJob(mineruJob.id);
    if (
      mineruJobAfter?.metadata.mineru?.extractProgress?.extractedPages !== 1 ||
      mineruJobAfter.metadata.mineru.extractProgress.totalPages !== 2
    ) {
      throw new Error('MinerU page extraction progress was not stored on the ingest job.');
    }
    if (!mineruItem?.content.includes('# MinerU Markdown') || mineruItem.content.includes('MinerU primary text block.')) {
      throw new Error('MinerU full markdown was not used as primary indexed text.');
    }
    const mineruMetadata = mineruItem.metadata.mineru;
    if (!mineruMetadata || !Array.isArray(mineruMetadata.images) || !mineruMetadata.images[0]?.relativePath) {
      throw new Error('MinerU image asset metadata was not stored.');
    }

    const fallbackJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-fallback.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: {
        extractionEngine: 'mineru',
        mineru: {
          modelVersion: 'vlm',
          language: 'ch',
          isOcr: false,
          enableTable: true,
          enableFormula: true
        }
      }
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'batch-fallback', file_urls: ['https://upload.mineru.test/fallback.pdf'] } });
      }
      if (href === 'https://upload.mineru.test/fallback.pdf') {
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-fallback')) {
        return jsonResponse({
          code: 0,
          data: { extract_result: [{ data_id: fallbackJob.id, state: 'done', full_zip_url: 'https://download.mineru.test/fallback.zip' }] }
        });
      }
      if (href === 'https://download.mineru.test/fallback.zip') {
        return new Response(await createZip({ 'full.md': 'Fallback markdown text.' }), { status: 200 });
      }
      throw new Error(`Unexpected MinerU fallback fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, fallbackJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings, fakeEmbeddingSettings);
    const fallbackItemId = db.getKnowledgeIngestJob(fallbackJob.id)?.knowledgeItemId;
    const fallbackItem = fallbackItemId ? db.getKnowledgeItem(fallbackItemId) : null;
    if (fallbackItem?.content !== 'Fallback markdown text.') {
      throw new Error('MinerU fallback markdown was not used when content list was missing.');
    }

    const mineruFailedJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-failed.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: {
        extractionEngine: 'mineru',
        mineru: {
          modelVersion: 'vlm',
          language: 'ch',
          isOcr: false,
          enableTable: true,
          enableFormula: true
        }
      }
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'batch-failed', file_urls: ['https://upload.mineru.test/failed.pdf'] } });
      }
      if (href === 'https://upload.mineru.test/failed.pdf') {
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-failed')) {
        return jsonResponse({
          code: 0,
          data: { extract_result: [{ data_id: mineruFailedJob.id, state: 'failed', err_msg: 'remote parse failed' }] }
        });
      }
      throw new Error(`Unexpected MinerU failed fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, mineruFailedJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings, fakeEmbeddingSettings);
    if (db.getKnowledgeIngestJob(mineruFailedJob.id)?.status !== 'error') {
      throw new Error('MinerU failed remote state did not mark the ingest job as error.');
    }

    const missingKeyJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-missing-key.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: { extractionEngine: 'mineru' }
    });
    await processKnowledgeIngestJob(
      db,
      missingKeyJob.id,
      fakeEmbeddingSettings,
      fakeIndexKnowledgeItem,
      { ...mineruSettings, mineru: { ...mineruSettings.mineru, apiKey: '' } },
      fakeEmbeddingSettings
    );
    if (!db.getKnowledgeIngestJob(missingKeyJob.id)?.errorMessage?.includes('API key')) {
      throw new Error('MinerU missing API key did not surface a clear error.');
    }

    const missingZipJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-missing-zip.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: { extractionEngine: 'mineru' }
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'batch-missing-zip', file_urls: ['https://upload.mineru.test/missing-zip.pdf'] } });
      }
      if (href === 'https://upload.mineru.test/missing-zip.pdf') {
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-missing-zip')) {
        return jsonResponse({ code: 0, data: { extract_result: [{ data_id: missingZipJob.id, state: 'done' }] } });
      }
      throw new Error(`Unexpected MinerU missing zip fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, missingZipJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings, fakeEmbeddingSettings);
    if (!db.getKnowledgeIngestJob(missingZipJob.id)?.errorMessage?.includes('full_zip_url')) {
      throw new Error('MinerU done without full_zip_url did not surface a clear error.');
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.WRITELLM_MINERU_POLL_INTERVAL_MS;
  }

  const legacyWorkspacePath = path.join(workspacePath, 'legacy.writellm');
  mkdirSync(legacyWorkspacePath, { recursive: true });
  const legacyRawDb = new Database(path.join(legacyWorkspacePath, 'project.sqlite'));
  legacyRawDb.exec(`
    CREATE TABLE knowledge_ingest_jobs (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_ext TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      knowledge_item_id TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    INSERT INTO knowledge_ingest_jobs
      (id, file_path, file_name, file_ext, file_size, knowledge_item_id, status, error_message, created_at, updated_at, started_at, finished_at)
    VALUES
      ('legacy-ingest', '/tmp/legacy.pdf', 'legacy.pdf', '.pdf', 10, NULL, 'queued', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL);
    PRAGMA user_version = 4;
  `);
  legacyRawDb.close();
  const legacyDb = new WriteLLMDatabase(legacyWorkspacePath);
  const legacyIngestTable = legacyDb.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_ingest_jobs'")
    .get();
  if (legacyIngestTable) {
    throw new Error('Legacy ingest table was not dropped during plainjob migration.');
  }
  if (legacyDb.listKnowledgeIngestJobs().length !== 0) {
    throw new Error('Legacy ingest jobs should not be imported into plainjob.');
  }
  legacyDb.close();

  const missingJob = db.enqueueKnowledgeIngestJob({
    filePath: path.join(workspacePath, 'missing.txt'),
    fileName: 'missing.txt',
    fileExt: '.txt',
    fileSize: 0
  });
  await processKnowledgeIngestJob(db, missingJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, undefined, fakeEmbeddingSettings);
  const failedJob = db.getKnowledgeIngestJob(missingJob.id);
  if (failedJob?.status !== 'error' || !failedJob.errorMessage) {
    throw new Error('Failed extraction did not mark the ingest job as error.');
  }
  const failedItem = failedJob.knowledgeItemId ? db.getKnowledgeItem(failedJob.knowledgeItemId) : null;
  if (failedItem?.indexStatus !== 'error' || !failedItem.metadata.extractionError) {
    throw new Error('Failed extraction did not mark the knowledge item as error.');
  }
  db.retryKnowledgeIngestJob(missingJob.id);
  if (db.getKnowledgeIngestJob(missingJob.id)?.status !== 'queued') {
    throw new Error('Retry did not requeue the failed ingest job.');
  }
  db.updateKnowledgeIngestJob(missingJob.id, { status: 'extracting' });
  if (!db.listRunnableKnowledgeIngestJobs().some((job) => job.id === missingJob.id)) {
    throw new Error('Interrupted ingest jobs are not resumable.');
  }
  const failedItemId = db.getKnowledgeIngestJob(missingJob.id)?.knowledgeItemId;
  db.deleteKnowledgeIngestJob(missingJob.id);
  if (db.getKnowledgeIngestJob(missingJob.id)) {
    throw new Error('Deleting an ingest job did not remove the queue entry.');
  }
  if (failedItemId && db.getKnowledgeItem(failedItemId)) {
    throw new Error('Deleting an ingest job did not remove its knowledge item.');
  }

  db.updateNode(intro.id, { title: 'Renamed intro', intent: 'State the problem.' });
  const renamed = db.getSection(intro.id);
  if (renamed?.title !== 'Renamed intro' || renamed.intent !== 'State the problem.') {
    throw new Error('Section update did not persist.');
  }

  db.deleteNode(source.id);
  if (db.listEdges().length !== 0) {
    throw new Error('Deleting content did not clean up edges.');
  }

  db.deleteNode(intro.id);
  if (db.getNode(intro.id)) {
    throw new Error('Deleted section is still listed.');
  }

  const first = db.createNode({ kind: 'section', parentId: rootId, title: 'First', intent: '' });
  const second = db.createNode({ kind: 'section', parentId: rootId, title: 'Second', intent: '' });
  if (first.kind !== 'section' || second.kind !== 'section') {
    throw new Error('Ordering smoke sections were not created.');
  }
  const firstText = db.createNode({
    kind: 'content',
    parentId: first.id,
    title: 'First main',
    content: 'FIRST',
    isMain: true
  });
  const secondText = db.createNode({
    kind: 'content',
    parentId: second.id,
    title: 'Second main',
    content: 'SECOND',
    isMain: true
  });
  if (firstText.kind !== 'content' || secondText.kind !== 'content') {
    throw new Error('Ordering smoke content records were not created.');
  }
  db.setActiveMainNode(first.id, firstText.id);
  db.setActiveMainNode(second.id, secondText.id);
  db.moveNode(second.id, rootId, 0);
  const reorderedPath = exportLatex(db, rootId);
  const reorderedOutput = readFileSync(reorderedPath, 'utf8');
  if (reorderedOutput.indexOf('SECOND') > reorderedOutput.indexOf('FIRST')) {
    throw new Error('moveNode did not update export order.');
  }

  db.close();
  console.log('electron-smoke ok');
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
}

function assertCitationParsing() {
  const single = citationRefsFromText('Claim [c0b8f37.c5].');
  if (single.length !== 1 || single[0] !== 'c0b8f37.c5') {
    throw new Error('Single citation parsing failed.');
  }

  const grouped = citationRefsFromText('Claim [c0b8f37.c5, ff711ca.c4, bd890ea.c16].');
  if (grouped.join(',') !== 'c0b8f37.c5,ff711ca.c4,bd890ea.c16') {
    throw new Error('Grouped citation parsing failed.');
  }

  const adjacentGroups = citationGroupsFromText('Claim [c0b8f37.c5] [ff711ca.c4].');
  if (adjacentGroups.length !== 1 || adjacentGroups[0].refs.join(',') !== 'c0b8f37.c5,ff711ca.c4') {
    throw new Error('Adjacent citation grouping failed.');
  }

  const normalized = citationRefsFromText('Claim [ C0B8F37.c5 , ff711ca.C4 ].');
  if (normalized.join(',') !== 'c0b8f37.c5,ff711ca.c4') {
    throw new Error('Citation whitespace or case normalization failed.');
  }

  const nonCitations = citationRefsFromText(
    'See [the docs](https://example.test), [c0b8f37.c5](https://example.test), ![c0b8f37.c5](image.png), and [not a citation].'
  );
  if (nonCitations.length !== 0) {
    throw new Error('Markdown links or non-citation brackets were parsed as citations.');
  }
}

function createSamplePdf(text) {
  const escapedText = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];
  const stream = `BT /F1 24 Tf 72 720 Td (${escapedText}) Tj ET`;
  objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);

  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(output.length);
    output += object;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return output;
}

function makeSelectionPatch(section, { id, before, after, startOffset, endOffset }) {
  const now = new Date().toISOString();
  return {
    id,
    kind: 'replace_selection',
    status: 'proposed',
    origin: {
      source: 'llm',
      generationSessionId: 'gens_smoke',
      generationRoundId: 'genr_smoke',
      createdAt: now
    },
    target: {
      workspaceId: workspacePath,
      sectionId: section.id,
      targetMode: 'section_markdown_file',
      location: {
        type: 'text_range',
        startOffset,
        endOffset,
        selectedText: before
      }
    },
    anchors: {
      baseSectionHash: section.markdownHash,
      beforeText: before,
      beforeTextHash: hashText(before),
      anchorStrategy: 'hash_and_range'
    },
    operation: {
      type: 'replace',
      before,
      after
    },
    metadata: {
      rationale: 'Smoke-test selection patch.'
    },
    review: {
      decision: 'pending'
    }
  };
}

function makeInsertPatch(section, { id, text, mode, offset }) {
  const now = new Date().toISOString();
  return {
    id,
    kind: 'insert_at_cursor',
    status: 'proposed',
    origin: {
      source: 'llm',
      generationSessionId: 'gens_smoke',
      generationRoundId: `${id}_round`,
      createdAt: now
    },
    target: {
      workspaceId: workspacePath,
      sectionId: section.id,
      targetMode: 'section_markdown_file',
      location: {
        type: 'insertion',
        mode,
        offset,
        insertionAffinity: 'after'
      }
    },
    anchors: {
      baseSectionHash: section.markdownHash,
      beforeText: '',
      beforeTextHash: hashText(''),
      anchorStrategy: 'hash_and_range'
    },
    operation: {
      type: 'insert',
      text,
      position: 'at'
    },
    metadata: {
      rationale: 'Smoke-test insertion patch.'
    },
    review: {
      decision: 'pending'
    }
  };
}

function makeCandidatePatch(section, content) {
  const now = new Date().toISOString();
  return {
    id: 'wpatch_smoke_candidate',
    kind: 'create_content_candidate',
    status: 'proposed',
    origin: {
      source: 'llm',
      generationSessionId: 'gens_smoke',
      generationRoundId: 'genr_smoke_candidate',
      createdAt: now
    },
    target: {
      workspaceId: workspacePath,
      sectionId: section.id,
      targetMode: 'new_content_node',
      location: {
        type: 'section',
        sectionHash: section.markdownHash
      }
    },
    anchors: {
      baseSectionHash: section.markdownHash,
      anchorStrategy: 'candidate_only'
    },
    operation: {
      type: 'create_candidate',
      candidateTitle: 'Patch candidate',
      content,
      relationToSource: 'revises'
    },
    metadata: {
      rationale: 'Smoke-test candidate patch.'
    },
    review: {
      decision: 'pending'
    }
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function embeddingForSourceV2Query(query) {
  const normalized = query.toLowerCase();
  if (normalized.includes('followup')) {
    return [0, 1, 0];
  }
  if (normalized.includes('round three')) {
    return [0, 0, 2];
  }
  if (normalized.includes('round two')) {
    return [0, 0, 1];
  }
  return [1, 0, 0];
}

function chunkIdsFromPrompt(prompt) {
  return Array.from(prompt.matchAll(/chunkId:\s*(\S+)/g), (match) => match[1]);
}

async function createZip(entries, compression = 'DEFLATE') {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(entries)) {
    zip.file(name, Buffer.isBuffer(value) ? value : Buffer.from(String(value)), { compression });
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression }));
}
