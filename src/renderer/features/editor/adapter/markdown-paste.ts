import type {
  BlockNoteBlockSnapshot,
  ConversionWarning,
  MarkdownPastePreview,
} from '../../../../shared/chapters';
export async function previewMarkdownPaste(
  markdown: string,
  parse: (value: string) => unknown[] | Promise<unknown[]>,
): Promise<MarkdownPastePreview> {
  const warnings: ConversionWarning[] = [];
  if (/<[^>]+>|\[\^[^\]]+\]|:::/.test(markdown))
    warnings.push({
      code: 'UNSUPPORTED_MARKDOWN',
      message: 'Some Markdown syntax may be converted to plain text.',
    });
  const candidateBlocks = (await Promise.resolve(parse(markdown))) as BlockNoteBlockSnapshot[];
  return {
    previewId: crypto.randomUUID(),
    candidateBlocks,
    warnings,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}
