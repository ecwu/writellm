import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultAppearancePreferences,
  type GetAppearanceResult,
  parseAppearanceInput,
  parseAppearancePreferences,
  type UpdateAppearanceResult,
} from '../../shared/appearance.js';

export class AppearancePreferencesRepository {
  readonly filePath: string;
  private current = defaultAppearancePreferences;
  private warning: GetAppearanceResult['warning'];
  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'appearance-preferences.json');
  }

  async initialize(): Promise<GetAppearanceResult> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      const parsed = parseAppearancePreferences(raw);
      if (!parsed) {
        const unsupported =
          typeof raw === 'object' &&
          raw !== null &&
          (('schemaVersion' in raw && (raw as { schemaVersion?: unknown }).schemaVersion !== 1) ||
            'version' in raw);
        this.warning = {
          code: unsupported
            ? 'APPEARANCE_PREFERENCES_UNSUPPORTED'
            : 'APPEARANCE_PREFERENCES_CORRUPT',
          message: 'Appearance preferences could not be loaded; safe defaults are in use.',
        };
      } else this.current = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.warning = {
          code: 'APPEARANCE_PREFERENCES_CORRUPT',
          message: 'Appearance preferences could not be loaded; safe defaults are in use.',
        };
    }
    return this.get();
  }
  get(): GetAppearanceResult {
    return {
      status: 'ok',
      preferences: { ...this.current },
      ...(this.warning ? { warning: this.warning } : {}),
    };
  }
  async update(value: unknown): Promise<UpdateAppearanceResult> {
    const parsed = parseAppearanceInput(value);
    if (!parsed)
      return {
        status: 'error',
        error: { code: 'APPEARANCE_INVALID_INPUT', message: 'Appearance preferences are invalid.' },
      };
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.filePath);
      this.current = parsed;
      this.warning = undefined;
      return { status: 'updated', preferences: { ...parsed } };
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      return {
        status: 'error',
        error: {
          code: 'APPEARANCE_STORAGE_UNAVAILABLE',
          message: 'Appearance preferences could not be saved.',
        },
      };
    }
  }
}
