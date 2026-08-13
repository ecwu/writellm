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
    name: projectNameSchema,
    templateId: z.uuid().optional()
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

export const projectRecoveryContextSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('open'),
      reason: z.enum(['lock-contended', 'open-failed'])
    })
    .strict(),
  z.object({ kind: z.literal('create') }).strict(),
  z.object({ kind: z.literal('close') }).strict()
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
    activeProject: activeProjectSchema.nullable(),
    recovery: projectRecoveryContextSchema.optional()
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
    if (snapshot.recovery !== undefined && snapshot.state !== 'recovery-required') {
      context.addIssue({
        code: 'custom',
        message: `${snapshot.state} state cannot expose recovery context`
      })
    }
  })

export const projectRecoveryActionInputSchema = z.object({}).strict()
export const projectSnapshotSessionInputSchema = projectSessionInputSchema
export const projectSnapshotResultSchema = z.object({ created: z.boolean() }).strict()
export const projectCloneInputSchema = projectSessionInputSchema
export const projectCloneCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export const versionHistoryStateSchema = z.enum(['uninitialized', 'ready', 'damaged'])
export const checkpointOidSchema = z.string().regex(/^[a-f0-9]{40}$/)
export const checkpointNameSchema = z.string().trim().min(1).max(100)
export const checkpointNoteSchema = z.string().trim().max(2_000)

export const checkpointEntrySchema = z
  .object({
    oid: checkpointOidSchema,
    name: checkpointNameSchema,
    note: checkpointNoteSchema.optional(),
    createdAt: z.iso.datetime(),
    parentOid: checkpointOidSchema.nullable(),
    stateSha256: z.string().regex(/^[a-f0-9]{64}$/),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative()
  })
  .strict()

export const versionHistoryStatusSchema = z
  .object({
    state: versionHistoryStateSchema,
    promptDismissed: z.boolean()
  })
  .strict()

export const enableVersionHistoryInputSchema = projectSessionInputSchema
export const dismissVersionHistoryPromptInputSchema = projectSessionInputSchema
export const createCheckpointInputSchema = projectSessionInputSchema
  .extend({
    name: checkpointNameSchema,
    note: checkpointNoteSchema.optional()
  })
  .strict()
export const listCheckpointsInputSchema = projectSessionInputSchema
  .extend({
    cursor: checkpointOidSchema.optional(),
    limit: z.number().int().min(1).max(50).default(50)
  })
  .strict()
export const listCheckpointsResultSchema = z
  .object({
    checkpoints: z.array(checkpointEntrySchema).max(50),
    nextCursor: checkpointOidSchema.nullable()
  })
  .strict()
export const compareCheckpointStateInputSchema = projectSessionInputSchema
export const compareCheckpointStateResultSchema = z
  .object({
    status: z.enum(['up-to-date', 'uncheckpointed-changes']),
    headOid: checkpointOidSchema
  })
  .strict()
export const restoreCheckpointInputSchema = projectSessionInputSchema
  .extend({ oid: checkpointOidSchema })
  .strict()
export const reinitializeVersionHistoryInputSchema = projectSessionInputSchema
export const checkpointOperationResultSchema = z
  .object({ checkpoint: checkpointEntrySchema })
  .strict()
export const restoreCheckpointResultSchema = z
  .object({
    checkpoint: checkpointEntrySchema,
    project: activeProjectSchema
  })
  .strict()

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
export type ProjectRecoveryContext = z.infer<typeof projectRecoveryContextSchema>
export type ActiveProject = z.infer<typeof activeProjectSchema>
export type ProjectSelectionResult = z.infer<typeof projectSelectionResultSchema>
export type RecentProject = z.infer<typeof recentProjectSchema>
export type RecentProjects = z.infer<typeof recentProjectsSchema>
export type RecentProjectOpenInput = z.infer<typeof recentProjectOpenInputSchema>
export type ProjectSessionInput = z.infer<typeof projectSessionInputSchema>
export type ProjectLifecycleSnapshot = z.infer<typeof projectLifecycleSnapshotSchema>
export type ProjectLifecycleEvent = z.infer<typeof projectLifecycleEventSchema>
export type VersionHistoryState = z.infer<typeof versionHistoryStateSchema>
export type VersionHistoryStatus = z.infer<typeof versionHistoryStatusSchema>
export type CheckpointEntry = z.infer<typeof checkpointEntrySchema>
export type CreateCheckpointInput = z.infer<typeof createCheckpointInputSchema>
export type ListCheckpointsInput = z.infer<typeof listCheckpointsInputSchema>
