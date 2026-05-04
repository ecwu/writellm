import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export { defaultSectionMarkdown, sectionMarkdownForStorage } from '../shared/sectionMarkdown.js';

const SECTIONS_DIR = 'sections';

export function sectionMarkdownPath(sectionId: string): string {
  return path.posix.join(SECTIONS_DIR, `${sectionId}.md`);
}

export function hashMarkdown(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

export function readSectionMarkdownFile(workspacePath: string, relativePath: string): string | null {
  const absolutePath = resolveSectionMarkdownPath(workspacePath, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return readFileSync(absolutePath, 'utf8');
}

export function writeSectionMarkdownFile(
  workspacePath: string,
  relativePath: string,
  markdown: string
): void {
  const absolutePath = resolveSectionMarkdownPath(workspacePath, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`
  );
  writeFileSync(temporaryPath, markdown, 'utf8');
  renameSync(temporaryPath, absolutePath);
}

export function ensureSectionsDirectory(workspacePath: string): void {
  mkdirSync(path.join(workspacePath, SECTIONS_DIR), { recursive: true });
}

function resolveSectionMarkdownPath(workspacePath: string, relativePath: string): string {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const sectionsRoot = path.resolve(workspacePath, SECTIONS_DIR);
  const absolutePath = path.resolve(workspacePath, normalizedRelativePath);
  if (absolutePath !== sectionsRoot && !absolutePath.startsWith(`${sectionsRoot}${path.sep}`)) {
    throw new Error('Section Markdown path must be inside the workspace sections directory.');
  }
  if (path.extname(absolutePath).toLowerCase() !== '.md') {
    throw new Error('Section Markdown path must be a .md file.');
  }
  return absolutePath;
}
