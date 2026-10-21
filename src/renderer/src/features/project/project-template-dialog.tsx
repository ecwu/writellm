import type { ProjectTemplateExtractionPreview } from '../../../../shared/contracts/project-templates'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'

export interface ProjectTemplateDialogProps {
  open: boolean
  preview: ProjectTemplateExtractionPreview | null
  name: string
  description: string
  includePublicationPreset: boolean
  saving: boolean
  onOpenChange: (open: boolean) => void
  onNameChange: (name: string) => void
  onDescriptionChange: (description: string) => void
  onIncludePublicationPresetChange: (include: boolean) => void
  onSave: () => void
}

export function ProjectTemplateDialog({
  open,
  preview,
  name,
  description,
  includePublicationPreset,
  saving,
  onOpenChange,
  onNameChange,
  onDescriptionChange,
  onIncludePublicationPresetChange,
  onSave
}: ProjectTemplateDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save reusable project template</DialogTitle>
          <DialogDescription>
            Review exactly what will be reusable. Project content and identity stay excluded.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <Field>
            <FieldLabel htmlFor='template-name'>Template name</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id='template-name'
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor='template-description'>Description</FieldLabel>
            <Textarea
              id='template-description'
              value={description}
              maxLength={1_000}
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
          </Field>
          {preview ? (
            <div className='grid gap-3 rounded-md border p-3 text-sm'>
              <div>
                <p className='font-medium'>Included</p>
                <p className='text-muted-foreground'>
                  {preview.outlineTitles.length} outline sections, {preview.briefFields.length}{' '}
                  populated Brief fields, and {preview.writingRuleCount} writing rules.
                </p>
              </div>
              <div>
                <p className='font-medium'>Excluded</p>
                <ul className='list-disc pl-5 text-muted-foreground'>
                  {preview.excluded.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <label htmlFor='template-publication-preset' className='flex items-center gap-2'>
                <Checkbox
                  id='template-publication-preset'
                  checked={includePublicationPreset}
                  onCheckedChange={(checked) => onIncludePublicationPresetChange(checked === true)}
                />
                Include the current default publication preset reference
              </label>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type='button' disabled={name.trim().length === 0 || saving} onClick={onSave}>
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
