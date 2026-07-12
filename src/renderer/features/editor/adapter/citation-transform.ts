import type { CitationAnchor } from '../../../../shared/chapters';

const review = (
  citation: CitationAnchor,
  reason: CitationAnchor['reviewReason'],
  blockId = citation.blockId,
): CitationAnchor => ({ ...citation, blockId, status: 'needs-review', reviewReason: reason });
export const preserveMovedCitations = (citations: CitationAnchor[], blockId: string) =>
  citations.map((citation) => (citation.blockId === blockId ? { ...citation } : citation));
export function transformSplit(
  citations: CitationAnchor[],
  blockId: string,
  newBlockId: string,
  offset: number,
) {
  return citations.map((citation) => {
    if (citation.blockId !== blockId) return citation;
    if (citation.end <= offset) return citation;
    if (citation.start >= offset)
      return {
        ...citation,
        blockId: newBlockId,
        start: citation.start - offset,
        end: citation.end - offset,
      };
    return review(citation, 'range-split');
  });
}
export function transformMerge(
  citations: CitationAnchor[],
  firstId: string,
  secondId: string,
  firstLength: number,
) {
  return citations.map((citation) =>
    citation.blockId === secondId
      ? {
          ...citation,
          blockId: firstId,
          start: citation.start + firstLength,
          end: citation.end + firstLength,
        }
      : citation,
  );
}
export function transformDelete(
  citations: CitationAnchor[],
  blockId: string,
  start = 0,
  end = Number.POSITIVE_INFINITY,
) {
  return citations.map((citation) => {
    if (citation.blockId !== blockId) return citation;
    if (end <= citation.start)
      return {
        ...citation,
        start: citation.start - (end - start),
        end: citation.end - (end - start),
      };
    if (start >= citation.end) return citation;
    return review(citation, 'text-deleted');
  });
}
export function flagMissingAnchors(citations: CitationAnchor[], blockIds: Set<string>) {
  return citations.map((citation) =>
    blockIds.has(citation.blockId) ? citation : review(citation, 'block-missing'),
  );
}
