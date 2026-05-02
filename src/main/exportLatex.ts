import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { PaperLabDatabase } from './database.js';

export function exportLatex(db: PaperLabDatabase, rootNodeId: string): string {
  const rows = db.getExportRows(rootNodeId);
  const body = rows
    .map(({ text }) => text?.content.trim())
    .filter((content): content is string => Boolean(content))
    .join('\n\n');
  const exportPath = path.join(db.workspacePath, 'exports', 'main.tex');
  writeFileSync(exportPath, `${body}\n`, 'utf8');
  return exportPath;
}
