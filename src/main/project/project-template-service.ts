import { randomUUID } from 'node:crypto'
import {
  PROJECT_TEMPLATE_FORMAT,
  PROJECT_TEMPLATE_FORMAT_VERSION,
  projectTemplateExtractionPreviewSchema,
  projectTemplateSchema,
  type ProjectTemplate,
  type ProjectTemplateExtractionPreview
} from '../../shared/contracts/project-templates'
import { readWritingRules, writeWritingRules } from '../../shared/contracts/writing-rules'
import type { ManuscriptService } from '../manuscript/manuscript-service'

const BRIEF_FIELD_NAMES = [
  'description',
  'topic',
  'targetAudience',
  'language',
  'styleTone',
  'scopeExclusions',
  'targetLength',
  'citationRequirements',
  'additionalInstructions'
] as const

export function extractProjectTemplate(options: {
  manuscript: ManuscriptService
  templateId: string
  name: string
  description: string
  publicationPresetId: string | null
}): ProjectTemplate {
  const brief = options.manuscript.getBrief()
  const sections = options.manuscript.listSections()
  const keyBySection = new Map(
    sections.map((section, index) => [section.sectionId, `section-${index + 1}`])
  )
  return projectTemplateSchema.parse({
    format: PROJECT_TEMPLATE_FORMAT,
    formatVersion: PROJECT_TEMPLATE_FORMAT_VERSION,
    templateId: options.templateId,
    name: options.name,
    description: options.description,
    brief: Object.fromEntries(BRIEF_FIELD_NAMES.map((field) => [field, brief[field]])),
    outline: sections.map((section) => ({
      templateKey: keyBySection.get(section.sectionId),
      parentTemplateKey:
        section.parentSectionId === null
          ? null
          : (keyBySection.get(section.parentSectionId) ?? null),
      title: section.title,
      objective: section.objective,
      status: section.status
    })),
    writingRules: readWritingRules(brief.extensible).rules.map(({ ruleId: _, ...rule }) => rule),
    publicationPresetId: options.publicationPresetId
  })
}

export function previewProjectTemplateExtraction(options: {
  manuscript: ManuscriptService
  publicationPresetId: string | null
}): ProjectTemplateExtractionPreview {
  const brief = options.manuscript.getBrief()
  return projectTemplateExtractionPreviewSchema.parse({
    briefFields: BRIEF_FIELD_NAMES.filter((field) => brief[field].trim().length > 0),
    outlineTitles: options.manuscript.listSections().map((section) => section.title),
    writingRuleCount: readWritingRules(brief.extensible).rules.length,
    publicationPresetId: options.publicationPresetId,
    excluded: [
      'Manuscript bodies and citations',
      'Knowledge files and parsed artifacts',
      'Agent history, proposals, and review issues',
      'Annotations and generated assets',
      'Version history, project identity, credentials, and private paths'
    ]
  })
}

export function applyProjectTemplate(options: {
  manuscript: ManuscriptService
  template: ProjectTemplate
  createId?: () => string
}): void {
  const template = projectTemplateSchema.parse(options.template)
  const createId = options.createId ?? randomUUID
  const currentBrief = options.manuscript.getBrief()
  const writingRules = {
    schemaVersion: 1 as const,
    rules: template.writingRules.map((rule) => ({ ...rule, ruleId: createId() }))
  }
  options.manuscript.updateBrief({
    baseVersion: currentBrief.version,
    title: currentBrief.title,
    ...template.brief,
    extensible: writeWritingRules({}, writingRules)
  })

  const existing = options.manuscript.listSections()
  const first = existing[0]
  const firstTemplate = template.outline[0]
  if (first === undefined || firstTemplate === undefined) {
    throw new Error('Project template requires an initial section')
  }
  let outlineVersion = options.manuscript.getWorkspace().outlineVersion
  options.manuscript.updateSection({
    baseOutlineVersion: outlineVersion,
    sectionId: first.sectionId,
    title: firstTemplate.title,
    objective: firstTemplate.objective,
    status: firstTemplate.status
  })
  outlineVersion += 1
  const sectionByKey = new Map([[firstTemplate.templateKey, first.sectionId]])
  for (const item of template.outline.slice(1)) {
    const parentSectionId =
      item.parentTemplateKey === null
        ? null
        : (sectionByKey.get(item.parentTemplateKey) ?? missingParent())
    const siblings = options.manuscript
      .listSections()
      .filter((section) => section.parentSectionId === parentSectionId)
    const created = options.manuscript.createSection({
      baseOutlineVersion: outlineVersion,
      parentSectionId,
      position: siblings.length,
      title: item.title,
      objective: item.objective,
      status: item.status
    })
    sectionByKey.set(item.templateKey, created.sectionId)
    outlineVersion += 1
  }
}

function missingParent(): never {
  throw new Error('Project template parent is unavailable')
}
