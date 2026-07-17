import { z } from 'zod'

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1)
})

export type AppInfo = z.infer<typeof appInfoSchema>

export const themePreferenceSchema = z.enum(['system', 'light', 'dark'])

export const setThemePreferenceInputSchema = z.object({
  preference: themePreferenceSchema
})

export type ThemePreference = z.infer<typeof themePreferenceSchema>
export type SetThemePreferenceInput = z.infer<typeof setThemePreferenceInputSchema>
