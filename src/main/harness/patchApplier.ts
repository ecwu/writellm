import type { WritingPatch } from '../../shared/types.js';

export function markdownAfterWritingPatch(patch: WritingPatch, currentMarkdown: string): string {
  if (patch.kind === 'replace_selection' && patch.operation.type === 'replace' && patch.target.location.type === 'text_range') {
    return [
      currentMarkdown.slice(0, patch.target.location.startOffset),
      patch.operation.after,
      currentMarkdown.slice(patch.target.location.endOffset)
    ].join('');
  }

  if (patch.kind === 'insert_at_cursor' && patch.operation.type === 'insert' && patch.target.location.type === 'insertion') {
    return [
      currentMarkdown.slice(0, patch.target.location.offset),
      insertionText(currentMarkdown, patch.target.location.offset, patch.operation.text),
      currentMarkdown.slice(patch.target.location.offset)
    ].join('');
  }

  throw new Error(`WritingPatch kind cannot be directly applied in MVP: ${patch.kind}`);
}

function insertionText(markdown: string, offset: number, text: string): string {
  const before = markdown.slice(0, offset);
  if (!before.trim() || before.endsWith('\n') || text.startsWith('\n')) {
    return text;
  }
  return `\n\n${text}`;
}

