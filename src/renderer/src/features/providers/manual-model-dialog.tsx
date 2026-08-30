import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { AgentManualModel, PiApi } from '../../../../shared/contracts/providers'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ConfigField } from './provider-settings-common'

export function ManualModelDialog({
  open,
  initial,
  apis,
  busy,
  onOpenChange,
  onSave
}: {
  open: boolean
  initial: AgentManualModel | null
  apis: PiApi[]
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSave: (model: AgentManualModel) => Promise<void>
}): React.JSX.Element {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [api, setApi] = useState<PiApi>('openai-completions')
  const [contextWindow, setContextWindow] = useState(131_072)
  const [maxTokens, setMaxTokens] = useState(8_192)
  const [reasoning, setReasoning] = useState(false)
  const [imageInput, setImageInput] = useState(false)

  useEffect(() => {
    if (!open) return
    setId(initial?.id ?? '')
    setName(initial?.name ?? '')
    setApi(initial?.api ?? apis[0] ?? 'openai-completions')
    setContextWindow(initial?.contextWindow ?? 131_072)
    setMaxTokens(initial?.maxTokens ?? 8_192)
    setReasoning(initial?.reasoning ?? false)
    setImageInput(initial?.input.includes('image') ?? false)
  }, [apis, initial, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit model' : 'Add model'}</DialogTitle>
          <DialogDescription>
            Manual metadata overlays a discovered model with the same ID and survives refreshes.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <ConfigField label='Model ID'>
            <Input
              value={id}
              disabled={initial !== null}
              placeholder='writer-model'
              onChange={(event) => setId(event.target.value)}
            />
          </ConfigField>
          <ConfigField label='Display name'>
            <Input
              value={name}
              placeholder='Defaults to the model ID'
              onChange={(event) => setName(event.target.value)}
            />
          </ConfigField>
          <Field>
            <FieldLabel>Pi API</FieldLabel>
            <Select value={api} onValueChange={(value) => setApi(value as PiApi)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {apis.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant='ghost' className='w-full justify-between'>
                Advanced model metadata <ChevronDown data-icon='inline-end' />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <FieldGroup className='pt-3'>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <ConfigField label='Context window'>
                    <Input
                      type='number'
                      min={8_192}
                      max={10_000_000}
                      value={contextWindow}
                      onChange={(event) => setContextWindow(Number(event.target.value))}
                    />
                  </ConfigField>
                  <ConfigField label='Maximum output'>
                    <Input
                      type='number'
                      min={1}
                      max={10_000_000}
                      value={maxTokens}
                      onChange={(event) => setMaxTokens(Number(event.target.value))}
                    />
                  </ConfigField>
                </div>
                <Field orientation='horizontal'>
                  <div className='min-w-0 flex-1'>
                    <FieldTitle>Reasoning model</FieldTitle>
                    <FieldDescription>Advertise reasoning controls to the Agent.</FieldDescription>
                  </div>
                  <Switch
                    checked={reasoning}
                    aria-label='Reasoning model'
                    onCheckedChange={setReasoning}
                  />
                </Field>
                <Field orientation='horizontal'>
                  <div className='min-w-0 flex-1'>
                    <FieldTitle>Image input</FieldTitle>
                    <FieldDescription>Allow the model to receive image context.</FieldDescription>
                  </div>
                  <Switch
                    checked={imageInput}
                    aria-label='Image input'
                    onCheckedChange={setImageInput}
                  />
                </Field>
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>
        </FieldGroup>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DialogClose>
          <Button
            disabled={busy || id.trim() === '' || apis.length === 0}
            onClick={() =>
              void onSave({
                id: id.trim(),
                name: name.trim() || id.trim(),
                api,
                reasoning,
                input: imageInput ? ['text', 'image'] : ['text'],
                contextWindow,
                maxTokens
              })
            }
          >
            Save model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
