/**
 * Stable Renderer query keys. Project-owned keys always include the active session capability.
 * Keeping the session in every key prevents a closed project from sharing cached data with the
 * next project opened in the same window.
 */
export const rendererQueryKeys = {
  settings: {
    appInfo: ['settings', 'app-info'] as const,
    providers: ['provider-settings'] as const,
    approvalMode: ['settings', 'default-agent-approval-mode'] as const,
    skills: ['settings', 'writing-skills'] as const,
    publicationPresets: ['settings', 'publication-presets'] as const
  },
  projectVersionHistory: {
    status: (projectSessionId: string) =>
      ['project-version-history-status', projectSessionId] as const,
    checkpoints: (projectSessionId: string) =>
      ['project-version-history-checkpoints', projectSessionId] as const,
    comparison: (projectSessionId: string) =>
      ['project-version-history-comparison', projectSessionId] as const
  }
} as const
