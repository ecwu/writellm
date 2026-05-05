import { BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ipcChannels } from '../shared/ipc.js';
import type {
  ApplySectionLlmEditPayload,
  CompositionTreeNode,
  ContentNodeRecord,
  CreateKnowledgeItemPayload,
  EnqueueKnowledgeFilesPayload,
  CreateNodePayload,
  EdgeKind,
  GenerateLlmPayload,
  KnowledgeSourceTarget,
  KnowledgeSearchPayload,
  LlmOperationRecord,
  RetrievedKnowledgeSource,
  NodeRecord,
  SectionLlmEditMode,
  SaveLlmGenerationPayload,
  UpdateKnowledgeItemPayload,
  UpdateNodeLayoutPayload,
  UpdateNodePayload
} from '../shared/types.js';
import { exportLatex } from './exportLatex.js';
import {
  createGitCheckpoint,
  getGitHead,
  getGitStatus,
  listGitHistory
} from './gitSession.js';
import { startBackgroundTaskWorker } from './backgroundTasks.js';
import { enqueueKnowledgeFiles, setKnowledgeIngestUpdateNotifier } from './knowledgeIngest.js';
import { streamLlmText } from './llmRunner.js';
import {
  readLlmSettings,
  readPublicLlmSettings,
  updateAppearanceSettings,
  updateLlmSettings
} from './llmSettings.js';
import { getSectionHistoryDetail, restoreSectionVersion } from './sectionHistory.js';
import {
  formatSourcesForPrompt,
  getKnowledgeChunkingDebugConfig,
  indexKnowledgeItem,
  retrieveKnowledgeSources
} from './knowledgeIndex.js';
import {
  createWorkspace,
  getActiveDb,
  getState,
  listRecentWorkspaces,
  openWorkspace
} from './workspace.js';
import { createId, nowIso } from './ids.js';
import { hashMarkdown, sectionMarkdownForStorage } from './sectionMarkdown.js';

const llmRuns = new Map<string, AbortController>();

function titleFromPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim() || 'LLM generation';
}

function formatArticleStructure(
  nodes: CompositionTreeNode[],
  focusSectionId: string,
  targetSectionId: string
): string {
  const lines: string[] = [];

  const visit = (node: CompositionTreeNode, depth: number): void => {
    const prefix = '  '.repeat(depth);
    const markers = [
      node.id === focusSectionId ? 'focused section' : null,
      node.id === targetSectionId && node.id !== focusSectionId ? 'generation target' : null
    ].filter(Boolean);
    const markerText = markers.length > 0 ? ` (${markers.join(', ')})` : '';
    lines.push(`${prefix}- ${node.title}${markerText}`);
    node.children.forEach((child) => visit(child, depth + 1));
  };

  nodes.forEach((node) => visit(node, 0));
  return lines.join('\n') || '- No sections';
}

function formatSectionContext(label: string, section: CompositionTreeNode): string {
  const trimmedIntent = section.intent?.trim();
  const trimmedMarkdown = section.markdownContent.trim();

  return [
    `${label}:`,
    `- Section title: ${section.title}`,
    `- Section intent: ${trimmedIntent || 'Not provided'}`,
    `- Current Markdown: ${trimmedMarkdown || 'Empty'}`
  ].join('\n');
}

function buildArticleSectionContext(
  focusSection: CompositionTreeNode,
  targetSection: CompositionTreeNode,
  articleStructure: CompositionTreeNode[]
): string {
  const sections = [
    'Article structure:',
    formatArticleStructure(articleStructure, focusSection.id, targetSection.id),
    '',
    formatSectionContext('Focused section context', focusSection)
  ];

  if (targetSection.id !== focusSection.id) {
    sections.push('', formatSectionContext('Generation target section context', targetSection));
  }

  sections.push(
    '',
    'Use the article structure, focused section context, and generation target context to scope the generation. Do not include these metadata labels in the output unless explicitly requested.'
  );

  return sections.join('\n');
}

function findSectionInTree(
  nodes: CompositionTreeNode[],
  sectionId: string
): CompositionTreeNode | null {
  for (const node of nodes) {
    if (node.id === sectionId) {
      return node;
    }
    const child = findSectionInTree(node.children, sectionId);
    if (child) {
      return child;
    }
  }

  return null;
}

function buildArticleSectionContextFromDb(
  db: ReturnType<typeof getActiveDb>,
  targetSectionId: string,
  focusSectionId?: string | null
): string {
  const resolvedFocusSectionId = focusSectionId ?? targetSectionId;
  const state = db.getState(resolvedFocusSectionId);
  const targetSection = findSectionInTree(state.compositionTree, targetSectionId);
  if (!targetSection) {
    throw new Error(`Section not found: ${targetSectionId}`);
  }
  const focusSection = findSectionInTree(state.compositionTree, resolvedFocusSectionId) ?? targetSection;

  return buildArticleSectionContext(focusSection, targetSection, state.compositionTree);
}

