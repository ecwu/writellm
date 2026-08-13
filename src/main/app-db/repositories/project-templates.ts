import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from 'pino'
import {
  MAX_USER_PROJECT_TEMPLATES,
  projectTemplateCatalogSchema,
  projectTemplateSchema,
  type ProjectTemplate,
  type ProjectTemplateSummary
} from '../../../shared/contracts/project-templates'
import { writeAtomicFile } from '../../storage/atomic-file'
import type { AppDatabase } from '../connection'
import builtInTemplateResource from '../../project/built-in-project-templates.json'

interface TemplateRow {
  template_id: string
  name: string
  description: string
  schema_version: number
  relative_path: string
  sha256: string
  section_count: number
  writing_rule_count: number
  has_publication_preset: number
  created_at: string
  updated_at: string
}

export class ProjectTemplateRepository {
  readonly #builtIns: ProjectTemplate[]

  constructor(
    private readonly database: AppDatabase,
    private readonly root: string,
    private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>,
    options: { builtIns?: unknown; now?: () => Date; createId?: () => string } = {}
  ) {
    this.#builtIns = projectTemplateSchema
      .array()
      .max(10)
      .parse(options.builtIns ?? builtInTemplateResource)
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  private readonly now: () => Date
  private readonly createId: () => string

  async list(): Promise<ProjectTemplateSummary[]> {
    const summaries = this.#builtIns.map((template) => summary(template, 'application', 'ready'))
    const rows = this.rows()
    let integrityFailedCount = 0
    for (const row of rows) {
      try {
        const template = await this.#readUser(row)
        summaries.push(summary(template, 'user', 'ready'))
      } catch (err) {
        integrityFailedCount += 1
        this.log.warn(
          {
            event: 'app.project_templates.integrity_failed',
            err,
            templateId: row.template_id,
            recovery: 'marked_integrity_failed'
          },
          'User project template integrity validation failed; catalog entry marked as failed'
        )
        summaries.push({
          templateId: row.template_id,
          name: row.name,
          description: row.description,
          origin: 'user',
          integrity: 'integrity_failed',
          sectionCount: row.section_count,
          writingRuleCount: row.writing_rule_count,
          hasPublicationPreset: row.has_publication_preset === 1
        })
      }
    }
    this.log.info(
      {
        event: 'app.project_templates.catalog_loaded',
        builtInCount: this.#builtIns.length,
        userCount: rows.length,
        integrityFailedCount
      },
      'Project template catalog loaded'
    )
    return projectTemplateCatalogSchema.parse(summaries)
  }

  async resolve(templateId: string): Promise<ProjectTemplate> {
    const builtIn = this.#builtIns.find((template) => template.templateId === templateId)
    if (builtIn !== undefined) return builtIn
    const row = this.rows().find((candidate) => candidate.template_id === templateId)
    if (row === undefined) throw new Error('Project template is unavailable')
    return this.#readUser(row)
  }

  async create(template: ProjectTemplate): Promise<ProjectTemplateSummary[]> {
    const parsed = projectTemplateSchema.parse(template)
    const userCount = this.rows().length
    if (userCount >= MAX_USER_PROJECT_TEMPLATES) throw new Error('Project template limit reached')
    if (this.#builtIns.some((item) => item.name.toLowerCase() === parsed.name.toLowerCase())) {
      throw new Error('Project template name already exists')
    }
    const bytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    const relativePath = `${parsed.templateId}.json`
    const destination = join(this.root, relativePath)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await writeAtomicFile(destination, bytes)
    const timestamp = this.now().toISOString()
    try {
      this.database.immediate((database) =>
        database
          .prepare(
            `INSERT INTO project_templates (
               template_id, name, description, schema_version, relative_path, sha256,
               section_count, writing_rule_count, has_publication_preset, created_at, updated_at
             ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            parsed.templateId,
            parsed.name,
            parsed.description,
            relativePath,
            sha256(bytes),
            parsed.outline.length,
            parsed.writingRules.length,
            parsed.publicationPresetId === null ? 0 : 1,
            timestamp,
            timestamp
          )
      )
    } catch (err) {
      await rm(destination, { force: true })
      this.log.error(
        { event: 'app.project_templates.create_failed', err, templateId: parsed.templateId },
        'User project template creation failed'
      )
      throw err
    }
    this.log.info(
      { event: 'app.project_templates.created', templateId: parsed.templateId },
      'User project template created'
    )
    return this.list()
  }

  async delete(templateId: string): Promise<ProjectTemplateSummary[]> {
    const row = this.rows().find((candidate) => candidate.template_id === templateId)
    if (row === undefined) throw new Error('User project template does not exist')
    this.database.immediate((database) =>
      database.prepare('DELETE FROM project_templates WHERE template_id = ?').run(templateId)
    )
    await rm(join(this.root, safeRelativePath(row.relative_path)), { force: true }).catch((err) => {
      this.log.warn(
        {
          event: 'app.project_templates.file_cleanup_failed',
          err,
          templateId,
          recovery: 'catalog_entry_deleted'
        },
        'Deleted template file cleanup failed; catalog entry remains deleted'
      )
    })
    this.log.info({ event: 'app.project_templates.deleted', templateId }, 'User template deleted')
    return this.list()
  }

  mintId(): string {
    return this.createId()
  }

  rows(): TemplateRow[] {
    return this.database.immediate((database) =>
      database.prepare('SELECT * FROM project_templates ORDER BY name COLLATE NOCASE').all()
    ) as TemplateRow[]
  }

  async #readUser(row: TemplateRow): Promise<ProjectTemplate> {
    const bytes = await readFile(join(this.root, safeRelativePath(row.relative_path)))
    if (sha256(bytes) !== row.sha256) throw new Error('Project template hash does not match')
    const template = projectTemplateSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown)
    if (template.templateId !== row.template_id || template.name !== row.name) {
      throw new Error('Project template metadata does not match its file')
    }
    return template
  }
}

function summary(
  template: ProjectTemplate,
  origin: 'application' | 'user',
  integrity: 'ready' | 'integrity_failed'
): ProjectTemplateSummary {
  return {
    templateId: template.templateId,
    name: template.name,
    description: template.description,
    origin,
    integrity,
    sectionCount: template.outline.length,
    writingRuleCount: template.writingRules.length,
    hasPublicationPreset: template.publicationPresetId !== null
  }
}

function safeRelativePath(value: string): string {
  if (!/^[0-9a-f-]{36}\.json$/u.test(value)) throw new Error('Template path is invalid')
  return value
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
