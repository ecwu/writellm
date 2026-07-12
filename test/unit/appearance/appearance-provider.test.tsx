import { expect, test } from 'bun:test';
import {
  completedUpdate,
  effectiveTheme,
  initialAppearanceState,
  loadedAppearance,
} from '../../../src/renderer/appearance/appearanceState';
import { defaultAppearancePreferences } from '../../../src/shared/appearance';

test('appearance state loads, derives system theme, normalizes success and rolls back failure', () => {
  expect(effectiveTheme('system', true)).toBe('dark');
  expect(effectiveTheme('light', true)).toBe('light');
  const loaded = loadedAppearance({
    status: 'ok',
    preferences: { ...defaultAppearancePreferences, themeMode: 'dark' },
    warning: { code: 'APPEARANCE_PREFERENCES_CORRUPT', message: 'safe' },
  });
  expect(loaded.message).toBe('safe');
  expect(
    completedUpdate(initialAppearanceState, {
      status: 'error',
      error: { code: 'APPEARANCE_STORAGE_UNAVAILABLE', message: 'failed' },
    }).preferences,
  ).toEqual(defaultAppearancePreferences);
});