function getSelectedContextNodes(
  db: ReturnType<typeof getActiveDb>,
  nodeIds: string[] | undefined
): ContentNodeRecord[] {
  const selectedIds = new Set(nodeIds ?? []);
  if (selectedIds.size === 0) {
    return [];
  }

  return db
    .listNodes()
    .filter(
      (node): node is ContentNodeRecord =>
        node.kind === 'content' &&
        selectedIds.has(node.id) &&
        node.metadata.nodeRole !== 'knowledge-source' &&
        Boolean(node.content.trim())
    );
}

function knowledgeSourceTitle(source: RetrievedKnowledgeSource): string {
  return source.itemTitle.trim() || 'Knowledge source';
}

function isKnowledgeSourceNode(node: NodeRecord, sectionId: string, itemId: string): node is ContentNodeRecord {
  return node.kind === 'content' &&
    node.parentId === sectionId &&
    node.metadata.nodeRole === 'knowledge-source' &&
    node.metadata.knowledgeItemId === itemId;
}

function findOrCreateKnowledgeSourceNode(
  db: ReturnType<typeof getActiveDb>,
  sectionId: string,
  sources: RetrievedKnowledgeSource[]
): ContentNodeRecord {
  const source = sources[0];
  const existing = db.listNodes().find((node) => isKnowledgeSourceNode(node, sectionId, source.itemId));
  if (existing) {
    const merged = mergeKnowledgeSourceNode(existing, sources);
    if (merged.content !== existing.content || JSON.stringify(merged.metadata) !== JSON.stringify(existing.metadata)) {
      db.updateNode(existing.id, {
        content: merged.content,
        metadata: merged.metadata
      });
      return db.getNode(existing.id) as ContentNodeRecord;
    }
    return existing;
  }

  const created = db.createNode({
    kind: 'content',
    parentId: sectionId,
    title: knowledgeSourceTitle(source),
    content: formatMergedSourceContent(sources),
    isMain: false,
    isLlm: false,
    metadata: {
      nodeRole: 'knowledge-source',
      publicRef: source.publicRef,
      knowledgeItemId: source.itemId,
      knowledgeItemPublicRef: source.itemPublicRef,
      knowledgeItemTitle: source.itemTitle,
      knowledgeChunkId: source.chunkId,
      knowledgeChunkIndex: source.chunkIndex,
      score: source.score,
      sourceChunks: sourceChunksMetadata(sources)
    }
  });

  if (created.kind !== 'content') {
    throw new Error('Knowledge source node was not created as content.');
  }
  return created;
}

function mergeKnowledgeSourceNode(
  node: ContentNodeRecord,
  sources: RetrievedKnowledgeSource[]
): Pick<ContentNodeRecord, 'content' | 'metadata'> {
  const existingChunks = Array.isArray(node.metadata.sourceChunks)
    ? node.metadata.sourceChunks.filter(isSourceChunkMetadata)
    : [];
  const chunksById = new Map(existingChunks.map((chunk) => [chunk.chunkId, chunk]));
  sourceChunksMetadata(sources).forEach((chunk) => {
    chunksById.set(chunk.chunkId, chunk);
  });
  const mergedChunks = [...chunksById.values()].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const first = sources[0];
  return {
    content: formatSourceChunksContent(mergedChunks),
    metadata: {
      ...node.metadata,
      publicRef: first.publicRef,
      knowledgeChunkId: first.chunkId,
      knowledgeChunkIndex: first.chunkIndex,
      score: Math.max(
        typeof node.metadata.score === 'number' ? node.metadata.score : 0,
        ...sources.map((source) => source.score)
      ),
      sourceChunks: mergedChunks
    }
  };
}

type SourceChunkMetadata = {
  publicRef: string;
  chunkId: string;
  chunkIndex: number;
  snippet: string;
  score: number;
};

function sourceChunksMetadata(sources: RetrievedKnowledgeSource[]): SourceChunkMetadata[] {
  return sources
    .map((source) => ({
      publicRef: source.publicRef,
      chunkId: source.chunkId,
      chunkIndex: source.chunkIndex,
      snippet: source.snippet,
      score: source.score
    }))
    .sort((left, right) => left.chunkIndex - right.chunkIndex);
}

function isSourceChunkMetadata(value: unknown): value is SourceChunkMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SourceChunkMetadata>;
  return (
    typeof candidate.publicRef === 'string' &&
    typeof candidate.chunkId === 'string' &&
    typeof candidate.chunkIndex === 'number' &&
    typeof candidate.snippet === 'string' &&
    typeof candidate.score === 'number'
  );
}

function formatMergedSourceContent(sources: RetrievedKnowledgeSource[]): string {
  return formatSourceChunksContent(sourceChunksMetadata(sources));
}

