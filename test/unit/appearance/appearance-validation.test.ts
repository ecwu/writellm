import { describe, expect, test } from 'bun:test';
import {
  defaultAppearancePreferences,
  parseAppearanceInput,
  parseAppearancePreferences,
} from '../../../src/shared/appearance';

describe('appearance validation', () => {
  test('accepts the canonical accepted DTO and complete update input', () => {
    expect(parseAppearancePreferences(defaultAppearancePreferences)).toEqual(
      defaultAppearancePreferences,
    );
    const { schemaVersion: _, ...input } = defaultAppearancePreferences;
    expect(parseAppearanceInput(input)).toEqual(defaultAppearancePreferences);
  });
  test('rejects legacy, partial, arbitrary and out-of-bounds values', () => {
    for (const value of [
      { version: 1 },
      { themeMode: 'dark' },
      { ...defaultAppearancePreferences, arbitraryCss: 'url(https://example.invalid)' },
      { ...defaultAppearancePreferences, themeMode: 'blue' },
      { ...defaultAppearancePreferences, bodyFontId: 'Comic Sans' },
      { ...defaultAppearancePreferences, monoFontId: 'system-sans' },
      { ...defaultAppearancePreferences, baseSize: Infinity },
      { ...defaultAppearancePreferences, baseSize: 11 },
      { ...defaultAppearancePreferences, leading: 3 },
      { ...defaultAppearancePreferences, flow: 0.5 },
    ])
      expect(parseAppearancePreferences(value)).toBeNull();
  });
});
