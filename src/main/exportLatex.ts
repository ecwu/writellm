import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { PaperLabDatabase } from './database.js';
import { sectionMarkdownForExport } from '../shared/sectionMarkdown.js';

export function exportMarkdown(db: PaperLabDatabase, rootNodeId: string): string {
  const rows = db.getExportRows(rootNodeId);
  const body = rows
    .map(({ section, markdown, depth }) => sectionMarkdownForExport(section.title, markdown, depth).trim())
    .filter((content): content is string => Boolean(content))
    .join('\n\n');
  const exportPath = path.join(db.workspacePath, 'exports', 'main.md');
  writeFileSync(exportPath, `${body}\n`, 'utf8');
  return exportPath;
}

export function exportLatex(db: PaperLabDatabase, rootNodeId: string): string {
  return exportMarkdown(db, rootNodeId);
}
