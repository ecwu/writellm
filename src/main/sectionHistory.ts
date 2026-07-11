import type { SectionHistoryDetail, SectionNodeRecord } from '../shared/types.js';
import type { WriteLLMDatabase } from './database.js';
import { createGitCheckpoint, getSectionVersion, listGitHistory } from './gitSession.js';

const SECTION_HISTORY_LIMIT = 200;

export function restoreSectionVersion(
  db: WriteLLMDatabase,
  sectionId: string,
  commitHash: string
): SectionNodeRecord {
  const section = db.getSection(sectionId);
  if (!section) {
    throw new Error(`Section not found: ${sectionId}`);
  }
  const markdown = getSectionVersion(db.workspacePath, sectionId, commitHash);
  createGitCheckpoint(db.workspacePath, `Before restore: ${section.title}`);
  const restored = db.updateSectionMarkdown(sectionId, markdown);
  createGitCheckpoint(db.workspacePath, `Restore: ${section.title} to ${commitHash.slice(0, 7)}`);
  return restored;
}

export function getSectionHistoryDetail(
  db: WriteLLMDatabase,
  sectionId: string,
  commitHash: string
): SectionHistoryDetail {
  const section = db.getSection(sectionId);
  if (!section) {
    throw new Error(`Section not found: ${sectionId}`);
  }

  const history = listGitHistory(db.workspacePath, sectionId, SECTION_HISTORY_LIMIT);
  const selectedIndex = history.findIndex((entry) => entry.hash === commitHash);
  if (selectedIndex < 0) {
    throw new Error(`Section checkpoint not found: ${commitHash}`);
  }

  const selectedCommit = history[selectedIndex];
  const parentCommit = history[selectedIndex + 1] ?? null;
  const afterMarkdown = getSectionVersion(db.workspacePath, sectionId, selectedCommit.hash);
  const beforeMarkdown = parentCommit
    ? getSectionVersion(db.workspacePath, sectionId, parentCommit.hash)
    : '';
  const unifiedDiff = parentCommit
    ? buildSectionDiff(section.id, beforeMarkdown, afterMarkdown)
    : buildInitialSectionDiff(section.id, afterMarkdown);

  return {
    sectionId,
    selectedCommit,
    parentCommit,
    beforeMarkdown,
    afterMarkdown,
    unifiedDiff
  };
}

function buildInitialSectionDiff(sectionId: string, markdown: string): string {
  const lines = markdown.length > 0 ? markdown.split('\n') : [];
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return '';
  }

  return [
    `diff --git a/document.json#${sectionId} b/document.json#${sectionId}`,
    'new file mode 100644',
    'index 0000000..0000000',
    '--- /dev/null',
    `+++ b/document.json#${sectionId}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join('\n');
}

function buildSectionDiff(sectionId: string, before: string, after: string): string {
  if (before === after) {
    return '';
  }
  const beforeLines = before.length > 0 ? before.split('\n') : [];
  const afterLines = after.length > 0 ? after.split('\n') : [];
  return [
    `diff --git a/document.json#${sectionId} b/document.json#${sectionId}`,
    `--- a/document.json#${sectionId}`,
    `+++ b/document.json#${sectionId}`,
    `@@ -1,${Math.max(1, beforeLines.length)} +1,${Math.max(1, afterLines.length)} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ].join('\n');
}
