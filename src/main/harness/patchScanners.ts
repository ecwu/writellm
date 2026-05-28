import { createHash } from 'node:crypto';
import { citationRefsFromText } from '../../shared/citations.js';

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function hashText(text: string): string {
  return createHash('sha256').update(normalizeLineEndings(text), 'utf8').digest('hex');
}

export function scanCitations(text: string): string[] {
  const refs = new Set<string>();
  citationRefsFromText(text).forEach((ref) => refs.add(ref.toLowerCase()));

  const latexPattern = /\\cite(?:t|p)?\{([^}]+)\}/g;
  for (const match of text.matchAll(latexPattern)) {
    match[1].split(',').map((part) => part.trim()).filter(Boolean).forEach((ref) => refs.add(ref));
  }

  const pandocPattern = /\[@([A-Za-z0-9_:.#/-]+)\]/g;
  for (const match of text.matchAll(pandocPattern)) {
    refs.add(match[1]);
  }

  return [...refs].sort();
}

export function scanNumbers(text: string): string[] {
  return (text.match(/(?:Top@\d+|[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?(?:\s*(?:ms|s|sec|KB|MB|GB|pages?|x))?)/g) ?? [])
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => /[0-9]/.test(value));
}

export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

