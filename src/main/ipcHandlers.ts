import { BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ipcChannels } from '../shared/ipc.js';
import type {
  CompositionTreeNode,
  ContentNodeRecord,
  CreateKnowledgeItemPayload,
  EnqueueKnowledgeFilesPayload,
  CreateNodePayload,
  EdgeKind,
  GenerateLlmPayload,
  KnowledgeSourceTarget,
  KnowledgeSearchPayload,
  RetrievedKnowledgeSource,
  NodeRecord,
  SaveLlmGenerationPayload,
  UpdateKnowledgeItemPayload,
  UpdateNodeLayoutPayload,
  UpdateNodePayload
} from '../shared/types.js';
import { exportLatex } from './exportLatex.js';
import { startBackgroundTaskWorker } from './backgroundTasks.js';
import { enqueueKnowledgeFiles, setKnowledgeIngestUpdateNotifier } from './knowledgeIngest.js';
import { streamLlmText } from './llmRunner.js';
import {
  readLlmSettings,
  readPublicLlmSettings,
  updateAppearanceSettings,
  updateLlmSettings
} from './llmSettings.js';
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

  return [
    `${label}:`,
    `- Section title: ${section.title}`,
    `- Section intent: ${trimmedIntent || 'Not provided'}`
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

function isKnowledgeSourceNode(node: NodeRecord, sectionId: string, chunkId: string): node is ContentNodeRecord {
  return node.kind === 'content' &&
    node.parentId === sectionId &&
    node.metadata.nodeRole === 'knowledge-source' &&
    node.metadata.knowledgeChunkId === chunkId;
}

function findOrCreateKnowledgeSourceNode(
  db: ReturnType<typeof getActiveDb>,
  sectionId: string,
  source: RetrievedKnowledgeSource
): ContentNodeRecord {
  const existing = db.listNodes().find((node) => isKnowledgeSourceNode(node, sectionId, source.chunkId));
  if (existing) {
    return existing;
  }

  const created = db.createNode({
    kind: 'content',
    parentId: sectionId,
    title: knowledgeSourceTitle(source),
    content: source.snippet,
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
      score: source.score
    }
  });

  if (created.kind !== 'content') {
    throw new Error('Knowledge source node was not created as content.');
  }
  return created;
}

function ensureKnowledgeSourceNodes(
  db: ReturnType<typeof getActiveDb>,
  sectionId: string,
  generatedNodeId: string,
  sources: RetrievedKnowledgeSource[]
): void {
  const uniqueSources = new Map(sources.map((source) => [source.chunkId, source]));
  for (const source of uniqueSources.values()) {
    const sourceNode = findOrCreateKnowledgeSourceNode(db, sectionId, source);
    const hasEdge = db.listEdges().some(
      (edge) =>
        edge.fromNodeId === sourceNode.id &&
        edge.toNodeId === generatedNodeId &&
        edge.relationType === 'cites'
    );
    if (!hasEdge) {
      db.createNodeEdge(sourceNode.id, generatedNodeId, 'cites', 'llm');
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
      title: 'Open PaperLab workspace',
      properties: ['openDirectory'] as Electron.OpenDialogOptions['properties']
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const workspacePath = result.filePaths[0];
    if (path.extname(workspacePath) !== '.paperlab') {
      throw new Error('Choose a .paperlab folder.');
    }
    return workspacePath;
  });

  ipcMain.handle(ipcChannels.pickNewWorkspacePath, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Create PaperLab workspace',
      defaultPath: 'Untitled.paperlab',
      filters: [{ name: 'PaperLab Workspace', extensions: ['paperlab'] }]
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath.endsWith('.paperlab') ? result.filePath : `${result.filePath}.paperlab`;
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

  ipcMain.handle(ipcChannels.createNode, (_event, payload: CreateNodePayload) => {
    const node = getActiveDb().createNode(payload);
    return getState(node.kind === 'section' ? node.parentId ?? node.id : node.parentId);
  });

  ipcMain.handle(
    ipcChannels.updateNode,
    (_event, nodeId: string, payload: UpdateNodePayload) => {
      const db = getActiveDb();
      db.updateNode(nodeId, payload);
      const node = db.getNode(nodeId);
      return getState(node?.kind === 'section' ? node.id : node?.parentId ?? undefined);
    }
  );

  ipcMain.handle(ipcChannels.deleteNode, (_event, nodeId: string) => {
    const db = getActiveDb();
    const parentSectionId = db.getParentSectionId(nodeId) ?? db.rootNodeId;
    db.deleteNode(nodeId);
    return getState(parentSectionId);
  });

  ipcMain.handle(
    ipcChannels.moveNode,
    (_event, nodeId: string, newParentId: string | null, index: number) => {
      getActiveDb().moveNode(nodeId, newParentId, index);
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

  ipcMain.handle(ipcChannels.searchKnowledge, async (_event, payload: KnowledgeSearchPayload) =>
    retrieveKnowledgeSources(getActiveDb(), readLlmSettings().embedding, payload.query, {
      excludedItemIds: payload.excludedItemIds,
      excludedChunkIds: payload.excludedChunkIds,
      maxChunks: payload.maxChunks
    })
  );

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
    const retrievedSources = await retrieveKnowledgeSources(
      db,
      settings.embedding,
      `${articleSectionContext}\n\n${payload.prompt}`,
      {
        excludedItemIds: payload.excludedKnowledgeItemIds,
        excludedChunkIds: payload.excludedKnowledgeChunkIds,
        maxChunks: payload.maxKnowledgeChunks
      }
    );
    const generationPayload: GenerateLlmPayload = {
      ...payload,
      prompt: buildContextPrompt(
        payload.prompt,
        contextNodes,
        articleSectionContext,
        retrievedSources,
        payload.requireInlineCitations ?? true
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
    const generated = db.createNode({
      kind: 'content',
      parentId: payload.sectionId,
      title: titleFromPrompt(prompt),
      content: payload.content,
      isLlm: true,
      isMain: false,
      metadata: {
        provider: settings.chat.provider,
        baseURL: settings.chat.baseURL,
        model: settings.chat.model,
        embeddingModel: settings.embedding.model,
        prompt: resolvedPrompt,
        rawPrompt: prompt,
        focusSectionId: payload.focusSectionId ?? null,
        targetSectionId: payload.sectionId,
        contextNodeIds: contextNodes.map((node) => node.id),
        retrievedSources: payload.retrievedSources ?? []
      }
    });

    if (generated.kind !== 'content') {
      throw new Error('LLM generation did not create a content node.');
    }

    const contextRelationType = payload.contextRelationType ?? 'informs';
    contextNodes.forEach((node) => {
      db.createNodeEdge(node.id, generated.id, contextRelationType, 'llm');
    });
    ensureKnowledgeSourceNodes(db, payload.sectionId, generated.id, payload.retrievedSources ?? []);
    db.saveGenerationCitations(
      generated.id,
      (payload.retrievedSources ?? []).map((source) => ({
        publicRef: source.publicRef,
        knowledgeItemId: source.itemId,
        knowledgeChunkId: source.chunkId,
        label: source.publicRef,
        snippet: source.snippet,
        score: source.score
      }))
    );
    return getState(payload.sectionId);
  });
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
