import type { PatchDiff } from '../../shared/types.js';
import { scanCitations, scanNumbers, wordCount } from './patchScanners.js';

export function createPatchDiff(before: string, after: string): PatchDiff {
  const beforeCitations = new Set(scanCitations(before));
  const afterCitations = new Set(scanCitations(after));
  const beforeNumbers = scanNumbers(before);
  const afterNumbers = scanNumbers(after);

  return {
    diffKind: 'side_by_side',
    before,
    after,
    unifiedDiff: simpleUnifiedDiff(before, after),
    stats: {
      charsAdded: Math.max(0, after.length - before.length),
      charsRemoved: Math.max(0, before.length - after.length),
      wordsAdded: Math.max(0, wordCount(after) - wordCount(before)),
      wordsRemoved: Math.max(0, wordCount(before) - wordCount(after)),
      citationsAdded: [...afterCitations].filter((citation) => !beforeCitations.has(citation)).length,
      citationsRemoved: [...beforeCitations].filter((citation) => !afterCitations.has(citation)).length,
      numbersChanged: numbersChanged(beforeNumbers, afterNumbers)
    }
  };
}

function numbersChanged(before: string[], after: string[]): number {
  const afterCounts = countValues(after);
  let changed = 0;
  for (const number of before) {
    const count = afterCounts.get(number) ?? 0;
    if (count === 0) {
      changed += 1;
      continue;
    }
    afterCounts.set(number, count - 1);
  }
  return changed;
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return counts;
}

function simpleUnifiedDiff(before: string, after: string): string {
  if (before === after) {
    return '';
  }
  return [
    '--- before',
    '+++ after',
    ...before.split('\n').map((line) => `-${line}`),
    ...after.split('\n').map((line) => `+${line}`)
  ].join('\n');
}

