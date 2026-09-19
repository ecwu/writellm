import { z } from 'zod'
import { projectSessionInputSchema } from './projects'

export const workbenchToolSchema = z.enum([
  'outline',
  'agent',
  'find',
  'references',
  'writing_rules',
  'comments'
])
export type WorkbenchTool = z.infer<typeof workbenchToolSchema>
export const workbenchContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('section'), sectionId: z.uuid() }).strict(),
  z.object({ kind: z.enum(['knowledge', 'preview', 'assets', 'checks']) }).strict()
])
export type WorkbenchContent = z.infer<typeof workbenchContentSchema>
const toolPanelId = z.union([workbenchToolSchema, z.literal('content')])
export type WorkbenchGridNode =
  | {
      type: 'leaf'
      size?: number
      data: { id: string; views: string[]; activeView?: string }
    }
  | { type: 'branch'; size?: number; data: WorkbenchGridNode[] }
const size = z.number().finite().min(0).max(100_000)
function gridNode(depth: number): z.ZodType<WorkbenchGridNode> {
  const leaf = z
    .object({
      type: z.literal('leaf'),
      size: size.optional(),
      data: z
        .object({
          id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
          views: z.array(toolPanelId).min(1).max(7),
          activeView: toolPanelId.optional()
        })
        .strict()
    })
    .strict()
  if (depth === 0) return leaf
  return z.union([
    leaf,
    z
      .object({
        type: z.literal('branch'),
        size: size.optional(),
        data: z
          .array(gridNode(depth - 1))
          .min(1)
          .max(7)
      })
      .strict()
  ])
}
export const workbenchGridSchema = z
  .object({
    root: gridNode(8),
    width: size,
    height: size,
    orientation: z.enum(['HORIZONTAL', 'VERTICAL'])
  })
  .strict()
  .superRefine((grid, ctx) => {
    const ids = new Set<string>()
    const groups = new Set<string>()
    const visit = (node: WorkbenchGridNode): void => {
      if (node.type === 'branch') {
        node.data.forEach(visit)
        return
      }
      const data = node.data
      if (
        groups.has(data.id) ||
        (data.activeView && !data.views.includes(data.activeView)) ||
        (data.views.includes('content') && data.views.length !== 1)
      )
        ctx.addIssue({ code: 'custom', message: 'Invalid workbench group' })
      groups.add(data.id)
      for (const id of data.views) {
        if (ids.has(id)) ctx.addIssue({ code: 'custom', message: 'Duplicate tool' })
        ids.add(id)
      }
    }
    visit(grid.root)
    if (!ids.has('content')) ctx.addIssue({ code: 'custom', message: 'Content group is required' })
  })
export const workbenchLayoutSchema = z
  .object({
    version: z.literal(1),
    tabs: z.array(workbenchContentSchema).max(500),
    activeTabId: z.string().max(100).nullable(),
    tools: workbenchGridSchema.nullable()
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.tabs.map(contentTabId)
    if (
      new Set(ids).size !== ids.length ||
      (value.activeTabId !== null && !ids.includes(value.activeTabId))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid content tabs' })
  })
export type WorkbenchLayout = z.infer<typeof workbenchLayoutSchema>
export function contentTabId(tab: WorkbenchContent): string {
  return tab.kind === 'section' ? `section:${tab.sectionId}` : tab.kind
}
export const workbenchLayoutSaveSchema = projectSessionInputSchema
  .extend({ layout: workbenchLayoutSchema, closingToken: z.uuid().optional() })
  .strict()
export interface WorkbenchApi {
  read(input: { projectSessionId: string }): Promise<WorkbenchLayout | null>
  save(input: {
    projectSessionId: string
    layout: WorkbenchLayout
    closingToken?: string
  }): Promise<void>
  reset(input: { projectSessionId: string }): Promise<void>
}
