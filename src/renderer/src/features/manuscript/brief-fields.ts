import type { ManuscriptBrief } from '../../../../shared/contracts/manuscript'

export type BriefFields = Omit<
  ManuscriptBrief,
  'manuscriptBriefId' | 'manuscriptId' | 'version' | 'schemaVersion' | 'createdAt'
>

export const briefTextFields: Array<{
  key: Exclude<keyof BriefFields, 'extensible'>
  label: string
  multiline?: boolean
  placeholder: string
}> = [
  { key: 'title', label: 'Title', placeholder: 'Working title' },
  {
    key: 'description',
    label: 'Purpose',
    multiline: true,
    placeholder: 'What should this manuscript accomplish?'
  },
  { key: 'topic', label: 'Topic and coverage', multiline: true, placeholder: 'Core topic' },
  { key: 'targetAudience', label: 'Audience', placeholder: 'Who is this for?' },
  { key: 'language', label: 'Language', placeholder: 'English, 中文…' },
  { key: 'styleTone', label: 'Style and tone', multiline: true, placeholder: 'Voice and tone' },
  {
    key: 'scopeExclusions',
    label: 'Scope and exclusions',
    multiline: true,
    placeholder: 'What is in or out of scope?'
  },
  { key: 'targetLength', label: 'Target length', placeholder: 'For example, 2,000 words' },
  {
    key: 'citationRequirements',
    label: 'Citation requirements',
    multiline: true,
    placeholder: 'Citation style and evidence rules'
  },
  {
    key: 'additionalInstructions',
    label: 'Additional instructions',
    multiline: true,
    placeholder: 'Anything else the writing workflow should retain'
  }
]
