import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { AccentPreference, ThemePreference } from '../../shared/contracts/app'

export type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  preference: ThemePreference
  accent: AccentPreference
  resolvedTheme: ResolvedTheme
  setPreference(preference: ThemePreference): Promise<void>
  setAccent(preference: AccentPreference): Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function reportThemeError(event: string, error: unknown): void {
  const original = error instanceof Error ? error : new Error(String(error))
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.error',
    message: `${event}: ${original.message || 'Theme operation failed'}`,
    stack: original.stack
  })
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [accent, setAccentState] = useState<AccentPreference>('neutral')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    let current = true
    void window.desktop.app
      .getThemePreference()
      .then((storedPreference) => {
        if (current) setPreferenceState(storedPreference)
      })
      .catch((error) => {
        reportThemeError('renderer.theme_preference_load_failed', error)
      })
    void window.desktop.app
      .getAccentPreference()
      .then((storedPreference) => {
        if (current) setAccentState(storedPreference)
      })
      .catch((error) => {
        reportThemeError('renderer.accent_preference_load_failed', error)
      })

    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    if (preference !== 'system') {
      setResolvedTheme(preference)
      return
    }

    if (typeof window.matchMedia !== 'function') {
      setResolvedTheme('light')
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setResolvedTheme(mediaQuery.matches ? 'dark' : 'light')
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [preference])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.dataset.accent = accent
  }, [accent])

  const setPreference = useCallback(async (nextPreference: ThemePreference): Promise<void> => {
    try {
      const persistedPreference = await window.desktop.app.setThemePreference({
        preference: nextPreference
      })
      setPreferenceState(persistedPreference)
    } catch (error) {
      reportThemeError('renderer.theme_preference_save_failed', error)
      throw error
    }
  }, [])

  const setAccent = useCallback(async (nextPreference: AccentPreference): Promise<void> => {
    try {
      const persistedPreference = await window.desktop.app.setAccentPreference({
        preference: nextPreference
      })
      setAccentState(persistedPreference)
    } catch (error) {
      reportThemeError('renderer.accent_preference_save_failed', error)
      throw error
    }
  }, [])

  const value = useMemo(
    () => ({ preference, accent, resolvedTheme, setPreference, setAccent }),
    [preference, accent, resolvedTheme, setPreference, setAccent]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === null) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
