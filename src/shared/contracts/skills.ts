import { z } from 'zod'

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const SKILL_MAX_FILES = 32
export const SKILL_MAX_TOTAL_BYTES = 48 * 1024
export const SKILL_MAX_ENTRYPOINT_BYTES = 24 * 1024
export const SKILL_MAX_REFERENCE_BYTES = 8 * 1024
export const SKILL_MAX_PROGRESSIVE_REFERENCE_BYTES = 64 * 1024
export const SKILL_MAX_ACTIVE_SKILLS = 4
export const SKILL_MAX_DEPENDENCIES = 8
export const SKILL_MAX_RUN_REFERENCES = 12
export const SKILL_MAX_RUN_REFERENCE_BYTES = 32 * 1024

export const skillIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?$/)
export const skillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const skillCommitSchema = z.string().regex(/^[a-f0-9]{40}$/)
export const skillRepositorySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/)
export const skillDirectorySchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      value === '.' ||
      /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value),
    'Use a repository-relative directory'
  )
export const skillRelativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\).+\.(?:md|txt)$/i)

export const skillRunProvenanceSchema = strictObject({
  skillId: skillIdSchema,
  displayName: z.string().trim().min(1).max(200),
  name: skillNameSchema,
  commit: skillCommitSchema,
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/)
})
export const skillRoutingStatusSchema = z.enum([
  'legacy',
  'pending',
  'available',
  'not_needed',
  'selected',
  'degraded',
  'failed'
])
export const skillRunResourceSchema = strictObject({
  skillId: skillIdSchema,
  commit: skillCommitSchema,
  relativePath: skillRelativePathSchema,
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  byteSize: z.number().int().nonnegative().max(1_048_576).nullable()
})

const canonicalSkillRunSnapshotSchema = strictObject({
  schemaVersion: z.literal(2),
  mode: z.enum(['auto', 'explicit', 'none']),
  routingStatus: skillRoutingStatusSchema,
  skills: z.array(skillRunProvenanceSchema).max(SKILL_MAX_ACTIVE_SKILLS),
  dependencies: z.array(skillRunProvenanceSchema).max(SKILL_MAX_DEPENDENCIES),
  resources: z.array(skillRunResourceSchema).max(SKILL_MAX_RUN_REFERENCES),
  safeError: z.string().min(1).max(200).nullable()
})

const legacySkillRunProvenanceSchema = strictObject({
  skillId: skillIdSchema,
  name: skillNameSchema,
  commit: skillCommitSchema,
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/)
})

const legacySkillRunSnapshotSchema = strictObject({
  mode: z.enum(['auto', 'explicit', 'none']),
  routingStatus: skillRoutingStatusSchema,
  primary: legacySkillRunProvenanceSchema.nullable(),
  dependencies: z.array(legacySkillRunProvenanceSchema).max(SKILL_MAX_DEPENDENCIES),
  resources: z.array(skillRelativePathSchema).max(4),
  safeError: z.string().min(1).max(200).nullable()
})

export const skillRunSnapshotSchema = z.preprocess((value) => {
  const legacy = legacySkillRunSnapshotSchema.safeParse(value)
  if (!legacy.success) return value
  const primary = legacy.data.primary
  return {
    schemaVersion: 2,
    mode: legacy.data.mode,
    routingStatus: legacy.data.routingStatus,
    skills: primary === null ? [] : [{ ...primary, displayName: primary.name }],
    dependencies: legacy.data.dependencies.map((dependency) => ({
      ...dependency,
      displayName: dependency.name
    })),
    resources:
      primary === null
        ? []
        : legacy.data.resources.map((relativePath) => ({
            skillId: primary.skillId,
            commit: primary.commit,
            relativePath,
            sha256: null,
            byteSize: null
          })),
    safeError: legacy.data.safeError
  }
}, canonicalSkillRunSnapshotSchema)

export const skillManifestFileSchema = strictObject({
  path: skillRelativePathSchema,
  byteSize: z.number().int().nonnegative().max(1_048_576),
  gitBlobSha: z.string().regex(/^[a-f0-9]{40}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
})

export const skillIntegrityStatusSchema = z.enum(['ready', 'missing_files', 'integrity_failed'])
export const skillDisplayStatusSchema = z.enum([
  'ready',
  'disabled',
  'unavailable_missing_files',
  'unavailable_integrity_failed'
])
export const skillSourceKindSchema = z.enum(['curated', 'github'])

export const skillCatalogEntrySchema = strictObject({
  skillId: skillIdSchema,
  displayName: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1_024),
  repository: skillRepositorySchema,
  directory: skillDirectorySchema,
  commit: skillCommitSchema,
  license: z.string().trim().min(1).max(100),
  dependencies: z.array(skillIdSchema).max(8),
  installed: z.boolean(),
  updateAvailable: z.boolean()
})

