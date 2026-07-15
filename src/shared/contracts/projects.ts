import { z } from 'zod'

export const projectIdSchema = z.uuid()
export const projectSessionIdSchema = z.uuid()

const windowsReservedProjectNames = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const invalidProjectNameCharacters = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|'])

function hasInvalidProjectNameCharacter(name: string): boolean {
  return Array.from(name).some(
    (character) => invalidProjectNameCharacters.has(character) || character.charCodeAt(0) <= 31
  )
}

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a project name')
  .max(200, 'Project name must be 200 characters or fewer')
  .refine((name) => name !== '.' && name !== '..', 'Enter a valid project name')
  .refine(
    (name) => !hasInvalidProjectNameCharacter(name),
    'Project name contains invalid characters'
  )
  .refine((name) => !/[. ]$/.test(name), 'Project name cannot end with a period or space')
  .refine((name) => !windowsReservedProjectNames.test(name), 'Enter a valid project name')
  .refine(
    (name) => new TextEncoder().encode(`${name}.writellm`).byteLength <= 255,
    'Project name is too long for the filesystem'
  )

export const projectCreateInputSchema = z
  .object({
    name: projectNameSchema
  })
  .strict()

export const projectLifecycleStateSchema = z.enum([
  'closed',
  'creating',
  'opening',
  'open',
  'closing',
  'recovery-required'
])

export const activeProjectSchema = z
  .object({
    projectId: projectIdSchema,
    projectSessionId: projectSessionIdSchema,
    displayName: z.string().trim().min(1).max(255),
    indexRebuildRequired: z.boolean()
  })
  .strict()

export const projectSelectionResultSchema = z
  .object({
    project: activeProjectSchema.nullable()
  })
  .strict()

export const recentProjectSchema = z
  .object({
    projectId: projectIdSchema,
    displayName: z.string().trim().min(1).max(255),
    projectPath: z.string().trim().min(1).max(4_096),
    lastOpenedAt: z.string().trim().min(1).max(64)
  })
  .strict()

export const recentProjectsSchema = z.array(recentProjectSchema).max(5)

export const recentProjectOpenInputSchema = z
  .object({
    projectId: projectIdSchema
  })
  .strict()

export const projectSessionInputSchema = z
  .object({
    projectSessionId: projectSessionIdSchema
  })
  .strict()

export const projectLifecycleSnapshotSchema = z
  .object({
    state: projectLifecycleStateSchema,
    activeProject: activeProjectSchema.nullable()
  })
  .strict()
  .superRefine((snapshot, context) => {
    const mustHaveActiveProject = snapshot.state === 'open' || snapshot.state === 'closing'
    if (mustHaveActiveProject !== (snapshot.activeProject !== null)) {
      context.addIssue({
        code: 'custom',
        message: `${snapshot.state} state has an invalid active project`
      })
    }
  })

export const projectLifecycleEventSchema = z
  .object({
    projectSessionId: projectSessionIdSchema,
    snapshot: projectLifecycleSnapshotSchema
  })
  .strict()
  .superRefine((event, context) => {
    if (event.snapshot.activeProject?.projectSessionId !== event.projectSessionId) {
      context.addIssue({
        code: 'custom',
        message: 'Lifecycle event does not belong to its project session'
      })
    }
  })

export type ProjectId = z.infer<typeof projectIdSchema>
export type ProjectSessionId = z.infer<typeof projectSessionIdSchema>
export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>
export type ProjectLifecycleState = z.infer<typeof projectLifecycleStateSchema>
export type ActiveProject = z.infer<typeof activeProjectSchema>
export type ProjectSelectionResult = z.infer<typeof projectSelectionResultSchema>
export type RecentProject = z.infer<typeof recentProjectSchema>
export type RecentProjects = z.infer<typeof recentProjectsSchema>
export type RecentProjectOpenInput = z.infer<typeof recentProjectOpenInputSchema>
export type ProjectSessionInput = z.infer<typeof projectSessionInputSchema>
export type ProjectLifecycleSnapshot = z.infer<typeof projectLifecycleSnapshotSchema>
export type ProjectLifecycleEvent = z.infer<typeof projectLifecycleEventSchema>
