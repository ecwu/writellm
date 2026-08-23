import type { ProjectTemplateSummary } from '../../../../shared/contracts/project-templates'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

interface ProjectCreationFieldsProps {
  idPrefix: string
  projectName: string
  projectNameError: string | null
  projectTemplates: ProjectTemplateSummary[]
  selectedTemplateId: string
  autoFocus?: boolean
  onProjectNameChange: (name: string) => void
  onTemplateChange: (templateId: string) => void
  onDeleteSelectedTemplate: () => void
}

export function ProjectCreationFields({
  idPrefix,
  projectName,
  projectNameError,
  projectTemplates,
  selectedTemplateId,
  autoFocus = false,
  onProjectNameChange,
  onTemplateChange,
  onDeleteSelectedTemplate
}: ProjectCreationFieldsProps): React.JSX.Element {
  const projectNameId = `${idPrefix}-project-name`
  const projectNameDescriptionId = `${projectNameId}-${projectNameError ? 'error' : 'hint'}`
  const projectTemplateId = `${idPrefix}-project-template`
  const selectedTemplate = projectTemplates.find(
    (template) => template.templateId === selectedTemplateId
  )

  return (
    <FieldGroup>
      <Field data-invalid={projectNameError !== null}>
        <FieldLabel htmlFor={projectNameId}>Project name</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={projectNameId}
            autoFocus={autoFocus}
            autoComplete='off'
            value={projectName}
            aria-invalid={projectNameError !== null}
            aria-describedby={projectNameDescriptionId}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder='My project'
          />
          <InputGroupAddon align='inline-end'>
            <InputGroupText>.writellm</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription
          id={projectNameDescriptionId}
          className={projectNameError ? 'text-destructive' : undefined}
        >
          {projectNameError ?? 'WriteLLM creates a new portable folder with this name.'}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor={projectTemplateId}>Starting template</FieldLabel>
        <div className='flex gap-2'>
          <Select value={selectedTemplateId} onValueChange={onTemplateChange}>
            <SelectTrigger id={projectTemplateId} className='min-w-0 flex-1'>
              <SelectValue placeholder='Blank project' />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='blank'>Blank project</SelectItem>
                {projectTemplates.map((template) => (
                  <SelectItem
                    key={template.templateId}
                    value={template.templateId}
                    disabled={template.integrity !== 'ready'}
                  >
                    {template.name}
                    {template.origin === 'user' ? ' · Mine' : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {selectedTemplate?.origin === 'user' ? (
            <Button type='button' variant='outline' onClick={onDeleteSelectedTemplate}>
              Delete
            </Button>
          ) : null}
        </div>
        <FieldDescription>
          {selectedTemplateId === 'blank'
            ? 'Start with an empty Brief and one section.'
            : (selectedTemplate?.description ?? 'This template is unavailable.')}
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}
