
import type { ContentNodeRecord, NodeStats } from '../../shared/types';

export function formatWorkspaceTitle(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function formatRecentWorkspaceDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatContentPreview(node: ContentNodeRecord) {
  const content = node.content.trim();
  if (!content) {
    return 'Empty content';
  }
  return content.length > 110 ? `${content.slice(0, 110)}...` : content;
}

export function getGenerationPrompt(node: ContentNodeRecord | null | undefined) {
  const prompt = node?.metadata.prompt;
  if (typeof prompt !== 'string') {
    return undefined;
  }
  const trimmed = prompt.trim();
  return trimmed || undefined;
}

export function formatNodeStats(stats?: NodeStats) {
  const counts = stats ?? {
      sectionCount: 0,
      contentCount: 0,
      mainContentCount: 0,
      llmCount: 0
  };

  return [
    formatCount(counts.sectionCount, 'section'),
    formatCount(counts.contentCount, 'content'),
    formatCount(counts.mainContentCount, 'main'),
    formatCount(counts.llmCount, 'LLM')
  ].join(' · ');
}

export function formatContentFlags(node: ContentNodeRecord) {
  if (node.metadata.nodeRole === 'knowledge-source') {
    return 'source';
  }
  const flags = [
    node.isMain ? 'main' : null,
    node.isLlm ? 'LLM' : null
  ].filter(Boolean);
  return flags.length > 0 ? flags.join(' · ') : 'content';
}

function formatCount(count: number, label: string) {
  return `${count} ${label}${count === 1 || label === 'LLM' ? '' : 's'}`;
}
