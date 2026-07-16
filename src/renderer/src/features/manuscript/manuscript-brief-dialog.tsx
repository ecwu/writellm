import type { ManuscriptBrief } from '../../../../shared/contracts/manuscript'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type BriefFields = Omit<
  ManuscriptBrief,
  'manuscriptBriefId' | 'manuscriptId' | 'version' | 'schemaVersion' | 'createdAt'
>

const textFields: Array<{
  key: keyof BriefFields
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

function editableFields(brief: ManuscriptBrief): BriefFields {
  const {
    manuscriptBriefId: _manuscriptBriefId,
    manuscriptId: _manuscriptId,
    version: _version,
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    ...fields
  } = brief
  return fields
}

export function ManuscriptBriefDialog(props: {
  open: boolean
  brief: ManuscriptBrief
  saving: boolean
  error: string | null
  onOpenChange(open: boolean): void
  onReload(): void
  onSave(fields: BriefFields): Promise<void>
}): React.JSX.Element {
  const [fields, setFields] = useState<BriefFields>(() => editableFields(props.brief))

  useEffect(() => {
    setFields(editableFields(props.brief))
  }, [props.brief])

  const dirty = useMemo(
    () => JSON.stringify(fields) !== JSON.stringify(editableFields(props.brief)),
    [fields, props.brief]
  )

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[88vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <DialogTitle>Manuscript brief</DialogTitle>
            <Badge variant={props.error ? 'destructive' : dirty ? 'secondary' : 'outline'}>
              {props.error ? 'Save failed' : dirty ? 'Unsaved' : 'Saved'}
            </Badge>
          </div>
          <DialogDescription>
            Keep the purpose, audience, constraints, and writing direction explicit.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4 sm:grid-cols-2'>
          {textFields.map((field) => {
            const value = fields[field.key]
            if (field.key === 'extensible') return null
            return (
              <label
                key={field.key}
                htmlFor={`brief-${field.key}`}
                className={field.multiline ? 'grid gap-2 sm:col-span-2' : 'grid gap-2'}
              >
                <span className='text-sm font-medium'>{field.label}</span>
                {field.multiline ? (
                  <Textarea
                    id={`brief-${field.key}`}
                    value={String(value)}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [field.key]: event.target.value
                      }))
                    }
                  />
                ) : (
                  <Input
                    id={`brief-${field.key}`}
                    value={String(value)}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [field.key]: event.target.value
                      }))
                    }
                  />
                )}
              </label>
            )
          })}
        </div>
        {props.error ? <p className='text-sm text-destructive'>{props.error}</p> : null}
        <DialogFooter>
          {props.error ? (
            <Button variant='outline' disabled={props.saving} onClick={props.onReload}>
              Reload latest
            </Button>
          ) : null}
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!dirty || props.saving || fields.title.trim().length === 0}
            onClick={() => void props.onSave(fields)}
          >
            {props.saving ? 'Saving…' : 'Save brief'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
