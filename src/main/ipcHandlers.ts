import { BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ipcChannels } from '../shared/ipc.js';
import type {
  AcceptWritingPatchPayload,
  ApplySectionLlmEditPayload,
  AdoptGenerationPayload,
  CompositionTreeNode,
  ContentNodeRecord,
  CreateGenerationTaskPayload,
  CreateKnowledgeItemPayload,
  CreatePatchFromGenerationRoundPayload,
  CreateGenerationTaskResult,
  EnqueueKnowledgeFilesPayload,
  CreateNodePayload,
  EdgeKind,
  GenerateLlmPayload,
  GenerationExecutionMode,
  GenerationMode,
  KnowledgeRetrievalMode,
  KnowledgeRetrievalTraceEvent,
  KnowledgeSourceTarget,
  KnowledgeSearchPayload,
  PatchApplicationResult,
  ProjectBriefRecord,
  ProjectBriefSuggestion,
  ProjectBriefSuggestionTarget,
  ProjectFramework,
  ProjectGlossary,
  ProjectMotivation,
  RetrievedKnowledgeSource,
  NodeRecord,
  SectionNodeRecord,
  SectionLlmEditMode,
  SaveLlmGenerationPayload,
  SuggestProjectBriefPayload,
  UpdateKnowledgeItemPayload,
  UpdateNodeLayoutPayload,
  UpdateNodePayload,
  UpdateProjectBriefPayload,
  WritingPatch,
  WritingPatchRecord
} from '../shared/types.js';
import { exportLatex } from './exportLatex.js';
import {
  createGitCheckpoint,
  getGitStatus,
  listGitHistory
} from './gitSession.js';
import { startBackgroundTaskWorker } from './backgroundTasks.js';
import { emitGenerationEvent } from './generationEvents.js';
import { createPatchFromGenerationRound } from './generationPatch.js';
import { enqueueKnowledgeFiles, setKnowledgeIngestUpdateNotifier } from './knowledgeIngest.js';
import { generateLlmObject, streamLlmText } from './llmRunner.js';
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
  indexKnowledgeItem
} from './knowledgeIndex.js';
import { retrieveKnowledgeInWorker } from './retrievalWorkerClient.js';
import {
  createWorkspace,
  getActiveDb,
  getState,
  listRecentWorkspaces,
  openWorkspace
} from './workspace.js';
import { createId, nowIso } from './ids.js';
import { sectionMarkdownForStorage } from './sectionMarkdown.js';
import { markdownAfterWritingPatch } from './harness/patchApplier.js';
import { createPatchDiff } from './harness/patchDiff.js';
import { llmPatchProposalSchema } from './harness/patchProtocol.js';
import { beforeAfterForPatch, validateWritingPatch } from './harness/patchValidator.js';

const llmRuns = new Map<string, AbortController>();
const interactiveGenerationRuns = new Map<string, AbortController>();

const projectGlossaryTermSchema = z.object({
  id: z.string().optional().default(''),
  term: z.string().optional().default(''),
  aliases: z.array(z.string()).optional().default([]),
  definition: z.string().optional().default(''),
  preferredUsage: z.string().optional().default(''),
  avoidUsage: z.string().optional().default(''),
  examples: z.array(z.string()).optional().default([])
});

const projectGlossarySchema = z.object({
  entries: z.array(projectGlossaryTermSchema).optional().default([]),
  notes: z.string().optional().default('')
});

const projectMotivationSchema = z.object({
  audience: z.string().optional().default(''),
  problem: z.string().optional().default(''),
  thesis: z.string().optional().default(''),
  contribution: z.string().optional().default(''),
  desiredReaderAction: z.string().optional().default(''),
  constraints: z.string().optional().default(''),
  notes: z.string().optional().default('')
});

const projectFrameworkSectionSchema = z.object({
  id: z.string().optional().default(''),
  title: z.string().optional().default(''),
  purpose: z.string().optional().default(''),
  keyMoves: z.string().optional().default(''),
  evidence: z.string().optional().default('')
});

const projectFrameworkSchema = z.object({
  narrativeArc: z.string().optional().default(''),
  sectionPlan: z.array(projectFrameworkSectionSchema).optional().default([]),
  notes: z.string().optional().default('')
});

const projectBriefSuggestionSchema = z.object({
  glossary: projectGlossarySchema.optional(),
  motivation: projectMotivationSchema.optional(),
  framework: projectFrameworkSchema.optional(),
  rationale: z.string().optional().default('')
});

function titleFromPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim() || 'Assistant suggestion';
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
  const articleStructure = buildCompositionTreeFromSections(db.listSectionsForContext());
  const targetSection = findSectionInTree(articleStructure, targetSectionId);
  if (!targetSection) {
    throw new Error(`Section not found: ${targetSectionId}`);
  }
  const focusSection = findSectionInTree(articleStructure, resolvedFocusSectionId) ?? targetSection;

  return buildArticleSectionContext(focusSection, targetSection, articleStructure);
}

function buildProjectAwareArticleContextFromDb(
  db: ReturnType<typeof getActiveDb>,
  targetSectionId: string,
  focusSectionId?: string | null
): string {
  return [buildProjectBriefPromptContext(db), buildArticleSectionContextFromDb(db, targetSectionId, focusSectionId)]
    .filter((section) => section.trim())
    .join('\n\n');
}

