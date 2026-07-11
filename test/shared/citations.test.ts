import { describe, expect, test } from 'bun:test';
import {
  citationGroupsFromText,
  citationRefsFromText,
  refsFromCitationText
} from '../../src/shared/citations.js';

describe('citation parsing', () => {
  test('normalizes and deduplicates references across adjacent citation groups', () => {
    const text = 'Evidence [A3F91C8.C1, b7e12aa.c2] \n [a3f91c8.c1] supports the claim.';

    const groups = citationGroupsFromText(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      raw: '[A3F91C8.C1, b7e12aa.c2] \n [a3f91c8.c1]',
      from: text.indexOf('['),
      to: text.indexOf('] supports') + 1,
      refs: ['a3f91c8.c1', 'b7e12aa.c2']
    });
    expect(citationRefsFromText(text)).toEqual(['a3f91c8.c1', 'b7e12aa.c2']);
  });

  test('does not mistake Markdown links and image labels for citations', () => {
    const text = '[a3f91c8.c1](https://example.test) ![b7e12aa.c2](figure.png) [c8d32fe.c3]';

    const groups = citationGroupsFromText(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      raw: '[c8d32fe.c3]',
      from: text.lastIndexOf('['),
      to: text.length,
      refs: ['c8d32fe.c3']
    });
  });

  test('extracts valid references only and keeps their first-seen order', () => {
    expect(refsFromCitationText('x A3F91C8.C1, bad.c1, a3f91c8.c1, b7e12aa.c2')).toEqual([
      'a3f91c8.c1',
      'b7e12aa.c2'
    ]);
  });
});
