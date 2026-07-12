import type { BlockNoteBlockSnapshot, CitationAnchor } from '../../../../shared/chapters';

const clone = <T>(value: T): T => structuredClone(value);
const empty = (): BlockNoteBlockSnapshot => ({
  id: crypto.randomUUID(),
  type: 'paragraph',
  props: {},
  content: [],
  children: [],
});
export class BlockNoteAdapter {
  private blocks: BlockNoteBlockSnapshot[];
  private generation = 0;
  constructor(initial: BlockNoteBlockSnapshot[] = [empty()]) {
    this.blocks = clone(initial);
  }
  replace(blocks: BlockNoteBlockSnapshot[]) {
    this.blocks = clone(blocks.length ? blocks : [empty()]);
    this.generation += 1;
  }
  snapshot() {
    return { blocks: clone(this.blocks), generation: this.generation };
  }
  create(block: Omit<BlockNoteBlockSnapshot, 'id'>, index = this.blocks.length) {
    this.blocks.splice(index, 0, { ...clone(block), id: crypto.randomUUID() });
    return ++this.generation;
  }
  update(id: string, patch: Partial<Omit<BlockNoteBlockSnapshot, 'id'>>) {
    const block = this.blocks.find((item) => item.id === id);
    if (!block) return false;
    Object.assign(block, clone(patch));
    this.generation += 1;
    return true;
  }
  move(id: string, to: number) {
    const from = this.blocks.findIndex((item) => item.id === id);
    if (from < 0) return false;
    const [block] = this.blocks.splice(from, 1);
    this.blocks.splice(Math.max(0, Math.min(to, this.blocks.length)), 0, block);
    this.generation += 1;
    return true;
  }
  split(id: string, offset: number) {
    const index = this.blocks.findIndex((item) => item.id === id),
      block = this.blocks[index];
    if (!block || !Array.isArray(block.content)) return null;
    const text = block.content
      .map((item) =>
        item.type === 'text' ? item.text : item.content.map((part) => part.text).join(''),
      )
      .join('');
    block.content = [{ type: 'text', text: text.slice(0, offset), styles: {} }];
    const next = {
      ...clone(block),
      id: crypto.randomUUID(),
      content: [{ type: 'text' as const, text: text.slice(offset), styles: {} }],
    };
    this.blocks.splice(index + 1, 0, next);
    this.generation += 1;
    return next.id;
  }
  merge(firstId: string, secondId: string) {
    const first = this.blocks.find((item) => item.id === firstId),
      secondIndex = this.blocks.findIndex((item) => item.id === secondId),
      second = this.blocks[secondIndex];
    if (!first || !second || !Array.isArray(first.content) || !Array.isArray(second.content))
      return false;
    first.content = [...first.content, ...second.content];
    this.blocks.splice(secondIndex, 1);
    this.generation += 1;
    return true;
  }
  delete(id: string) {
    const index = this.blocks.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.blocks.splice(index, 1);
    if (!this.blocks.length) this.blocks = [empty()];
    this.generation += 1;
    return true;
  }
  boundedSnapshot(maxBlocks = 10_000) {
    if (this.blocks.length > maxBlocks) throw new Error('Block ceiling exceeded.');
    return this.snapshot();
  }
}
export type EditorSnapshot = {
  blocks: BlockNoteBlockSnapshot[];
  citations: CitationAnchor[];
  generation: number;
};