export const installedSkillSchema = strictObject({
  skillId: skillIdSchema,
  displayName: z.string().trim().min(1).max(200),
  name: skillNameSchema,
  description: z.string().trim().min(1).max(1_024),
  source: skillSourceKindSchema,
  repository: skillRepositorySchema,
  directory: skillDirectorySchema,
  commit: skillCommitSchema,
  license: z.string().trim().min(1).max(100).nullable(),
  enabled: z.boolean(),
  disableModelInvocation: z.boolean(),
  integrityStatus: skillIntegrityStatusSchema,
  displayStatus: skillDisplayStatusSchema,
  dependencies: z.array(skillIdSchema).max(8),
  fileCount: z.number().int().positive().max(10_000),
  totalBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  installedAt: z.iso.datetime(),
  checkedAt: z.iso.datetime().nullable(),
  updateAvailable: z.boolean(),
  updateKind: z.literal('reviewed').nullable()
})

export const skillsSnapshotSchema = strictObject({
  available: z.array(skillCatalogEntrySchema).max(100),
  installed: z.array(installedSkillSchema).max(500),
  revision: z.number().int().nonnegative()
})

export const inspectGithubSkillInputSchema = strictObject({
  repository: skillRepositorySchema,
  directory: skillDirectorySchema,
  operationId: z.uuid()
})
export const inspectGithubSkillResultSchema = strictObject({
  inspectionId: z.uuid(),
  repository: skillRepositorySchema,
  directory: skillDirectorySchema,
  commit: skillCommitSchema,
  name: skillNameSchema,
  description: z.string().trim().min(1).max(1_024),
  disableModelInvocation: z.boolean(),
  license: z.string().trim().min(1).max(100).nullable(),
  licenseStatus: z.enum(['declared', 'not_detected']),
  fileCount: z.number().int().min(1).max(SKILL_MAX_FILES),
  totalBytes: z.number().int().min(1).max(SKILL_MAX_TOTAL_BYTES),
  files: z.array(skillRelativePathSchema).min(1).max(SKILL_MAX_FILES)
})

export const installSkillInputSchema = z.discriminatedUnion('source', [
  strictObject({ source: z.literal('curated'), skillId: skillIdSchema, operationId: z.uuid() }),
  strictObject({ source: z.literal('github'), inspectionId: z.uuid(), operationId: z.uuid() })
])
export const skillMutationResultSchema = strictObject({ snapshot: skillsSnapshotSchema })
export const setSkillEnabledInputSchema = strictObject({
  skillId: skillIdSchema,
  enabled: z.boolean(),
  cascade: z.boolean().default(false)
})
export const skillIdInputSchema = strictObject({ skillId: skillIdSchema, operationId: z.uuid() })
export const updateSkillInputSchema = strictObject({
  skillId: skillIdSchema,
  confirmUnreviewed: z.boolean().default(false),
  operationId: z.uuid()
})
export const uninstallSkillInputSchema = strictObject({
  skillId: skillIdSchema,
  cascade: z.boolean().default(false)
})
export const cancelSkillOperationInputSchema = strictObject({ operationId: z.uuid() })
export const skillUpdateResultSchema = strictObject({
  skillId: skillIdSchema,
  available: z.boolean(),
  kind: z.enum(['reviewed', 'unreviewed']).nullable(),
  currentCommit: skillCommitSchema,
  nextCommit: skillCommitSchema.nullable()
})
export const skillChangeEventSchema = strictObject({
  revision: z.number().int().nonnegative()
})

export type SkillRunSnapshot = z.infer<typeof skillRunSnapshotSchema>
export type SkillRunResource = z.infer<typeof skillRunResourceSchema>
export type SkillManifestFile = z.infer<typeof skillManifestFileSchema>
export type InstalledSkill = z.infer<typeof installedSkillSchema>
export type SkillsSnapshot = z.infer<typeof skillsSnapshotSchema>
export type InspectGithubSkillInput = z.infer<typeof inspectGithubSkillInputSchema>
export type InspectGithubSkillResult = z.infer<typeof inspectGithubSkillResultSchema>
export type InstallSkillInput = z.infer<typeof installSkillInputSchema>
export type SetSkillEnabledInput = z.infer<typeof setSkillEnabledInputSchema>
export type UpdateSkillInput = z.infer<typeof updateSkillInputSchema>
export type UninstallSkillInput = z.infer<typeof uninstallSkillInputSchema>
export type SkillUpdateResult = z.infer<typeof skillUpdateResultSchema>
