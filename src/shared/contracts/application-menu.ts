import { z } from 'zod'

export const layoutTools = {
  outline: 'Outline',
  agent: 'Agent',
  find: 'Find',
  references: 'References',
  writing_rules: 'Writing rules',
  comments: 'Comments'
} as const
export const layoutPages = {
  knowledge: 'Knowledge',
  preview: 'Preview',
  assets: 'Assets',
  checks: 'Checks'
} as const
export const menuActions = {
  onCreate: { label: 'New project', accelerator: 'Command+N' },
  onOpen: { label: 'Open project', accelerator: 'Command+O' },
  onSave: { label: 'Save', accelerator: 'Command+S' },
  onClone: { label: 'Save As independent copy…' },
  onSaveTemplate: { label: 'Save as reusable template…' },
  onExportNative: { label: 'Export native manuscript…' },
  onExportMarkdown: { label: 'Export Markdown manuscript…' },
  onExportPandoc: { label: 'Export Pandoc citation package…' },
  onExportDocx: { label: 'Export Word manuscript…' },
  onExportLatex: { label: 'Export LaTeX manuscript…' },
  onExportPdf: { label: 'Export PDF manuscript…' },
  onCreateSnapshot: { label: 'Create snapshot' },
  onRestoreSnapshot: { label: 'Restore snapshot' },
  onEnableVersionHistory: { label: 'Enable version history…' },
  onCreateCheckpoint: { label: 'Create checkpoint…' },
  onOpenVersionHistory: { label: 'Version history…' },
  onClose: { label: 'Close project and return to chooser' },
  onQuit: { label: 'Quit WriteLLM', accelerator: 'Command+Q' },
  onOpenSettings: { label: 'Settings', accelerator: 'Command+,' },
  onOpenLogs: { label: 'Open logs folder' },
  onOpenFind: { label: 'Find in manuscript', accelerator: 'Command+F' },
  newNotebook: { label: 'New Notebook' },
  resetLayout: { label: 'Reset layout' }
} as const
export type MenuAction = keyof typeof menuActions
export const menuCommandSchema = z.union([
  z
    .object({
      kind: z.literal('action'),
      action: z.enum(Object.keys(menuActions) as [MenuAction, ...MenuAction[]])
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool'),
      tool: z.enum(['outline', 'agent', 'find', 'references', 'writing_rules', 'comments'])
    })
    .strict(),
  z
    .object({ kind: z.literal('page'), page: z.enum(['knowledge', 'preview', 'assets', 'checks']) })
    .strict()
])
export type MenuCommand = z.infer<typeof menuCommandSchema>
export const menuStateSchema = z
  .object({
    projectSessionId: z.string().uuid().nullable(),
    ready: z.boolean(),
    busy: z.boolean(),
    modal: z.boolean(),
    projectSelectionDisabled: z.boolean(),
    hasProject: z.boolean(),
    canRestoreSnapshot: z.boolean(),
    versionHistoryState: z.enum(['uninitialized', 'ready', 'damaged']).nullable(),
    layout: z
      .object({
        tools: z
          .array(z.enum(['outline', 'agent', 'find', 'references', 'writing_rules', 'comments']))
          .max(6),
        pages: z.array(z.enum(['knowledge', 'preview', 'assets', 'checks'])).max(4),
        canCreateNotebook: z.boolean()
      })
      .strict()
      .nullable()
  })
  .strict()
export type MenuState = z.infer<typeof menuStateSchema>
export const menuCommandEventSchema = z
  .object({
    command: menuCommandSchema,
    projectSessionId: z.string().uuid().nullable(),
    operationId: z.string().uuid()
  })
  .strict()
export type MenuCommandEvent = z.infer<typeof menuCommandEventSchema>
export const menuUpdateResultSchema = z.object({ accepted: z.boolean() }).strict()
export interface ApplicationMenuApi {
  readonly native: boolean
  update(state: MenuState): Promise<{ accepted: boolean }>
  subscribe(listener: (event: MenuCommandEvent) => void): () => void
}
export function menuCommandId(command: MenuCommand): string {
  return command.kind === 'action'
    ? command.action
    : command.kind === 'tool'
      ? `tool:${command.tool}`
      : `page:${command.page}`
}
export function menuActionVisible(action: MenuAction, state: MenuState): boolean {
  if (action === 'onEnableVersionHistory') return state.versionHistoryState === 'uninitialized'
  if (action === 'onCreateCheckpoint') return state.versionHistoryState === 'ready'
  if (action === 'onOpenVersionHistory')
    return state.versionHistoryState === 'ready' || state.versionHistoryState === 'damaged'
  return true
}
export function menuCommandEnabled(command: MenuCommand, state: MenuState): boolean {
  if (!state.ready || state.modal) return false
  if (command.kind !== 'action') return !state.busy && state.hasProject && state.layout !== null
  const { action } = command
  if (!menuActionVisible(action, state)) return false
  if (action === 'onOpenSettings' || action === 'onOpenLogs') return true
  if (state.busy) return false
  if (action === 'onQuit') return true
  if (action === 'onCreate' || action === 'onOpen') return !state.projectSelectionDisabled
  if (action === 'onRestoreSnapshot') return state.canRestoreSnapshot
  if (action === 'newNotebook') return state.hasProject && !!state.layout?.canCreateNotebook
  if (action === 'resetLayout') return state.hasProject && state.layout !== null
  return state.hasProject
}
