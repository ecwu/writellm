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
    const semanticSectionEnd = patch.target.location.mode === 'section_end';
    const offset = semanticSectionEnd ? currentMarkdown.length : patch.target.location.offset;
    return [
      currentMarkdown.slice(0, offset),
      semanticSectionEnd
        ? sectionEndInsertionText(currentMarkdown, patch.operation.text)
        : insertionText(currentMarkdown, offset, patch.operation.text),
      currentMarkdown.slice(offset)
    ].join('');
  }

  if (patch.kind === 'replace_section' && patch.operation.type === 'replace') {
    return patch.operation.after;
  }

  throw new Error(`This suggestion type cannot be applied directly: ${patch.kind}`);
}

function insertionText(markdown: string, offset: number, text: string): string {
  const before = markdown.slice(0, offset);
  if (!before.trim() || before.endsWith('\n') || text.startsWith('\n')) {
    return text;
  }
  return `\n\n${text}`;
}

function sectionEndInsertionText(markdown: string, text: string): string {
  if (!markdown.trim() || text.startsWith('\n')) {
    return text;
  }
  if (markdown.endsWith('\n\n')) {
    return text;
  }
  if (markdown.endsWith('\n')) {
    return `\n${text}`;
  }
  return `\n\n${text}`;
}
