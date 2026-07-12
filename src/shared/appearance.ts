export const appearanceChannels = {
  get: 'writellm:appearance:get',
  update: 'writellm:appearance:update',
} as const;

export const themeModes = ['system', 'light', 'dark'] as const;
export const typographyPresetIds = ['editor', 'reading', 'compact'] as const;
export const bodyFontIds = ['system-serif', 'system-sans'] as const;
export const monoFontIds = ['system-mono'] as const;
export type ThemeMode = (typeof themeModes)[number];
export type TypographyPresetId = (typeof typographyPresetIds)[number];
export type BodyFontId = (typeof bodyFontIds)[number];
export type MonoFontId = (typeof monoFontIds)[number];

export type AppearancePreferences = {
  schemaVersion: 1;
  themeMode: ThemeMode;
  editorTypographyPreset: TypographyPresetId;
  bodyFontId: BodyFontId;
  headingFontId: BodyFontId;
  monoFontId: MonoFontId;
  baseSize: number;
  leading: number;
  flow: number;
};
export type AppearancePreferenceInput = Omit<AppearancePreferences, 'schemaVersion'>;
export type AppearanceWarningCode =
  | 'APPEARANCE_PREFERENCES_CORRUPT'
  | 'APPEARANCE_PREFERENCES_UNSUPPORTED';
export type AppearanceErrorCode = 'APPEARANCE_INVALID_INPUT' | 'APPEARANCE_STORAGE_UNAVAILABLE';
export type GetAppearanceResult = {
  status: 'ok';
  preferences: AppearancePreferences;
  warning?: { code: AppearanceWarningCode; message: string };
};
export type UpdateAppearanceResult =
  | { status: 'updated'; preferences: AppearancePreferences }
  | { status: 'error'; error: { code: AppearanceErrorCode; message: string } };
export type AppearanceIpc = {
  getAppearancePreferences(): Promise<GetAppearanceResult>;
  updateAppearancePreferences(value: AppearancePreferenceInput): Promise<UpdateAppearanceResult>;
};

export const defaultAppearancePreferences: AppearancePreferences = {
  schemaVersion: 1,
  themeMode: 'system',
  editorTypographyPreset: 'editor',
  bodyFontId: 'system-serif',
  headingFontId: 'system-serif',
  monoFontId: 'system-mono',
  baseSize: 16,
  leading: 1.75,
  flow: 1.25,
};

export function parseAppearancePreferences(value: unknown): AppearancePreferences | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const keys = [
    'schemaVersion',
    'themeMode',
    'editorTypographyPreset',
    'bodyFontId',
    'headingFontId',
    'monoFontId',
    'baseSize',
    'leading',
    'flow',
  ];
  if (Object.keys(v).length !== keys.length || !keys.every((key) => key in v)) return null;
  const finite = (n: unknown, min: number, max: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (
    v.schemaVersion !== 1 ||
    !themeModes.includes(v.themeMode as ThemeMode) ||
    !typographyPresetIds.includes(v.editorTypographyPreset as TypographyPresetId)
  )
    return null;
  if (
    !bodyFontIds.includes(v.bodyFontId as BodyFontId) ||
    !bodyFontIds.includes(v.headingFontId as BodyFontId) ||
    !monoFontIds.includes(v.monoFontId as MonoFontId)
  )
    return null;
  if (!finite(v.baseSize, 12, 32) || !finite(v.leading, 1.2, 2.4) || !finite(v.flow, 0.75, 3))
    return null;
  return v as AppearancePreferences;
}

export function parseAppearanceInput(value: unknown): AppearancePreferences | null {
  if (!value || typeof value !== 'object' || 'schemaVersion' in value) return null;
  return parseAppearancePreferences({ schemaVersion: 1, ...(value as object) });
}