function formatSourceChunksContent(chunks: SourceChunkMetadata[]): string {
  return chunks
    .map((chunk) => `[${chunk.publicRef}] ${chunk.snippet}`)
    .join('\n\n---\n\n');
}

function ensureKnowledgeSourceNodes(
  db: ReturnType<typeof getActiveDb>,
  canvasSectionId: string,
  targetSectionId: string,
  sources: RetrievedKnowledgeSource[]
): void {
  const sourcesByItem = new Map<string, RetrievedKnowledgeSource[]>();
  sources.forEach((source) => {
    const itemSources = sourcesByItem.get(source.itemId) ?? [];
    itemSources.push(source);
    sourcesByItem.set(source.itemId, itemSources);
  });
  for (const itemSources of sourcesByItem.values()) {
    const sourceNode = findOrCreateKnowledgeSourceNode(db, canvasSectionId, itemSources);
    const hasEdge = db.listEdges().some(
      (edge) =>
        edge.fromNodeId === sourceNode.id &&
        edge.toNodeId === targetSectionId &&
        edge.relationType === 'cites'
    );
    if (!hasEdge) {
      db.createNodeEdge(sourceNode.id, targetSectionId, 'cites', 'llm');
    }
  }
}

function buildContextPrompt(
  basePrompt: string,
  contextNodes: ContentNodeRecord[],
  articleSectionContext: string,
  retrievedSources: RetrievedKnowledgeSource[] = [],
  requireInlineCitations = true
): string {
  const promptSections = [
    'Use the following article and section context for this generation.',
    articleSectionContext
  ];

  const sourcesPrompt = formatSourcesForPrompt(retrievedSources);
  if (sourcesPrompt) {
    promptSections.push('', sourcesPrompt);
    if (requireInlineCitations) {
      promptSections.push(
        '',
        'Inline citations are required for source-backed claims. Keep citation markers in the generated text.'
      );
    }
  }

  if (contextNodes.length > 0) {
    const contextText = contextNodes
      .map((node, index) => {
        const flags = [
          node.isMain ? 'main' : null,
          node.isLlm ? 'llm' : null
        ].filter(Boolean).join(', ') || 'content';
        return [
          `[${index + 1}] ${node.title} (${flags})`,
          node.content.trim() || '(empty)'
        ].join('\n');
      })
      .join('\n\n---\n\n');

    promptSections.push(
      '',
      'Use the following selected content nodes as additional context. Do not copy them verbatim unless the user asks for it.',
      contextText
    );
  }

  promptSections.push('', 'User prompt:', basePrompt);
  return promptSections.join('\n');
}

function buildKnowledgeRetrievalQueries(
  prompt: string,
  articleSectionContext: string,
  contextNodes: ContentNodeRecord[]
): string[] {
  const queries = [prompt];
  const sectionLines = articleSectionContext
    .split('\n')
    .filter((line) =>
      line.startsWith('- Section title:') ||
      line.startsWith('- Section intent:') ||
      line.startsWith('- Current Markdown:')
    )
    .join('\n')
    .slice(0, 1800);
  if (sectionLines.trim()) {
    queries.push(`${sectionLines}\n\n${prompt}`);
  }
  const contextSummary = contextNodes
    .map((node) => `${node.title}\n${node.content.trim().slice(0, 900)}`)
    .filter((text) => text.trim())
    .join('\n\n---\n\n')
    .slice(0, 2200);
  if (contextSummary.trim()) {
    queries.push(`${contextSummary}\n\n${prompt}`);
  }
  return queries;
}