function buildProjectBriefPromptContext(db: ReturnType<typeof getActiveDb>): string {
  const brief = db.getProjectBrief();
  const sections: string[] = [];
  const glossaryLines = brief.glossary.entries
    .filter((entry) => entry.term.trim() || entry.definition.trim())
    .map((entry) => {
      const parts = [
        entry.term.trim() ? `canonical: ${entry.term.trim()}` : '',
        entry.aliases.length > 0 ? `aliases for understanding: ${entry.aliases.join(', ')}` : '',
        entry.definition.trim() ? `definition: ${entry.definition.trim()}` : '',
        entry.preferredUsage.trim() ? `preferred usage: ${entry.preferredUsage.trim()}` : '',
        entry.avoidUsage.trim() ? `avoid: ${entry.avoidUsage.trim()}` : '',
        entry.examples.length > 0 ? `examples: ${entry.examples.join('; ')}` : ''
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    });
  if (glossaryLines.length > 0 || brief.glossary.notes.trim()) {
    sections.push([
      'Project glossary and terminology constraints:',
      ...glossaryLines,
      brief.glossary.notes.trim() ? `Notes: ${brief.glossary.notes.trim()}` : '',
      'Use canonical terms consistently. Treat aliases as source-language variants, not preferred output terms. Do not use avoided terms unless quoting source text.'
    ].filter(Boolean).join('\n'));
  }

  const motivationLines = [
    ['Audience', brief.motivation.audience],
    ['Problem', brief.motivation.problem],
    ['Thesis', brief.motivation.thesis],
    ['Contribution', brief.motivation.contribution],
    ['Desired reader action', brief.motivation.desiredReaderAction],
    ['Constraints', brief.motivation.constraints],
    ['Notes', brief.motivation.notes]
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `- ${label}: ${value.trim()}`);
  if (motivationLines.length > 0) {
    sections.push(['Project writing motivation:', ...motivationLines].join('\n'));
  }

  const frameworkLines = brief.framework.sectionPlan
    .filter((section) => section.title.trim() || section.purpose.trim() || section.keyMoves.trim() || section.evidence.trim())
    .map((section) => {
      const parts = [
        section.title.trim() ? `section: ${section.title.trim()}` : '',
        section.purpose.trim() ? `purpose: ${section.purpose.trim()}` : '',
        section.keyMoves.trim() ? `key moves: ${section.keyMoves.trim()}` : '',
        section.evidence.trim() ? `evidence: ${section.evidence.trim()}` : ''
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    });
  if (brief.framework.narrativeArc.trim() || frameworkLines.length > 0 || brief.framework.notes.trim()) {
    sections.push([
      'Project narrative framework:',
      brief.framework.narrativeArc.trim() ? `Narrative arc: ${brief.framework.narrativeArc.trim()}` : '',
      ...frameworkLines,
      brief.framework.notes.trim() ? `Notes: ${brief.framework.notes.trim()}` : ''
    ].filter(Boolean).join('\n'));
  }

  if (sections.length === 0) {
    return '';
  }
  return [
    'Project brief:',
    ...sections,
    'Use this project brief as global writing guidance. Do not print these labels unless explicitly requested.'
  ].join('\n\n');
}

function buildCompositionTreeFromSections(sections: SectionNodeRecord[]): CompositionTreeNode[] {
  const byParent = new Map<string | null, CompositionTreeNode[]>();
  sections.forEach((section) => {
    const siblings = byParent.get(section.parentId) ?? [];
    siblings.push({
      ...section,
      children: []
    });
    byParent.set(section.parentId, siblings);
  });
  byParent.forEach((siblings) => {
    siblings.sort((left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  });

  const build = (section: CompositionTreeNode): CompositionTreeNode => ({
    ...section,
    children: (byParent.get(section.id) ?? []).map(build)
  });

  return (byParent.get(null) ?? []).map(build);
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
        'Inline citations are required for source-backed claims. Keep citation markers in the generated text. Use one source reference per bracket, for example [a3f91c8.c1] [b7e12aa.c2], not [a3f91c8.c1, b7e12aa.c2].'
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

async function retrieveKnowledgeForGeneration(
  db: ReturnType<typeof getActiveDb>,
  query: string,
  options: {
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
    queries?: string[];
    retrievalMode?: KnowledgeRetrievalMode;
    runId?: string;
    settings: ReturnType<typeof readLlmSettings>;
    onTrace?: (event: KnowledgeRetrievalTraceEvent) => void;
    abortSignal?: AbortSignal;
  }
): Promise<RetrievedKnowledgeSource[]> {
  return retrieveKnowledgeInWorker(db.workspacePath, {
    query,
    embeddingSettings: options.settings.embedding,
    chatSettings: options.settings.chat,
    excludedItemIds: options.excludedItemIds,
    excludedChunkIds: options.excludedChunkIds,
    maxChunks: options.maxChunks,
    queries: options.queries,
    retrievalMode: options.retrievalMode,
    runId: options.runId,
    rerankSettings: options.settings.rerank,
    retrievalSettings: options.settings.knowledge.retrieval
  }, {
    abortSignal: options.abortSignal,
    onTrace: options.onTrace
  });
}

async function suggestProjectBrief(
  db: ReturnType<typeof getActiveDb>,
  payload: SuggestProjectBriefPayload
): Promise<ProjectBriefSuggestion> {
  const settings = readLlmSettings();
  const prompt = buildProjectBriefSuggestionPrompt(db, payload);
  const result = await generateLlmObject(settings.chat, {
    systemPrompt: [
      'You help academic writers create project-level writing guidance.',
      'Infer concise, useful configuration from uploaded source material and the current document structure.',
      'Return only fields requested by the target. Do not invent specific claims that are not supported by the provided context.'
    ].join(' '),
    prompt,
    schema: projectBriefSuggestionSchema
  });
  return normalizeProjectBriefSuggestion(payload.target, result);
}

function buildProjectBriefSuggestionPrompt(
  db: ReturnType<typeof getActiveDb>,
  payload: SuggestProjectBriefPayload
): string {
  const currentBrief = payload.currentBrief ?? db.getProjectBrief();
  return [
    `Target: ${payload.target}`,
    '',
    'Current project brief JSON:',
    JSON.stringify(currentBrief, null, 2).slice(0, 8000),
    '',
    'Current article structure:',
    formatArticleStructure(buildCompositionTreeFromSections(db.listSectionsForContext()), db.rootNodeId, db.rootNodeId),
    '',
    'Uploaded source context:',
    buildKnowledgeItemsForBriefSuggestion(db),
    '',
    'Return JSON shape:',
    '{"glossary":{"entries":[{"id":"","term":"","aliases":[""],"definition":"","preferredUsage":"","avoidUsage":"","examples":[""]}],"notes":""},"motivation":{"audience":"","problem":"","thesis":"","contribution":"","desiredReaderAction":"","constraints":"","notes":""},"framework":{"narrativeArc":"","sectionPlan":[{"id":"","title":"","purpose":"","keyMoves":"","evidence":""}],"notes":""},"rationale":""}',
    '',
    'Rules:',
    '- For glossary, include only recurring domain terms, method names, constructs, datasets, or project-specific terminology.',
    '- For motivation, describe audience, problem, thesis, contribution, reader action, constraints, and notes when inferable.',
    '- For framework, align sectionPlan titles with the current article structure when possible.',
    '- If target is not all, include only that requested top-level object plus rationale.'
  ].join('\n');
}

function buildKnowledgeItemsForBriefSuggestion(db: ReturnType<typeof getActiveDb>): string {
  const items = db.listKnowledgeItems().slice(0, 8);
  if (items.length === 0) {
    return 'No uploaded knowledge sources yet.';
  }
  let remainingChars = 9000;
  const blocks: string[] = [];
  for (const item of items) {
    if (remainingChars <= 0) {
      break;
    }
    const metadata = item.metadata.knowledgeDisplayMetadata ?? item.metadata.knowledgeMetadata;
    const metadataRecord = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : null;
    const rawDescription = metadataRecord?.description;
    const description = typeof rawDescription === 'string' ? rawDescription : '';
    const sample = item.content.trim().slice(0, Math.min(1400, remainingChars));
    remainingChars -= sample.length;
    blocks.push([
      `Source: ${item.title}`,
      description.trim() ? `Description: ${description.trim()}` : '',
      `Status: ${item.indexStatus}`,
      'Sample:',
      sample || '(empty)'
    ].filter(Boolean).join('\n'));
  }
  return blocks.join('\n\n---\n\n');
}

function normalizeProjectBriefSuggestion(
  target: ProjectBriefSuggestionTarget,
  value: z.infer<typeof projectBriefSuggestionSchema>
): ProjectBriefSuggestion {
  return {
    target,
    glossary: (target === 'all' || target === 'glossary') && value.glossary
      ? normalizeSuggestedGlossary(value.glossary)
      : undefined,
    motivation: (target === 'all' || target === 'motivation') && value.motivation
      ? normalizeSuggestedMotivation(value.motivation)
      : undefined,
    framework: (target === 'all' || target === 'framework') && value.framework
      ? normalizeSuggestedFramework(value.framework)
      : undefined,
    rationale: value.rationale?.trim() || 'Generated from uploaded sources and the current article structure.'
  };
}

function normalizeSuggestedGlossary(value: z.infer<typeof projectGlossarySchema>): ProjectGlossary {
  return {
    entries: value.entries
      .map((entry) => ({
        id: entry.id.trim() || createId('term'),
        term: entry.term.trim(),
        aliases: entry.aliases.map((alias) => alias.trim()).filter(Boolean),
        definition: entry.definition.trim(),
        preferredUsage: entry.preferredUsage.trim(),
        avoidUsage: entry.avoidUsage.trim(),
        examples: entry.examples.map((example) => example.trim()).filter(Boolean)
      }))
      .filter((entry) => entry.term || entry.definition || entry.aliases.length > 0),
    notes: value.notes.trim()
  };
}

function normalizeSuggestedMotivation(value: z.infer<typeof projectMotivationSchema>): ProjectMotivation {
  return {
    audience: value.audience.trim(),
    problem: value.problem.trim(),
    thesis: value.thesis.trim(),
    contribution: value.contribution.trim(),
    desiredReaderAction: value.desiredReaderAction.trim(),
    constraints: value.constraints.trim(),
    notes: value.notes.trim()
  };
}

function normalizeSuggestedFramework(value: z.infer<typeof projectFrameworkSchema>): ProjectFramework {
  return {
    narrativeArc: value.narrativeArc.trim(),
    sectionPlan: value.sectionPlan
      .map((section) => ({
        id: section.id.trim() || createId('briefsec'),
        title: section.title.trim(),
        purpose: section.purpose.trim(),
        keyMoves: section.keyMoves.trim(),
        evidence: section.evidence.trim()
      }))
      .filter((section) => section.title || section.purpose || section.keyMoves || section.evidence),
    notes: value.notes.trim()
  };
}

type GenerationApplyPayload =
  | {
      kind: 'edit';
      sectionId: string;
      focusSectionId: string | null;
      mode: SectionLlmEditMode;
      insertionMode?: 'cursor' | 'section_end';
      userPrompt: string;
      resolvedPrompt: string;
      systemPrompt: string;
      baseMarkdown: string;
      targetStart: number;
      targetEnd: number;
      selectedText: string;
      prefixContext: string;
      suffixContext: string;
      contextNodeIds: string[];
    };

function buildGenerationTaskRequest(
  mode: GenerationMode,
  input: {
    section: SectionNodeRecord;
    prompt: string;
    targetStart?: number;
    targetEnd?: number;
  }
): {
  prompt: string;
  systemPrompt: string | null;
  applyPayload: GenerationApplyPayload;
} {
  const markdown = sectionMarkdownForStorage(input.section.markdownContent);
  const targetStart = clampOffset(input.targetStart ?? (mode === 'rewrite_section' ? 0 : markdown.length), markdown);
  const targetEnd = clampOffset(input.targetEnd ?? (mode === 'rewrite_section' ? markdown.length : targetStart), markdown);
  const normalizedStart = Math.min(targetStart, targetEnd);
  const normalizedEnd = Math.max(targetStart, targetEnd);
  const editMode: SectionLlmEditMode = mode === 'append' || mode === 'continue' ? 'continue_at_cursor' : mode;
  const insertionMode = mode === 'append' ? 'section_end' : 'cursor';
  const resolvedStart = mode === 'append' ? markdown.length : normalizedStart;
  const resolvedEnd = mode === 'append' ? markdown.length : normalizedEnd;
  assertSectionLlmEditRange(editMode, markdown, resolvedStart, resolvedEnd);
  const selectedText = selectedTextForLlmEdit(editMode, markdown, resolvedStart, resolvedEnd);
  const prefixContext = markdown.slice(Math.max(0, resolvedStart - 2400), resolvedStart);
  const suffixContext = markdown.slice(resolvedEnd, resolvedEnd + 1600);
  const instruction = input.prompt.trim() || 'No additional requirements.';
  const systemPrompt = editorLlmSystemPromptForGeneration(mode);
  const prompt = editorLlmPromptForGeneration(mode, {
    title: input.section.title,
    markdown,
    instruction,
    targetStart: resolvedStart,
    targetEnd: resolvedEnd,
    selectedText,
    prefixContext,
    suffixContext
  });
  return {
    prompt,
    systemPrompt,
    applyPayload: {
      kind: 'edit',
      sectionId: input.section.id,
      focusSectionId: null,
      mode: editMode,
      insertionMode,
      userPrompt: input.prompt,
      resolvedPrompt: '',
      systemPrompt: '',
      baseMarkdown: markdown,
      targetStart: resolvedStart,
      targetEnd: resolvedEnd,
      selectedText,
      prefixContext,
      suffixContext,
      contextNodeIds: []
    }
  };
}

function clampOffset(offset: number, text: string): number {
  return Math.max(0, Math.min(Number.isFinite(offset) ? Math.trunc(offset) : text.length, text.length));
}

function editorLlmSystemPromptForGeneration(mode: GenerationMode): string {
  const scope = mode === 'rewrite_section'
    ? 'The afterText field must contain a full alternative Markdown section draft.'
    : mode === 'rewrite_selection'
      ? 'The afterText field must contain only the replacement text for the selected Markdown fragment.'
      : mode === 'append'
        ? 'The afterText field must contain only the text to append to the section.'
        : 'The afterText field must contain only the continuation text to insert at the cursor.';
  return [
    'You are an expert Markdown editor for academic and technical writing.',
    scope,
    'Return a structured json patch proposal with afterText, rationale, optional warnings, optional changedClaims, optional preservedClaims, and optional affectedCitations.',
    'Preserve Markdown syntax and citation markers unless the user explicitly asks to change them.',
    'Do not invent citations. Do not change numerical results unless explicitly requested.',
    'Do not include explanations, alternatives, labels, or fenced wrappers inside afterText.'
  ].join(' ');
}

function editorLlmPromptForGeneration(
  mode: GenerationMode,
  input: {
    title: string;
    markdown: string;
    instruction: string;
    targetStart: number;
    targetEnd: number;
    selectedText: string;
    prefixContext: string;
    suffixContext: string;
  }
): string {
  if (mode === 'rewrite_section') {
    return [
      `Section title: ${input.title}`,
      `User requirements: ${input.instruction}`,
      '',
      'Propose a full-section rewrite as a candidate. Put the full rewritten Markdown in afterText.',
      '',
      input.markdown
    ].join('\n');
  }
  if (mode === 'rewrite_selection') {
    return [
      `Section title: ${input.title}`,
      `User requirements: ${input.instruction}`,
      '',
      'Context before selection:',
      input.prefixContext || '(none)',
      '',
      'Selected Markdown to rewrite. Put only the replacement Markdown in afterText:',
      input.selectedText,
      '',
      'Context after selection:',
      input.suffixContext || '(none)'
    ].join('\n');
  }
  return [
    `Section title: ${input.title}`,
    `User requirements: ${input.instruction}`,
    '',
    mode === 'append'
      ? 'Append to the end of the Markdown section. Put only the appended Markdown in afterText.'
      : 'Continue the Markdown section at the insertion point. Put only the inserted Markdown in afterText.',
    '',
    'Context before insertion:',
    input.prefixContext || '(none)',
    '',
    'Context after insertion:',
    input.suffixContext || '(none)'
  ].join('\n');
}

function resolveGenerationExecutionMode(
  requestedMode: GenerationExecutionMode | undefined,
  generationMode: GenerationMode
): 'interactive' | 'background' {
  if (requestedMode === 'interactive' || requestedMode === 'background') {
    return requestedMode;
  }
  return generationMode === 'rewrite_section' ? 'background' : 'interactive';
}

async function runInteractiveGenerationTask(
  db: ReturnType<typeof getActiveDb>,
  roundId: string,
  payload: {
    prompt: string;
    systemPrompt?: string;
  }
): Promise<void> {
  const controller = new AbortController();
  interactiveGenerationRuns.set(roundId, controller);
  try {
    const round = db.getGenerationRound(roundId);
    if (!round || round.status === 'canceled') {
      return;
    }
    const settings = readLlmSettings();
    db.updateGenerationRound(roundId, {
      status: 'processing',
      startedAt: nowIso(),
      errorMessage: null
    });
    emitGenerationEvent({ type: 'round_status', roundId, status: 'processing' });

    const proposal = await generateLlmObject(settings.chat, {
      prompt: payload.prompt,
      systemPrompt: payload.systemPrompt,
      schema: llmPatchProposalSchema
    }, controller.signal);

    if (controller.signal.aborted || db.getGenerationRound(roundId)?.status === 'canceled') {
      db.updateGenerationRound(roundId, { status: 'canceled', completedAt: nowIso() });
      emitGenerationEvent({ type: 'round_status', roundId, status: 'canceled' });
      return;
    }

    db.updateGenerationRound(roundId, {
      status: 'done',
      content: JSON.stringify(proposal, null, 2),
      modelProvider: settings.chat.provider,
      modelName: settings.chat.model,
      errorMessage: null,
      completedAt: nowIso()
    });
    emitGenerationEvent({ type: 'round_done', roundId, status: 'done' });

    try {
      const patch = createPatchFromGenerationRound(db, roundId);
      emitGenerationEvent({ type: 'patch_created', roundId, patchId: patch.id, status: 'patch_created' });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      db.updateGenerationRound(roundId, { status: 'done', errorMessage: message });
      emitGenerationEvent({ type: 'round_error', roundId, errorMessage: message });
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (controller.signal.aborted || db.getGenerationRound(roundId)?.status === 'canceled') {
      db.updateGenerationRound(roundId, { status: 'canceled', completedAt: nowIso() });
      emitGenerationEvent({ type: 'round_status', roundId, status: 'canceled' });
      return;
    }
    db.updateGenerationRound(roundId, {
      status: 'error',
      errorMessage: message,
      completedAt: nowIso()
    });
    emitGenerationEvent({ type: 'round_error', roundId, errorMessage: message });
  } finally {
    interactiveGenerationRuns.delete(roundId);
  }
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

  ipcMain.handle(ipcChannels.updateProjectBrief, (_event, payload: UpdateProjectBriefPayload) => {
    const db = getActiveDb();
    db.updateProjectBrief(payload);
    return getState(payload.focusSectionId ?? undefined);
  });

  ipcMain.handle(ipcChannels.suggestProjectBrief, (_event, payload: SuggestProjectBriefPayload) =>
    suggestProjectBrief(getActiveDb(), payload)
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
      await indexKnowledgeItem(
        db,
        item.id,
        settings.embedding,
        settings.chat,
        settings.knowledge.retrieval
      );
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
        await indexKnowledgeItem(
          db,
          item.id,
          settings.embedding,
          settings.chat,
          settings.knowledge.retrieval
        );
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
    await indexKnowledgeItem(
      db,
      itemId,
      settings.embedding,
      settings.chat,
      settings.knowledge.retrieval
    );
    return getState();
  });

  ipcMain.handle(ipcChannels.searchKnowledge, async (_event, payload: KnowledgeSearchPayload) => {
    const db = getActiveDb();
    const settings = readLlmSettings();
    const contextNodes = getSelectedContextNodes(db, payload.contextNodeIds);
    const articleSectionContext = payload.sectionId
      ? buildProjectAwareArticleContextFromDb(db, payload.sectionId, payload.focusSectionId)
      : buildProjectBriefPromptContext(db);
    const queries = articleSectionContext
      ? buildKnowledgeRetrievalQueries(payload.query, articleSectionContext, contextNodes)
      : [payload.query];
    const runId = payload.retrievalMode === 'sourcev2' ? payload.runId ?? createId('retrieval') : payload.runId;
    return retrieveKnowledgeForGeneration(db, payload.query, {
      excludedItemIds: payload.excludedItemIds,
      excludedChunkIds: payload.excludedChunkIds,
      maxChunks: payload.maxChunks,
      queries,
      retrievalMode: payload.retrievalMode,
      runId,
      settings,
      onTrace: (traceEvent) => {
        _event.sender.send(ipcChannels.knowledgeRetrievalStream, traceEvent);
      }
    });
  });

  ipcMain.handle(
    ipcChannels.resolveKnowledgeCitation,
    (_event, payload: { publicRef?: string; chunkId?: string }): KnowledgeSourceTarget | null =>
      getActiveDb().resolveKnowledgeSourceTarget(payload)
  );

  ipcMain.handle(ipcChannels.getKnowledgeDebugDetails, () => {
    const settings = readLlmSettings();
    return {
      chunking: getKnowledgeChunkingDebugConfig(settings.knowledge.retrieval),
      items: getActiveDb().listKnowledgeDebugItems(),
      generatedAt: new Date().toISOString()
    };
  });

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

  ipcMain.handle(
    ipcChannels.createGenerationTask,
    async (_event, payload: CreateGenerationTaskPayload): Promise<CreateGenerationTaskResult> => {
      const db = getActiveDb();
      const section = db.getSection(payload.sectionId);
      if (!section) {
        throw new Error(`Section not found: ${payload.sectionId}`);
      }
      const userPrompt = payload.prompt.trim();
      if (!userPrompt) {
        throw new Error('Tell the assistant what to change first.');
      }

      const settings = readLlmSettings();
      const contextNodeIds = payload.contextNodeIds ?? [];
      const contextNodes = getSelectedContextNodes(db, contextNodeIds);
      const articleSectionContext = buildProjectAwareArticleContextFromDb(
        db,
        payload.sectionId,
        payload.focusSectionId
      );
      const request = buildGenerationTaskRequest(payload.mode, {
        section,
        prompt: userPrompt,
        targetStart: payload.targetStart,
        targetEnd: payload.targetEnd
      });
      const executionMode = resolveGenerationExecutionMode(payload.executionMode, payload.mode);
      const useKnowledgeSources = payload.useKnowledgeSources !== false;
      const knowledgeRetrievalPrompt = payload.knowledgeRetrievalPrompt?.trim() || userPrompt;
      const retrievalTrace: KnowledgeRetrievalTraceEvent[] = [];
      const retrievedSources = useKnowledgeSources
        ? await retrieveKnowledgeForGeneration(db, knowledgeRetrievalPrompt, {
            queries: buildKnowledgeRetrievalQueries(knowledgeRetrievalPrompt, articleSectionContext, contextNodes),
            retrievalMode: payload.retrievalMode,
            settings,
            runId: createId('retrieval'),
            onTrace: (traceEvent) => {
              retrievalTrace.push(traceEvent);
            }
          })
        : [];
      const resolvedPrompt = buildContextPrompt(
        request.prompt,
        contextNodes,
        articleSectionContext,
        retrievedSources,
        useKnowledgeSources && (payload.requireInlineCitations ?? true)
      );
      const systemPrompt = request.systemPrompt?.trim()
        ? `${articleSectionContext}\n\n${request.systemPrompt.trim()}`
        : articleSectionContext;
      const applyPayload = {
        ...request.applyPayload,
        focusSectionId: payload.focusSectionId ?? payload.sectionId,
        contextNodeIds,
        ...(request.applyPayload.kind === 'edit' ? { resolvedPrompt, systemPrompt } : {})
      };
      const { sessionId } = db.createGenerationSession(
        payload.sectionId,
        `${generationModeLabel(payload.mode)} · ${section.title}`
      );
      const round = db.createGenerationRound({
        sessionId,
        mode: payload.mode,
        executionMode,
        outputMode: 'patchProposal',
        prompt: userPrompt,
        resolvedPrompt,
        systemPrompt,
        retrievedSources,
        retrievalTrace,
        modelProvider: settings.chat.provider,
        modelName: settings.chat.model,
        applyPayloadJson: JSON.stringify(applyPayload)
      });
      emitGenerationEvent({
        type: 'round_created',
        roundId: round.id,
        sessionId,
        executionMode,
        status: 'pending'
      });
      if (executionMode === 'background') {
        db.enqueueGenerationJob(round.id, {
          prompt: resolvedPrompt,
          systemPrompt,
          outputMode: 'patchProposal'
        });
        await startBackgroundTaskWorker(db);
      } else {
        void runInteractiveGenerationTask(db, round.id, {
          prompt: resolvedPrompt,
          systemPrompt
        });
      }
      return { roundId: round.id, sessionId, status: 'pending', executionMode };
    }
  );

  ipcMain.handle(ipcChannels.cancelGenerationTask, (_event, roundId: string) => {
    const db = getActiveDb();
    const round = db.getGenerationRound(roundId);
    if (!round) {
      throw new Error(`Generation round not found: ${roundId}`);
    }
    if (round.status !== 'pending' && round.status !== 'processing') {
      return round;
    }
    interactiveGenerationRuns.get(roundId)?.abort();
    const canceled = db.updateGenerationRound(roundId, { status: 'canceled', completedAt: nowIso() });
    emitGenerationEvent({ type: 'round_status', roundId, status: 'canceled' });
    return canceled;
  });

  ipcMain.handle(ipcChannels.adoptGenerationTask, (_event, payload: AdoptGenerationPayload) => {
    return createPatchFromRound(payload.roundId);
  });

  ipcMain.handle(ipcChannels.discardGenerationTask, (_event, roundId: string) => {
    interactiveGenerationRuns.get(roundId)?.abort();
    getActiveDb().deleteGenerationRound(roundId);
  });

  ipcMain.handle(ipcChannels.retryGenerationTask, async (_event, roundId: string): Promise<CreateGenerationTaskResult> => {
    const db = getActiveDb();
    const round = db.getGenerationRound(roundId);
    if (!round) {
      throw new Error(`Generation round not found: ${roundId}`);
    }
    const session = db.getGenerationSession(round.sessionId);
    if (!session) {
      throw new Error(`Generation session not found: ${round.sessionId}`);
    }
    const newRound = db.createGenerationRound({
      sessionId: round.sessionId,
      mode: round.mode,
      executionMode: round.executionMode,
      outputMode: round.outputMode,
      prompt: round.prompt,
      resolvedPrompt: round.resolvedPrompt,
      systemPrompt: round.systemPrompt,
      retrievedSources: round.retrievedSources,
      retrievalTrace: round.retrievalTrace,
      modelProvider: round.modelProvider,
      modelName: round.modelName,
      applyPayloadJson: db.getGenerationRoundApplyPayload(round.id)
    });
    emitGenerationEvent({
      type: 'round_created',
      roundId: newRound.id,
      sessionId: newRound.sessionId,
      executionMode: newRound.executionMode,
      status: 'pending'
    });
    if (newRound.executionMode === 'background') {
      db.enqueueGenerationJob(newRound.id, {
        prompt: newRound.resolvedPrompt ?? newRound.prompt,
        systemPrompt: newRound.systemPrompt ?? undefined,
        outputMode: 'patchProposal'
      });
      await startBackgroundTaskWorker(db);
    } else {
      void runInteractiveGenerationTask(db, newRound.id, {
        prompt: newRound.resolvedPrompt ?? newRound.prompt,
        systemPrompt: newRound.systemPrompt ?? undefined
      });
    }
    return {
      roundId: newRound.id,
      sessionId: newRound.sessionId,
      status: 'pending',
      executionMode: newRound.executionMode
    };
  });

  ipcMain.handle(
    ipcChannels.createPatchFromGenerationRound,
    (_event, payload: CreatePatchFromGenerationRoundPayload) => createPatchFromRound(payload.roundId)
  );

  ipcMain.handle(ipcChannels.getWritingPatch, (_event, patchId: string) =>
    getActiveDb().getWritingPatch(patchId)
  );

  ipcMain.handle(ipcChannels.listWritingPatchesForSection, (_event, sectionId: string) =>
    getActiveDb().listWritingPatchesForSection(sectionId)
  );

  ipcMain.handle(ipcChannels.acceptWritingPatch, (_event, payload: AcceptWritingPatchPayload) =>
    acceptWritingPatch(payload)
  );

  ipcMain.handle(ipcChannels.rejectWritingPatch, (_event, patchId: string) =>
    rejectWritingPatch(patchId)
  );

  ipcMain.handle(ipcChannels.saveWritingPatchAsCandidate, (_event, patchId: string) =>
    saveWritingPatchAsCandidate(patchId)
  );

  ipcMain.handle(ipcChannels.listGenerationSessions, (_event, sectionId?: string | null) =>
    getActiveDb().listGenerationSessions(sectionId)
  );

  ipcMain.handle(ipcChannels.listGenerationRounds, (_event, sessionId: string) =>
    getActiveDb().listGenerationRounds(sessionId)
  );

  ipcMain.handle(ipcChannels.getGenerationRound, (_event, roundId: string) =>
    getActiveDb().getGenerationRound(roundId)
  );

  ipcMain.handle(ipcChannels.generateWithLlm, async (event, payload: GenerateLlmPayload) => {
    const settings = readLlmSettings();
    const db = getActiveDb();
    const controller = new AbortController();
    llmRuns.set(payload.runId, controller);

    let content = '';
    let retrievedSources: RetrievedKnowledgeSource[] = [];
    try {
      const section = db.getSection(payload.sectionId);
      if (!section) {
        throw new Error(`Section not found: ${payload.sectionId}`);
      }
      const contextNodes = getSelectedContextNodes(db, payload.contextNodeIds);
      const articleSectionContext = buildProjectAwareArticleContextFromDb(
        db,
        payload.sectionId,
        payload.focusSectionId
      );
      const useKnowledgeSources = payload.useKnowledgeSources !== false;
      const knowledgeRetrievalPrompt = payload.knowledgeRetrievalPrompt?.trim() || payload.prompt;
      retrievedSources = useKnowledgeSources
        ? payload.prefetchedKnowledgeSources ?? await retrieveKnowledgeForGeneration(
            db,
            knowledgeRetrievalPrompt,
            {
              excludedItemIds: payload.excludedKnowledgeItemIds,
              excludedChunkIds: payload.excludedKnowledgeChunkIds,
              maxChunks: payload.maxKnowledgeChunks,
              queries: buildKnowledgeRetrievalQueries(knowledgeRetrievalPrompt, articleSectionContext, contextNodes),
              retrievalMode: payload.retrievalMode,
              runId: payload.runId,
              settings,
              abortSignal: controller.signal,
              onTrace: (traceEvent) => {
                event.sender.send(ipcChannels.knowledgeRetrievalStream, traceEvent);
              }
            }
          )
        : [];
      if (controller.signal.aborted) {
        event.sender.send(ipcChannels.llmStream, {
          type: 'canceled',
          runId: payload.runId
        });
        return { runId: payload.runId, content, canceled: true };
      }
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

      event.sender.send(ipcChannels.llmStream, {
        type: 'started',
        runId: payload.runId,
        sectionId: payload.sectionId
      });

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
    const db = getActiveDb();
    const section = db.getSection(payload.sectionId);
    if (!section) {
      throw new Error(`Section not found: ${payload.sectionId}`);
    }
    const prompt = payload.prompt.trim();
    if (!prompt) {
      throw new Error('Tell the assistant what to write first.');
    }
    const contextNodes = getSelectedContextNodes(db, payload.contextNodeIds);
    const articleSectionContext = buildProjectAwareArticleContextFromDb(
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
    const candidate = db.createNode({
      kind: 'content',
      parentId: payload.sectionId,
      title: `Assistant draft · ${section.title}`,
      content: payload.content.trim(),
      isLlm: true,
      metadata: {
        nodeRole: 'llm-candidate',
        prompt,
        resolvedPrompt,
        retrievedSources: payload.retrievedSources ?? []
      }
    });
    const contextRelationType = payload.contextRelationType ?? 'informs';
    contextNodes.forEach((node) => {
      db.createNodeEdge(node.id, candidate.id, contextRelationType, 'llm');
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
    return getState(payload.focusSectionId ?? payload.sectionId);
  });

  ipcMain.handle(ipcChannels.applySectionLlmEdit, (_event, payload: ApplySectionLlmEditPayload) => {
    void payload;
    throw new Error('Direct edits are disabled. Use an assistant suggestion and apply it from the review step.');
  });
}

function createPatchFromRound(roundId: string): WritingPatchRecord {
  const patch = createPatchFromGenerationRound(getActiveDb(), roundId);
  emitGenerationEvent({ type: 'patch_created', roundId, patchId: patch.id, status: 'patch_created' });
  return patch;
}

const terminalPatchStatuses = new Set<WritingPatch['status']>(['applied', 'rejected', 'saved_as_candidate']);

function assistStatusLabel(status: WritingPatch['status']): string {
  switch (status) {
    case 'applied':
      return 'applied';
    case 'rejected':
      return 'dismissed';
    case 'saved_as_candidate':
      return 'saved as a separate draft';
    case 'blocked':
    case 'parse_failed':
    case 'validation_failed':
      return 'needing attention';
    default:
      return status.replace(/_/g, ' ');
  }
}

function assertPatchNotTerminal(patch: WritingPatch, action: string): void {
  if (terminalPatchStatuses.has(patch.status)) {
    throw new Error(`Cannot ${action} a suggestion that is already ${assistStatusLabel(patch.status)}.`);
  }
}

function assertPatchCanBeAccepted(patch: WritingPatch): void {
  if (patch.status === 'blocked' || patch.status === 'parse_failed' || patch.status === 'validation_failed' || patch.status === 'rolled_back') {
    throw new Error(`This suggestion needs attention before it can be applied.`);
  }
}

function applicationProvenance(patch: WritingPatch): Pick<PatchApplicationResult, 'patchId' | 'generationSessionId' | 'generationRoundId'> {
  return {
    patchId: patch.id,
    generationSessionId: patch.origin.generationSessionId,
    generationRoundId: patch.origin.generationRoundId
  };
}

function acceptWritingPatch(payload: AcceptWritingPatchPayload) {
  const db = getActiveDb();
  const record = db.getWritingPatch(payload.patchId);
  if (!record) {
    throw new Error(`Suggestion not found: ${payload.patchId}`);
  }
  const patch = record.patch;
  assertPatchNotTerminal(patch, 'accept');
  assertPatchCanBeAccepted(patch);
  if (patch.kind === 'create_content_candidate') {
    throw new Error('This suggestion can be saved as a separate draft.');
  }
  const section = db.getSection(patch.target.sectionId);
  const validation = validateWritingPatch(patch, section);
  const diffInput = beforeAfterForPatch(patch);
  if (!validation.ok || !section) {
    db.updateWritingPatch({
      ...patch,
      status: 'blocked',
      validation,
      metadata: {
        ...patch.metadata,
        riskLevel: validation.riskLevel
      },
      diff: createPatchDiff(diffInput.before, diffInput.after)
    });
    throw new Error(validation.errors[0]?.message ?? 'The suggestion needs attention before it can be applied.');
  }
  if (validation.riskLevel === 'high' && !payload.confirmHighRisk) {
    db.updateWritingPatch({
      ...patch,
      status: 'needs_review',
      validation,
      metadata: {
        ...patch.metadata,
        riskLevel: validation.riskLevel
      },
      diff: createPatchDiff(diffInput.before, diffInput.after)
    });
    throw new Error('This suggestion changes sensitive details and needs explicit confirmation before applying.');
  }

  const previousSectionHash = section.markdownHash;
  const nextMarkdown = markdownAfterWritingPatch(patch, section.markdownContent);
  const updatedSection = db.updateSectionMarkdown(section.id, nextMarkdown);
  const application: PatchApplicationResult = {
    ...applicationProvenance(patch),
    applied: true,
    appliedAt: nowIso(),
    appliedBy: 'user',
    sectionId: section.id,
    previousSectionHash,
    newSectionHash: updatedSection.markdownHash,
    gitStatus: 'skipped'
  };
  const appliedPatch = db.updateWritingPatch({
    ...patch,
    status: 'applied',
    validation,
    metadata: {
      ...patch.metadata,
      riskLevel: validation.riskLevel
    },
    diff: createPatchDiff(diffInput.before, diffInput.after),
    review: {
      decision: 'accepted',
      reviewedBy: 'user',
      reviewedAt: nowIso()
    },
    application
  }).patch;

  persistPatchProvenance(db, appliedPatch, 'revises');
  const gitResult = checkpointPatchApplication(db.workspacePath, appliedPatch);
  db.updateWritingPatch({
    ...appliedPatch,
    application: {
      ...application,
      ...gitResult
    }
  });
  if (patch.origin.generationRoundId) {
    db.updateGenerationRound(patch.origin.generationRoundId, {
      status: 'patch_accepted',
      adoptedAt: nowIso()
    });
  }
  return getState(section.id);
}

function rejectWritingPatch(patchId: string): WritingPatchRecord {
  const db = getActiveDb();
  const record = db.getWritingPatch(patchId);
  if (!record) {
    throw new Error(`Suggestion not found: ${patchId}`);
  }
  const patch = record.patch;
  assertPatchNotTerminal(patch, 'reject');
  const next = db.updateWritingPatch({
    ...patch,
    status: 'rejected',
    review: {
      decision: 'rejected',
      reviewedBy: 'user',
      reviewedAt: nowIso()
    }
  });
  if (patch.origin.generationRoundId) {
    db.updateGenerationRound(patch.origin.generationRoundId, { status: 'patch_rejected' });
  }
  return next;
}

function saveWritingPatchAsCandidate(patchId: string) {
  const db = getActiveDb();
  const record = db.getWritingPatch(patchId);
  if (!record) {
    throw new Error(`Suggestion not found: ${patchId}`);
  }
  const patch = record.patch;
  assertPatchNotTerminal(patch, 'save as candidate');
  const section = db.getSection(patch.target.sectionId);
  if (!section) {
    throw new Error(`Section not found: ${patch.target.sectionId}`);
  }
  const candidateText = beforeAfterForPatch(patch).after.trim();
  if (!candidateText) {
    throw new Error('Cannot save an empty suggestion.');
  }
  const created = db.createNode({
    kind: 'content',
    parentId: section.id,
    title: patch.operation.type === 'create_candidate'
      ? patch.operation.candidateTitle ?? patch.metadata.title ?? 'Assistant draft'
      : patch.metadata.title ?? 'Assistant draft',
    content: candidateText,
    isLlm: true,
    metadata: {
      nodeRole: 'llm-candidate',
      writingPatchId: patch.id,
      generationRoundId: patch.origin.generationRoundId,
      generationSessionId: patch.origin.generationSessionId,
      prompt: patch.metadata.userGoal,
      rationale: patch.metadata.rationale,
      retrievedSources: patch.origin.generationRoundId
        ? db.getGenerationRound(patch.origin.generationRoundId)?.retrievedSources ?? []
        : []
    }
  });
  if (created.kind === 'content') {
    db.createNodeEdge(section.id, created.id, 'revises', 'llm');
  }
  persistPatchProvenance(db, patch, 'informs');
  const application: PatchApplicationResult = {
    ...applicationProvenance(patch),
    applied: false,
    appliedAt: nowIso(),
    appliedBy: 'user',
    sectionId: section.id,
    contentNodeId: created.id,
    previousSectionHash: section.markdownHash,
    createdContentNodeId: created.id,
    gitStatus: 'skipped'
  };
  db.updateWritingPatch({
    ...patch,
    target: {
      ...patch.target,
      contentNodeId: created.id
    },
    status: 'saved_as_candidate',
    review: {
      decision: 'saved_as_candidate',
      reviewedBy: 'user',
      reviewedAt: nowIso()
    },
    application
  });
  if (patch.origin.generationRoundId) {
    db.updateGenerationRound(patch.origin.generationRoundId, {
      status: 'saved_as_candidate',
      adoptedAt: nowIso()
    });
  }
  return getState(section.id);
}

function persistPatchProvenance(
  db: ReturnType<typeof getActiveDb>,
  patch: WritingPatch,
  contextRelationType: 'informs' | 'revises'
): void {
  const round = patch.origin.generationRoundId ? db.getGenerationRound(patch.origin.generationRoundId) : null;
  if (!round) {
    return;
  }
  const applyPayload = parseGenerationApplyPayload(db.getGenerationRoundApplyPayload(round.id));
  const contextNodes = getSelectedContextNodes(db, applyPayload.contextNodeIds);
  contextNodes.forEach((node) => {
    db.createNodeEdge(node.id, patch.target.sectionId, contextRelationType, 'llm');
  });
  ensureKnowledgeSourceNodes(db, applyPayload.focusSectionId ?? patch.target.sectionId, patch.target.sectionId, round.retrievedSources);
  db.saveGenerationCitations(
    patch.target.sectionId,
    round.retrievedSources.map((source) => ({
      publicRef: source.publicRef,
      knowledgeItemId: source.itemId,
      knowledgeChunkId: source.chunkId,
      label: source.publicRef,
      snippet: source.snippet,
      score: source.score
    }))
  );
}

function checkpointPatchApplication(
  workspacePath: string,
  patch: WritingPatch
): Pick<PatchApplicationResult, 'gitStatus' | 'gitCommitHash' | 'gitError'> {
  try {
    const checkpoint = createGitCheckpoint(
      workspacePath,
      `Apply assistant suggestion ${patch.id}: ${patch.kind} on section ${patch.target.sectionId}`
    );
    return checkpoint
      ? { gitStatus: 'created', gitCommitHash: checkpoint.hash }
      : { gitStatus: 'skipped' };
  } catch (caught) {
    return {
      gitStatus: 'failed',
      gitError: caught instanceof Error ? caught.message : String(caught)
    };
  }
}

function parseGenerationApplyPayload(raw: string | null): GenerationApplyPayload {
  if (!raw) {
    throw new Error('Generation task is missing adoption metadata.');
  }
  const parsed = JSON.parse(raw) as GenerationApplyPayload;
  if (!parsed || parsed.kind !== 'edit') {
    throw new Error('Generation task adoption metadata is invalid.');
  }
  return parsed;
}

function generationModeLabel(mode: GenerationMode): string {
  switch (mode) {
    case 'append':
      return 'Append';
    case 'rewrite_section':
      return 'Rewrite';
    case 'rewrite_selection':
      return 'Selection';
    case 'continue':
      return 'Continue';
  }
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
    throw new Error('Assistant edit range must use integer offsets.');
  }
  if (targetStart < 0 || targetEnd < targetStart || targetEnd > markdown.length) {
    throw new Error('Assistant edit range is outside the current section.');
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
