import type {
  CompositionTreeNode,
  ContentNodeRecord,
  KnowledgeRetrievalMode,
  KnowledgeRetrievalTraceEvent,
  RetrievedKnowledgeSource,
  SectionNodeRecord
} from '../shared/types.js';
import type { WriteLLMDatabase } from './database.js';
import { formatSourcesForPrompt } from './knowledgeIndex.js';
import type { readLlmSettings } from './llmSettings.js';
import { retrieveKnowledgeInWorker } from './retrievalWorkerClient.js';

export function formatArticleStructure(
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

function findSectionInTree(nodes: CompositionTreeNode[], sectionId: string): CompositionTreeNode | null {
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

export function buildArticleSectionContextFromDb(
  db: WriteLLMDatabase,
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

export function buildProjectAwareArticleContextFromDb(
  db: WriteLLMDatabase,
  targetSectionId: string,
  focusSectionId?: string | null
): string {
  return [buildProjectBriefPromptContext(db), buildArticleSectionContextFromDb(db, targetSectionId, focusSectionId)]
    .filter((section) => section.trim())
    .join('\n\n');
}

export function buildProjectBriefPromptContext(db: WriteLLMDatabase): string {
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

export function buildCompositionTreeFromSections(sections: SectionNodeRecord[]): CompositionTreeNode[] {
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

export function buildContextPrompt(
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
        const flags = [node.isMain ? 'main' : null, node.isLlm ? 'llm' : null].filter(Boolean).join(', ') || 'content';
        return [`[${index + 1}] ${node.title} (${flags})`, node.content.trim() || '(empty)'].join('\n');
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

export function buildKnowledgeRetrievalQueries(
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

export async function retrieveKnowledgeForGeneration(
  db: WriteLLMDatabase,
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