export function registerIpcHandlers(): void {
  setKnowledgeIngestUpdateNotifier(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcChannels.knowledgeIngestUpdated);
    }
  });

  ipcMain.handle(ipcChannels.createWorkspace, async (_event, workspacePath: string) =>
    createWorkspace(workspacePath)
  );

  ipcMain.handle(ipcChannels.openWorkspace, async (_event, workspacePath: string) =>
    openWorkspace(workspacePath)
  );

  ipcMain.handle(ipcChannels.listRecentWorkspaces, () => listRecentWorkspaces());

  ipcMain.handle(ipcChannels.pickWorkspaceFolder, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Open writellm workspace',
      properties: ['openDirectory'] as Electron.OpenDialogOptions['properties']
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const workspacePath = result.filePaths[0];
    if (path.extname(workspacePath) !== '.writellm') {
      throw new Error('Choose a .writellm folder.');
    }
    return workspacePath;
  });

  ipcMain.handle(ipcChannels.pickNewWorkspacePath, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Create writellm workspace',
      defaultPath: 'Untitled.writellm',
      filters: [{ name: 'writellm Workspace', extensions: ['writellm'] }]
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath.endsWith('.writellm') ? result.filePath : `${result.filePath}.writellm`;
  });

  ipcMain.handle(ipcChannels.pickKnowledgeFiles, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Import knowledge files',
      properties: ['openFile', 'multiSelections'] as Electron.OpenDialogOptions['properties'],
      filters: [
        { name: 'Knowledge files', extensions: ['txt', 'md', 'pdf'] },
        { name: 'Text and Markdown', extensions: ['txt', 'md'] },
        { name: 'PDF', extensions: ['pdf'] }
      ]
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(ipcChannels.getState, (_event, focusSectionId?: string) =>
    getState(focusSectionId)
  );

  ipcMain.handle(
    ipcChannels.updateSectionMarkdown,
    (_event, sectionId: string, markdown: string) => {
      getActiveDb().updateSectionMarkdown(sectionId, markdown);
      return getState(sectionId);
    }
  );

  ipcMain.handle(ipcChannels.getGitStatus, () =>
    getGitStatus(getActiveDb().workspacePath)
  );

  ipcMain.handle(ipcChannels.createGitCheckpoint, (_event, message?: string) =>
    createGitCheckpoint(getActiveDb().workspacePath, message)
  );

  ipcMain.handle(ipcChannels.listGitHistory, (_event, sectionId?: string) =>
    listGitHistory(getActiveDb().workspacePath, sectionId)
  );

  ipcMain.handle(
    ipcChannels.getSectionHistoryDetail,
    (_event, sectionId: string, commitHash: string) =>
      getSectionHistoryDetail(getActiveDb(), sectionId, commitHash)
  );

  ipcMain.handle(
    ipcChannels.restoreSectionVersion,
    (_event, sectionId: string, commitHash: string) => {
      const db = getActiveDb();
      restoreSectionVersion(db, sectionId, commitHash);
      return getState(sectionId);
    }
  );

  ipcMain.handle(ipcChannels.createNode, (_event, payload: CreateNodePayload) => {
    const db = getActiveDb();
    const node = db.createNode(payload);
    if (node.kind === 'section') {
      createGitCheckpoint(db.workspacePath, `Structure update: ${node.title}`);
    }
    return getState(node.kind === 'section' ? node.parentId ?? node.id : node.parentId);
  });

  ipcMain.handle(
    ipcChannels.updateNode,
    (_event, nodeId: string, payload: UpdateNodePayload) => {
      const db = getActiveDb();
      const previousNode = db.getNode(nodeId);
      db.updateNode(nodeId, payload);
      const node = db.getNode(nodeId);
      if (
        node?.kind === 'section' &&
        previousNode?.kind === 'section' &&
        isSectionStructureUpdate(payload)
      ) {
        createGitCheckpoint(db.workspacePath, `Structure update: ${node.title}`);
      }
      return getState(node?.kind === 'section' ? node.id : node?.parentId ?? undefined);
    }
  );

  ipcMain.handle(ipcChannels.deleteNode, (_event, nodeId: string) => {
    const db = getActiveDb();
    const node = db.getNode(nodeId);
    const parentSectionId = db.getParentSectionId(nodeId) ?? db.rootNodeId;
    db.deleteNode(nodeId);
    if (node?.kind === 'section') {
      createGitCheckpoint(db.workspacePath, `Structure update: ${node.title}`);
    }
    return getState(parentSectionId);
  });

  ipcMain.handle(
    ipcChannels.moveNode,
    (_event, nodeId: string, newParentId: string | null, index: number) => {
      const db = getActiveDb();
      const node = db.getNode(nodeId);
      db.moveNode(nodeId, newParentId, index);
      if (node?.kind === 'section') {
        createGitCheckpoint(db.workspacePath, `Structure update: ${node.title}`);
      }
      return getState(newParentId ?? undefined);
    }
  );

  ipcMain.handle(
    ipcChannels.setActiveMainNode,
    (_event, sectionId: string, contentNodeId: string | null) => {
      getActiveDb().setActiveMainNode(sectionId, contentNodeId);
      return getState(sectionId);
    }
  );

  ipcMain.handle(
    ipcChannels.updateNodeLayout,
    (_event, payload: UpdateNodeLayoutPayload) => {
      getActiveDb().updateNodeLayout(payload);
      return getState(payload.canvasSectionId);
    }
  );

  ipcMain.handle(
    ipcChannels.createNodeEdge,
    (_event, fromNodeId: string, toNodeId: string, relationType: EdgeKind) =>
      getActiveDb().createNodeEdge(fromNodeId, toNodeId, relationType)
  );

  ipcMain.handle(
    ipcChannels.updateNodeEdge,
    (_event, edgeId: string, relationType: EdgeKind, focusSectionId?: string | null) => {
      getActiveDb().updateNodeEdge(edgeId, relationType);
      return getState(focusSectionId ?? undefined);
    }
  );

  ipcMain.handle(
    ipcChannels.deleteNodeEdge,
    (_event, edgeId: string, focusSectionId?: string | null) => {
      getActiveDb().deleteNodeEdge(edgeId);
      return getState(focusSectionId ?? undefined);
    }
  );

  ipcMain.handle(ipcChannels.exportLatex, (_event, rootNodeId: string) => ({
    path: exportLatex(getActiveDb(), rootNodeId)
  }));

  ipcMain.handle(ipcChannels.getLlmSettings, () => readPublicLlmSettings());

  ipcMain.handle(ipcChannels.updateLlmSettings, (_event, payload) =>
    updateLlmSettings(payload)
  );

  ipcMain.handle(ipcChannels.updateAppearanceSettings, (_event, payload) =>
    updateAppearanceSettings(payload)
  );

  ipcMain.handle(ipcChannels.createKnowledgeItem, async (_event, payload: CreateKnowledgeItemPayload) => {
    const db = getActiveDb();
    const item = db.createKnowledgeItem(payload.title, payload.content);
    const settings = readLlmSettings();
    try {
      await indexKnowledgeItem(db, item.id, settings.embedding, settings.chat);
    } catch {
      // The item remains editable with an error status so the user can fix settings and reindex.
    }
    return getState();
  });

  ipcMain.handle(ipcChannels.enqueueKnowledgeFiles, async (_event, payload: EnqueueKnowledgeFilesPayload) => {
    const db = getActiveDb();
    await enqueueKnowledgeFiles(db, payload.filePaths, readLlmSettings().knowledge);
    await startBackgroundTaskWorker(db);
    return getState();
  });

  ipcMain.handle(ipcChannels.retryKnowledgeIngestJob, async (_event, jobId: string) => {
    const db = getActiveDb();
    db.retryKnowledgeIngestJob(jobId);
    await startBackgroundTaskWorker(db);
    return getState();
  });

  ipcMain.handle(ipcChannels.deleteKnowledgeIngestJob, (_event, jobId: string) => {
    getActiveDb().deleteKnowledgeIngestJob(jobId);
    return getState();
  });

  ipcMain.handle(
    ipcChannels.updateKnowledgeItem,
    async (_event, itemId: string, payload: UpdateKnowledgeItemPayload) => {
      const db = getActiveDb();
      const item = db.updateKnowledgeItem(itemId, payload);
      const settings = readLlmSettings();
      try {
        await indexKnowledgeItem(db, item.id, settings.embedding, settings.chat);
      } catch {
        // Keep the item and expose its indexing state through workspace state.
      }
      return getState();
    }
  );

  ipcMain.handle(ipcChannels.deleteKnowledgeItem, (_event, itemId: string) => {
    getActiveDb().deleteKnowledgeItem(itemId);
    return getState();
  });

  ipcMain.handle(ipcChannels.reindexKnowledgeItem, async (_event, itemId: string) => {
    const db = getActiveDb();
    const settings = readLlmSettings();
    await indexKnowledgeItem(db, itemId, settings.embedding, settings.chat);
    return getState();
  });

  ipcMain.handle(ipcChannels.searchKnowledge, async (_event, payload: KnowledgeSearchPayload) => {
    const db = getActiveDb();
    const settings = readLlmSettings();
    const contextNodes = getSelectedContextNodes(db, payload.contextNodeIds);
    const articleSectionContext = payload.sectionId
      ? buildArticleSectionContextFromDb(db, payload.sectionId, payload.focusSectionId)
      : '';
    return retrieveKnowledgeSources(db, settings.embedding, payload.query, {
      excludedItemIds: payload.excludedItemIds,
      excludedChunkIds: payload.excludedChunkIds,
      maxChunks: payload.maxChunks,
      queries: articleSectionContext
        ? buildKnowledgeRetrievalQueries(payload.query, articleSectionContext, contextNodes)
        : [payload.query],
      rerankSettings: settings.rerank
    });
  });

  ipcMain.handle(
    ipcChannels.resolveKnowledgeCitation,
    (_event, payload: { publicRef?: string; chunkId?: string }): KnowledgeSourceTarget | null =>
      getActiveDb().resolveKnowledgeSourceTarget(payload)
  );

  ipcMain.handle(ipcChannels.getKnowledgeDebugDetails, () => ({
    chunking: getKnowledgeChunkingDebugConfig(),
    items: getActiveDb().listKnowledgeDebugItems(),
    generatedAt: new Date().toISOString()
  }));

  ipcMain.handle(ipcChannels.getWorkspaceAssetDataUrl, async (_event, relativePath: string) => {
    const db = getActiveDb();
    const normalizedRelativePath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const assetsRoot = path.resolve(db.workspacePath, 'assets');
    const resolvedPath = path.resolve(db.workspacePath, normalizedRelativePath);
    if (!resolvedPath.startsWith(`${assetsRoot}${path.sep}`)) {
      throw new Error('Workspace asset path must be inside the workspace assets directory.');
    }
    const data = await readFile(resolvedPath);
    return `data:${mimeTypeForPath(resolvedPath)};base64,${data.toString('base64')}`;
  });

  ipcMain.handle(ipcChannels.generateWithLlm, async (event, payload: GenerateLlmPayload) => {
    const settings = readLlmSettings();
    const db = getActiveDb();
    const section = db.getSection(payload.sectionId);
    if (!section) {
      throw new Error(`Section not found: ${payload.sectionId}`);
    }
    const contextNodes = getSelectedContextNodes(db, payload.contextNodeIds);
    const articleSectionContext = buildArticleSectionContextFromDb(
      db,
      payload.sectionId,
      payload.focusSectionId
    );
    const useKnowledgeSources = payload.useKnowledgeSources !== false;
    const knowledgeRetrievalPrompt = payload.knowledgeRetrievalPrompt?.trim() || payload.prompt;
    const retrievedSources = useKnowledgeSources
      ? payload.prefetchedKnowledgeSources ?? await retrieveKnowledgeSources(
          db,
          settings.embedding,
          knowledgeRetrievalPrompt,
          {
            excludedItemIds: payload.excludedKnowledgeItemIds,
            excludedChunkIds: payload.excludedKnowledgeChunkIds,
            maxChunks: payload.maxKnowledgeChunks,
            queries: buildKnowledgeRetrievalQueries(knowledgeRetrievalPrompt, articleSectionContext, contextNodes),
            rerankSettings: settings.rerank
          }
        )
      : [];
    const generationPayload: GenerateLlmPayload = {
      ...payload,
      prompt: buildContextPrompt(
        payload.prompt,
        contextNodes,
        articleSectionContext,
        retrievedSources,
        useKnowledgeSources && (payload.requireInlineCitations ?? true)
      ),
      systemPrompt: payload.systemPrompt?.trim()
        ? `${articleSectionContext}\n\n${payload.systemPrompt.trim()}`
        : articleSectionContext
    };
    const controller = new AbortController();
    llmRuns.set(payload.runId, controller);

    event.sender.send(ipcChannels.llmStream, {
      type: 'started',
      runId: payload.runId,
      sectionId: payload.sectionId
    });

    let content = '';
    try {
      for await (const chunk of streamLlmText(settings.chat, generationPayload, controller.signal)) {
        content += chunk;
        event.sender.send(ipcChannels.llmStream, {
          type: 'chunk',
          runId: payload.runId,
          content
        });
      }
      event.sender.send(ipcChannels.llmStream, {
        type: 'done',
        runId: payload.runId,
        content,
        sources: retrievedSources
      });
      return { runId: payload.runId, content, canceled: false, sources: retrievedSources };
    } catch (caught) {
      if (controller.signal.aborted) {
        event.sender.send(ipcChannels.llmStream, {
          type: 'canceled',
          runId: payload.runId
        });
        return { runId: payload.runId, content, canceled: true };
      }

      const message = caught instanceof Error ? caught.message : String(caught);
      event.sender.send(ipcChannels.llmStream, {
        type: 'error',
        runId: payload.runId,
        message
      });
      throw new Error(message);
    } finally {
      llmRuns.delete(payload.runId);
    }
  });

  ipcMain.handle(ipcChannels.cancelLlmGeneration, (_event, runId: string) => {
    llmRuns.get(runId)?.abort();
  });

  ipcMain.handle(ipcChannels.saveLlmGeneration, (_event, payload: SaveLlmGenerationPayload) => {
    const settings = readLlmSettings();
    const db = getActiveDb();
    const section = db.getSection(payload.sectionId);
    if (!section) {
      throw new Error(`Section not found: ${payload.sectionId}`);
    }
    const prompt = payload.prompt.trim();
    if (!prompt) {
      throw new Error('LLM generation prompt is required.');
    }
    const contextNodes = getSelectedContextNodes(db, payload.contextNodeIds);
    const articleSectionContext = buildArticleSectionContextFromDb(
      db,
      payload.sectionId,
      payload.focusSectionId
    );
    const resolvedPrompt = buildContextPrompt(
      prompt,
      contextNodes,
      articleSectionContext,
      payload.retrievedSources ?? [],
      true
    );
    const operationId = createId('llmop');
    createGitCheckpoint(db.workspacePath, `Before LLM op: ${section.title}`);
    const beforeCommit = getGitHead(db.workspacePath);
    const nextMarkdown = [section.markdownContent.trimEnd(), payload.content.trim()]
      .filter(Boolean)
      .join('\n\n');
    const updatedSection = db.updateSectionMarkdown(payload.sectionId, `${nextMarkdown}\n`);

    const contextRelationType = payload.contextRelationType ?? 'informs';
    contextNodes.forEach((node) => {
      db.createNodeEdge(node.id, payload.sectionId, contextRelationType, 'llm');
    });
    ensureKnowledgeSourceNodes(
      db,
      payload.focusSectionId ?? payload.sectionId,
      payload.sectionId,
      payload.retrievedSources ?? []
    );
    db.saveGenerationCitations(
      payload.sectionId,
      (payload.retrievedSources ?? []).map((source) => ({
        publicRef: source.publicRef,
        knowledgeItemId: source.itemId,
        knowledgeChunkId: source.chunkId,
        label: source.publicRef,
        snippet: source.snippet,
        score: source.score
      }))
    );
    const timestamp = nowIso();
    const operation: LlmOperationRecord = {
      operationId,
      type: 'generate_append',
      status: 'current',
      createdAt: timestamp,
      appliedAt: timestamp,
      sectionId: payload.sectionId,
      sectionPath: updatedSection.markdownPath,
      beforeCommit,
      afterCommit: null,
      beforeSectionHash: section.markdownHash,
      afterSectionHash: updatedSection.markdownHash,
      userPrompt: prompt,
      resolvedPrompt,
      systemPrompt: articleSectionContext,
      model: {
        provider: settings.chat.provider,
        baseURL: settings.chat.baseURL,
        model: settings.chat.model
      },
      target: {
        kind: 'section_append',
        selectionStart: section.markdownContent.length,
        selectionEnd: section.markdownContent.length,
        selectedText: '',
        prefixContext: section.markdownContent.slice(-500),
        suffixContext: ''
      },
      beforeText: '',
      afterText: payload.content.trim(),
      outputHash: hashMarkdown(payload.content.trim()),
      retainedCoverage: 1,
      contextNodeIds: payload.contextNodeIds ?? [],
      retrievedSources: payload.retrievedSources ?? []
    };
    db.upsertSectionLlmOperation(payload.sectionId, operation);
    createGitCheckpoint(db.workspacePath, `LLM op ${operationId}: ${section.title}`);
    const afterCommit = getGitHead(db.workspacePath);
    db.upsertSectionLlmOperation(payload.sectionId, {
      ...operation,
      afterCommit
    });
    createGitCheckpoint(db.workspacePath, `LLM op ${operationId} provenance: ${section.title}`);
    return getState(payload.focusSectionId ?? payload.sectionId);
  });

  ipcMain.handle(ipcChannels.applySectionLlmEdit, (_event, payload: ApplySectionLlmEditPayload) => {
    const settings = readLlmSettings();
    const db = getActiveDb();
    const section = db.getSection(payload.sectionId);
    if (!section) {
      throw new Error(`Section not found: ${payload.sectionId}`);
    }

    const baseMarkdown = sectionMarkdownForStorage(payload.baseMarkdown);
    if (section.markdownContent !== baseMarkdown) {
      throw new Error('The section changed after this LLM edit was generated. Regenerate before applying it.');
    }

    const generatedContent = payload.generatedContent.trim();
    if (!generatedContent) {
      throw new Error('Generated edit content is required.');
    }

    assertSectionLlmEditRange(payload.mode, baseMarkdown, payload.targetStart, payload.targetEnd);
    const beforeText = selectedTextForLlmEdit(payload.mode, baseMarkdown, payload.targetStart, payload.targetEnd);
    if (payload.mode === 'rewrite_selection' && beforeText !== payload.selectedText) {
      throw new Error('The selected text changed after this LLM edit was generated. Regenerate before applying it.');
    }

    const replacementText = replacementTextForLlmEdit(
      payload.mode,
      baseMarkdown,
      payload.targetStart,
      generatedContent
    );
    const nextMarkdown = markdownWithLlmEdit(
      payload.mode,
      baseMarkdown,
      payload.targetStart,
      payload.targetEnd,
      replacementText
    );

    const contextNodes = getSelectedContextNodes(db, payload.contextNodeIds);
    const articleSectionContext = buildArticleSectionContextFromDb(
      db,
      payload.sectionId,
      payload.focusSectionId
    );
    const operationId = createId('llmop');
    createGitCheckpoint(db.workspacePath, `Before LLM op: ${section.title}`);
    const beforeCommit = getGitHead(db.workspacePath);
    const updatedSection = db.updateSectionMarkdown(payload.sectionId, nextMarkdown);

    contextNodes.forEach((node) => {
      db.createNodeEdge(node.id, payload.sectionId, 'revises', 'llm');
    });
    ensureKnowledgeSourceNodes(
      db,
      payload.focusSectionId ?? payload.sectionId,
      payload.sectionId,
      payload.retrievedSources ?? []
    );
    db.saveGenerationCitations(
      payload.sectionId,
      (payload.retrievedSources ?? []).map((source) => ({
        publicRef: source.publicRef,
        knowledgeItemId: source.itemId,
        knowledgeChunkId: source.chunkId,
        label: source.publicRef,
        snippet: source.snippet,
        score: source.score
      }))
    );

    const timestamp = nowIso();
    const operation: LlmOperationRecord = {
      operationId,
      type: payload.mode,
      status: 'current',
      createdAt: timestamp,
      appliedAt: timestamp,
      sectionId: payload.sectionId,
      sectionPath: updatedSection.markdownPath,
      beforeCommit,
      afterCommit: null,
      beforeSectionHash: section.markdownHash,
      afterSectionHash: updatedSection.markdownHash,
      userPrompt: payload.userPrompt,
      resolvedPrompt: payload.resolvedPrompt || buildContextPrompt(
        payload.userPrompt || editorLlmOperationLabel(payload.mode),
        contextNodes,
        articleSectionContext,
        payload.retrievedSources ?? [],
        true
      ),
      systemPrompt: payload.systemPrompt || articleSectionContext,
      model: {
        provider: settings.chat.provider,
        baseURL: settings.chat.baseURL,
        model: settings.chat.model
      },
      target: {
        kind: targetKindForLlmEdit(payload.mode),
        selectionStart: payload.targetStart,
        selectionEnd: payload.targetEnd,
        selectedText: beforeText,
        prefixContext: payload.prefixContext,
        suffixContext: payload.suffixContext
      },
      beforeText,
      afterText: afterTextForLlmEdit(payload.mode, updatedSection.markdownContent, replacementText),
      outputHash: hashMarkdown(generatedContent),
      retainedCoverage: 1,
      contextNodeIds: payload.contextNodeIds ?? [],
      retrievedSources: payload.retrievedSources ?? []
    };
    db.upsertSectionLlmOperation(payload.sectionId, operation);
    createGitCheckpoint(db.workspacePath, `LLM op ${operationId}: ${section.title}`);
    const afterCommit = getGitHead(db.workspacePath);
    db.upsertSectionLlmOperation(payload.sectionId, {
      ...operation,
      afterCommit
    });
    createGitCheckpoint(db.workspacePath, `LLM op ${operationId} provenance: ${section.title}`);
    return getState(payload.focusSectionId ?? payload.sectionId);
  });
}

