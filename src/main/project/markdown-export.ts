import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type {
  BlockNoteBlockSnapshot,
  ChapterResult,
  CitationAnchor,
  ConversionWarning,
  MarkdownPreview,
} from '../../shared/chapters.js';
import type { ChapterSession } from './chapter-repository.js';

type SaveDialog = {
  showSaveDialog(
    options: Record<string, unknown>,
  ): Promise<{ canceled: boolean; filePath?: string }>;
};
type Stored = MarkdownPreview & { chapterId: string; sessionId: string };
const inline = (block: BlockNoteBlockSnapshot) =>
  Array.isArray(block.content)
    ? block.content
        .map((item) =>
          item.type === 'text'
            ? item.text
            : `[${item.content.map((part) => part.text).join('')}](${item.href})`,
        )
        .join('')
    : '';
export function blocksToMarkdown(
  blocks: BlockNoteBlockSnapshot[],
  citations: CitationAnchor[],
): { markdown: string; warnings: ConversionWarning[] } {
  const warnings: ConversionWarning[] = [];
  const lines: string[] = [];
  const render = (items: BlockNoteBlockSnapshot[], depth = 0) => {
    for (const block of items) {
      const value = inline(block);
      switch (block.type) {
        case 'heading':
          lines.push(
            `${'#'.repeat(Math.max(1, Math.min(6, Number(block.props.level) || 1)))} ${value}`,
          );
          break;
        case 'bulletListItem':
          lines.push(`${'  '.repeat(depth)}- ${value}`);
          break;
        case 'numberedListItem':
          lines.push(`${'  '.repeat(depth)}1. ${value}`);
          break;
        case 'checkListItem':
          lines.push(`${'  '.repeat(depth)}- [${block.props.checked ? 'x' : ' '}] ${value}`);
          break;
        case 'quote':
          lines.push(`> ${value}`);
          break;
        case 'codeBlock':
          lines.push(`\`\`\`${String(block.props.language ?? '')}\n${value}\n\`\`\``);
          break;
        case 'image':
          lines.push(`![${String(block.props.caption ?? '')}](${String(block.props.url ?? '')})`);
          break;
        case 'table':
          warnings.push({
            code: 'LOSSY_BLOCK',
            message: 'Table formatting may be simplified.',
            location: { blockId: block.id },
          });
          lines.push(value);
          break;
        case 'writellmCitation':
          warnings.push({
            code: 'LOSSY_BLOCK',
            message: 'Custom citation tokens are exported as readable text.',
            location: { blockId: block.id },
          });
          lines.push(value);
          break;
        default:
          lines.push(value);
      }
      if (block.children.length) render(block.children, depth + 1);
      lines.push('');
    }
  };
  render(blocks);
  for (const citation of citations)
    warnings.push({
      code: 'LOSSY_CITATION',
      message: 'Citation identity cannot be restored from Markdown.',
      location: { blockId: citation.blockId },
    });
  return { markdown: `${lines.join('\n').trimEnd()}\n`, warnings };
}
export class MarkdownExportService {
  private previews = new Map<string, Stored>();
  constructor(
    private readonly dialog: SaveDialog,
    private readonly now = () => Date.now(),
    private readonly ttlMs = 5 * 60_000,
  ) {}
  preview(
    session: ChapterSession,
    chapterId: string,
    blocks: BlockNoteBlockSnapshot[],
    citations: CitationAnchor[],
  ): MarkdownPreview {
    const converted = blocksToMarkdown(blocks, citations),
      previewId = randomUUID(),
      expiresAt = new Date(this.now() + this.ttlMs).toISOString();
    const preview = { previewId, ...converted, expiresAt };
    this.previews.set(previewId, { ...preview, chapterId, sessionId: session.sessionId });
    return preview;
  }
  async export(
    session: ChapterSession,
    chapterId: string,
    previewId: string,
  ): Promise<ChapterResult<{ status: 'exported' | 'canceled' }>> {
    const preview = this.previews.get(previewId);
    if (
      !preview ||
      preview.chapterId !== chapterId ||
      preview.sessionId !== session.sessionId ||
      Date.parse(preview.expiresAt) <= this.now()
    )
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'That export preview expired. Create a new preview.',
          retryable: false,
        },
      };
    try {
      const selection = await this.dialog.showSaveDialog({
        title: 'Export chapter as Markdown',
        defaultPath: 'chapter.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (selection.canceled || !selection.filePath)
        return { ok: true, value: { status: 'canceled' } };
      await writeFile(selection.filePath, preview.markdown, 'utf8');
      this.previews.delete(previewId);
      return { ok: true, value: { status: 'exported' } };
    } catch {
      return {
        ok: false,
        error: {
          code: 'EXPORT_FAILED',
          message: 'The Markdown file could not be exported.',
          retryable: true,
        },
      };
    }
  }
}
