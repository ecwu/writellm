import { describe, expect, test } from 'bun:test';
import {
  CHAPTER_MAX_BLOCKS,
  CHAPTER_MAX_BYTES,
  CHAPTER_MAX_CITATIONS,
  CHAPTER_MAX_DEPTH,
} from '../../../src/shared/chapters';

describe('chapter security ceilings', () => {
  test('freezes reviewed limits', () => {
    expect(CHAPTER_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(CHAPTER_MAX_BLOCKS).toBe(10_000);
    expect(CHAPTER_MAX_DEPTH).toBe(32);
    expect(CHAPTER_MAX_CITATIONS).toBe(10_000);
  });
});