function isSectionStructureUpdate(payload: UpdateNodePayload): boolean {
  return 'title' in payload || 'intent' in payload || 'activeMainNodeId' in payload;
}

function assertSectionLlmEditRange(
  mode: SectionLlmEditMode,
  markdown: string,
  targetStart: number,
  targetEnd: number
): void {
  if (!Number.isInteger(targetStart) || !Number.isInteger(targetEnd)) {
    throw new Error('LLM edit range must use integer offsets.');
  }
  if (targetStart < 0 || targetEnd < targetStart || targetEnd > markdown.length) {
    throw new Error('LLM edit range is outside the current section.');
  }
  if (mode === 'rewrite_selection' && targetStart === targetEnd) {
    throw new Error('A selected text range is required for selection rewrite.');
  }
  if (mode === 'continue_at_cursor' && targetStart !== targetEnd) {
    throw new Error('Continuation edits must target a cursor position.');
  }
}

function selectedTextForLlmEdit(
  mode: SectionLlmEditMode,
  markdown: string,
  targetStart: number,
  targetEnd: number
): string {
  if (mode === 'rewrite_section') {
    return markdown;
  }
  if (mode === 'continue_at_cursor') {
    return '';
  }
  return markdown.slice(targetStart, targetEnd);
}

function replacementTextForLlmEdit(
  mode: SectionLlmEditMode,
  markdown: string,
  targetStart: number,
  generatedContent: string
): string {
  if (mode !== 'continue_at_cursor') {
    return generatedContent;
  }
  const before = markdown.slice(0, targetStart);
  if (!before.trim() || before.endsWith('\n') || generatedContent.startsWith('\n')) {
    return generatedContent;
  }
  return `\n\n${generatedContent}`;
}

function markdownWithLlmEdit(
  mode: SectionLlmEditMode,
  markdown: string,
  targetStart: number,
  targetEnd: number,
  replacementText: string
): string {
  if (mode === 'rewrite_section') {
    return replacementText;
  }
  return `${markdown.slice(0, targetStart)}${replacementText}${markdown.slice(targetEnd)}`;
}

function targetKindForLlmEdit(mode: SectionLlmEditMode): LlmOperationRecord['target']['kind'] {
  if (mode === 'rewrite_section') {
    return 'section_rewrite';
  }
  if (mode === 'continue_at_cursor') {
    return 'insertion';
  }
  return 'selection';
}

function afterTextForLlmEdit(mode: SectionLlmEditMode, updatedMarkdown: string, replacementText: string): string {
  return mode === 'rewrite_section' ? updatedMarkdown : replacementText;
}

function editorLlmOperationLabel(mode: SectionLlmEditMode): string {
  switch (mode) {
    case 'rewrite_section':
      return 'Rewrite section';
    case 'rewrite_selection':
      return 'Rewrite selection';
    case 'continue_at_cursor':
      return 'Continue writing';
  }
}

function mimeTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apng':
      return 'image/apng';
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
