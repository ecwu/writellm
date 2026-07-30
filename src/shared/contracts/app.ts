import { z } from 'zod'
import { agentApprovalModeSchema } from './agent'

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1)
})

export type AppInfo = z.infer<typeof appInfoSchema>

export const themePreferenceSchema = z.enum(['system', 'light', 'dark'])
export const accentPreferenceSchema = z.enum([
  'neutral',
  'blue',
  'green',
  'violet',
  'rose',
  'orange'
])

export const setThemePreferenceInputSchema = z.object({
  preference: themePreferenceSchema
})

export type ThemePreference = z.infer<typeof themePreferenceSchema>
export type SetThemePreferenceInput = z.infer<typeof setThemePreferenceInputSchema>

export const setAccentPreferenceInputSchema = z
  .object({ preference: accentPreferenceSchema })
  .strict()
export type AccentPreference = z.infer<typeof accentPreferenceSchema>
export type SetAccentPreferenceInput = z.infer<typeof setAccentPreferenceInputSchema>

export const setDefaultAgentApprovalModeInputSchema = z
  .object({ mode: agentApprovalModeSchema })
  .strict()
export type SetDefaultAgentApprovalModeInput = z.infer<
  typeof setDefaultAgentApprovalModeInputSchema
>
