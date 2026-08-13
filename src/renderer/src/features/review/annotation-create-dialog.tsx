import type { AnnotationKind, AnnotationRecord } from '../../../../shared/contracts/annotations'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function AnnotationCreateDialog(props: {
  open: boolean
  projectSessionId: string
  sectionId: string | null
  blockId: string | null
  textAnchor: string | null
  onOpenChange(open: boolean): void
  onCreated(annotation: AnnotationRecord): void
  onError(message: string): void
}): React.JSX.Element {
  const [kind, setKind] = useState<AnnotationKind>('todo')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const create = async (): Promise<void> => {
    if (props.sectionId === null || props.blockId === null || body.trim().length === 0) return
    setSaving(true)
    try {
      const annotation = await window.desktop.annotations.create({
        projectSessionId: props.projectSessionId,
        sectionId: props.sectionId,
        blockId: props.blockId,
        kind,
        body,
        ...(props.textAnchor === null || props.textAnchor.trim().length === 0
          ? {}
          : { textAnchor: props.textAnchor.slice(0, 512) })
      })
      setBody('')
      props.onCreated(annotation)
      props.onOpenChange(false)
    } catch {
      props.onError('The annotation could not be attached. Save the section and try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add annotation</DialogTitle>
          <DialogDescription>
            This note stays outside the published manuscript and is attached to the current block.
          </DialogDescription>
        </DialogHeader>
        <Select value={kind} onValueChange={(value) => setKind(value as AnnotationKind)}>
          <SelectTrigger aria-label='Annotation kind'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='todo'>TODO</SelectItem>
            <SelectItem value='note'>Note</SelectItem>
          </SelectContent>
        </Select>
        <Textarea
          autoFocus
          aria-label='Annotation text'
          maxLength={8192}
          rows={5}
          value={body}
          placeholder={
            kind === 'todo' ? 'What still needs to be done?' : 'Add a private writing note…'
          }
          onChange={(event) => setBody(event.target.value)}
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || body.trim().length === 0 || props.blockId === null}
            onClick={() => void create()}
          >
            {saving ? 'Adding…' : 'Add annotation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
