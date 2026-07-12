import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { AppearancePreferenceInput, AppearancePreferences } from '../../shared/appearance';
import {
  completedUpdate,
  effectiveTheme,
  initialAppearanceState,
  loadedAppearance,
} from './appearanceState';

type Value = {
  preferences: AppearancePreferences;
  pending: boolean;
  message?: string;
  update: (v: AppearancePreferences) => Promise<void>;
};
const Context = createContext<Value | null>(null);
const fontVariables = {
  'system-serif': 'var(--font-system-serif)',
  'system-sans': 'var(--font-system-sans)',
} as const;
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialAppearanceState);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    let active = true;
    void window.writellmAppearance
      .getAppearancePreferences()
      .then((r) => active && setState(loadedAppearance(r)));
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => {
      active = false;
      media.removeEventListener('change', change);
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const p = state.preferences;
    root.dataset.theme = effectiveTheme(p.themeMode, systemDark);
    root.dataset.typesetPreset = p.editorTypographyPreset;
    root.style.setProperty('--typeset-font-body', fontVariables[p.bodyFontId]);
    root.style.setProperty('--typeset-font-heading', fontVariables[p.headingFontId]);
    root.style.setProperty('--typeset-font-mono', 'var(--font-system-mono)');
    root.style.setProperty('--typeset-size', `${p.baseSize}px`);
    root.style.setProperty('--typeset-leading', String(p.leading));
    root.style.setProperty('--typeset-flow', `${p.flow}em`);
  }, [state.preferences, systemDark]);
  const value = useMemo<Value>(
    () => ({
      ...state,
      update: async (p) => {
        const previous = state;
        setState({ ...state, preferences: p, pending: true, message: undefined });
        const { schemaVersion: _, ...input } = p;
        const r = await window.writellmAppearance.updateAppearancePreferences(
          input as AppearancePreferenceInput,
        );
        setState(completedUpdate(previous, r));
      },
    }),
    [state],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAppearance() {
  const value = useContext(Context);
  if (!value) throw new Error('AppearanceProvider is missing.');
  return value;
}
