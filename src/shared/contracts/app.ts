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
export const citationDisplayModeSchema = z.enum(['full', 'numbered', 'icon'])
export const onboardingStepSchema = z.enum([
  'welcome',
  'agent',
  'embedding',
  'rerank',
  'mineru',
  'project'
])
export const onboardingStateSchema = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal('pending'),
      step: onboardingStepSchema
    })
    .strict(),
  z.object({ schemaVersion: z.literal(1), status: z.literal('completed') }).strict()
])
export const setOnboardingStateInputSchema = z.object({ state: onboardingStateSchema }).strict()

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

export const setCitationDisplayModeInputSchema = z
  .object({ mode: citationDisplayModeSchema })
  .strict()
export type CitationDisplayMode = z.infer<typeof citationDisplayModeSchema>
export type SetCitationDisplayModeInput = z.infer<typeof setCitationDisplayModeInputSchema>
export type OnboardingStep = z.infer<typeof onboardingStepSchema>
export type OnboardingState = z.infer<typeof onboardingStateSchema>
export type SetOnboardingStateInput = z.infer<typeof setOnboardingStateInputSchema>

export const setDefaultAgentApprovalModeInputSchema = z
  .object({ mode: agentApprovalModeSchema })
  .strict()
export type SetDefaultAgentApprovalModeInput = z.infer<
  typeof setDefaultAgentApprovalModeInputSchema
>
