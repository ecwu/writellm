export const appearanceChannels = {
  get: 'writellm:appearance:get',
  update: 'writellm:appearance:update'
} as const;

export const themeModes = ['system', 'light', 'dark'] as const;
export const fontIds = ['system-sans', 'system-serif', 'system-mono'] as const;
export type ThemeMode = (typeof themeModes)[number];
export type AppearancePreferences = {
  version: 1;
  themeMode: ThemeMode;
  bodyFont: (typeof fontIds)[number];
  headingFont: (typeof fontIds)[number];
  monoFont: (typeof fontIds)[number];
  fontScale: number;
  lineHeight: number;
  contentWidth: number;
};
export type AppearanceWarningCode = 'CORRUPT_PREFERENCES' | 'UNSUPPORTED_VERSION' | 'STORAGE_READ_FAILED';
export type AppearanceErrorCode = 'INVALID_PREFERENCES' | 'STORAGE_WRITE_FAILED';
export type GetAppearanceResult = { status: 'ok'; preferences: AppearancePreferences; warning?: { code: AppearanceWarningCode; message: string } };
export type UpdateAppearanceResult = { status: 'updated'; preferences: AppearancePreferences } | { status: 'error'; error: { code: AppearanceErrorCode; message: string } };
export type AppearanceIpc = {
  getAppearancePreferences(): Promise<GetAppearanceResult>;
  updateAppearancePreferences(value: unknown): Promise<UpdateAppearanceResult>;
};

export const defaultAppearancePreferences: AppearancePreferences = {
  version: 1, themeMode: 'system', bodyFont: 'system-serif', headingFont: 'system-serif', monoFont: 'system-mono', fontScale: 1, lineHeight: 1.75, contentWidth: 72
};

export function parseAppearancePreferences(value: unknown): AppearancePreferences | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !themeModes.includes(v.themeMode as ThemeMode)) return null;
  if (![v.bodyFont, v.headingFont, v.monoFont].every((font) => fontIds.includes(font as never))) return null;
  const finite = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!finite(v.fontScale, .75, 2) || !finite(v.lineHeight, 1.2, 2.4) || !finite(v.contentWidth, 40, 100)) return null;
  return { version: 1, themeMode: v.themeMode as ThemeMode, bodyFont: v.bodyFont as AppearancePreferences['bodyFont'], headingFont: v.headingFont as AppearancePreferences['headingFont'], monoFont: v.monoFont as AppearancePreferences['monoFont'], fontScale: v.fontScale as number, lineHeight: v.lineHeight as number, contentWidth: v.contentWidth as number };
}
