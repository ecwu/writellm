import { Check, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  PublicationPreset,
  PublicationPresetSnapshot
} from '../../../../shared/contracts/publication-presets'
import type { PublicationOptions } from '../../../../shared/contracts/publication'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export function PublicationPresetsSettings(props: {
  snapshot: PublicationPresetSnapshot
  closeAction: React.ReactNode
  onSnapshot(snapshot: PublicationPresetSnapshot): void
  onError(message: string): void
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(props.snapshot.defaultPresetId)
  const selected =
    props.snapshot.presets.find((preset) => preset.presetId === selectedId) ??
    props.snapshot.presets[0]
  const [draft, setDraft] = useState<PublicationPreset | null>(selected ?? null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (selected === undefined) return
    setDraft(selected)
  }, [selected])

  const mutate = async (operation: () => Promise<PublicationPresetSnapshot>): Promise<void> => {
    setSaving(true)
    try {
      const snapshot = await operation()
      props.onSnapshot(snapshot)
    } catch {
      props.onError('Publication presets could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  const createPreset = (): void => {
    const used = new Set(props.snapshot.presets.map((preset) => preset.name.toLocaleLowerCase()))
    let index = 1
    while (used.has(`custom preset ${index}`)) index += 1
    void mutate(async () => {
      const snapshot = await window.desktop.app.createPublicationPreset({
        name: `Custom preset ${index}`,
        options: selected?.options ?? defaultOptions()
      })
      const created = snapshot.presets.find((preset) => preset.name === `Custom preset ${index}`)
      if (created !== undefined) setSelectedId(created.presetId)
      return snapshot
    })
  }

  return (
    <div className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
      <header className='flex items-start gap-3 border-b p-6 lg:px-8'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-xl font-semibold'>Publication presets</h2>
          <p className='text-sm text-muted-foreground'>
            Shared page and structure settings for Word, LaTeX, and PDF exports.
          </p>
        </div>
        {props.closeAction}
      </header>
      <div className='grid min-h-0 md:grid-cols-[16rem_minmax(0,1fr)]'>
        <ScrollArea className='border-r'>
          <div className='grid gap-2 p-3'>
            <Button variant='outline' onClick={createPreset} disabled={saving}>
              <Plus /> New preset
            </Button>
            {props.snapshot.presets.map((preset) => (
              <button
                type='button'
                key={preset.presetId}
                className='flex items-center gap-2 rounded-md border p-3 text-left hover:bg-muted/50'
                data-selected={preset.presetId === selected?.presetId}
                onClick={() => setSelectedId(preset.presetId)}
              >
                <span className='min-w-0 flex-1 truncate text-sm font-medium'>{preset.name}</span>
                {preset.isDefault ? <Check className='size-4 text-primary' /> : null}
              </button>
            ))}
          </div>
        </ScrollArea>
        <ScrollArea>
          {draft === null ? null : (
            <div className='mx-auto grid w-full max-w-3xl gap-6 p-6 lg:p-8'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant='outline'>{draft.origin}</Badge>
                {draft.isDefault ? <Badge>Default export preset</Badge> : null}
              </div>
              <FieldGroup>
                <Field>
                  <FieldTitle id='publication-preset-name-label'>Name</FieldTitle>
                  <Input
                    id='publication-preset-name'
                    aria-labelledby='publication-preset-name-label'
                    value={draft.name}
                    disabled={draft.origin === 'application'}
                    maxLength={80}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                  <FieldDescription>Application presets are stable and read-only.</FieldDescription>
                </Field>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <PresetSelect
                    label='Page size'
                    value={draft.options.pageSize}
                    disabled={draft.origin === 'application'}
                    values={['A4', 'letter']}
                    onValue={(pageSize) => updateOptions(draft, setDraft, { pageSize })}
                  />
                  <PresetSelect
                    label='Template'
                    value={draft.options.template}
                    disabled={draft.origin === 'application'}
                    values={['academic', 'report', 'minimal']}
                    onValue={(template) => updateOptions(draft, setDraft, { template })}
                  />
                </div>
                <Field>
                  <FieldTitle>Margins (mm)</FieldTitle>
                  <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                    {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                      <label
                        key={side}
                        htmlFor={`publication-margin-${side}`}
                        className='grid gap-1 text-xs text-muted-foreground'
                      >
                        {side}
                        <Input
                          id={`publication-margin-${side}`}
                          type='number'
                          min={10}
                          max={50}
                          disabled={draft.origin === 'application'}
                          value={draft.options.marginsMm[side]}
                          onChange={(event) =>
                            updateOptions(draft, setDraft, {
                              marginsMm: {
                                ...draft.options.marginsMm,
                                [side]: Number(event.target.value)
                              }
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </Field>
                <PresetSwitch
                  label='Table of contents'
                  description='Include a generated heading outline where the format supports it.'
                  checked={draft.options.includeTableOfContents}
                  disabled={draft.origin === 'application'}
                  onChecked={(includeTableOfContents) =>
                    updateOptions(draft, setDraft, { includeTableOfContents })
                  }
                />
                <PresetSwitch
                  label='References'
                  description='Include the canonical manuscript References section.'
                  checked={draft.options.includeReferences}
                  disabled={draft.origin === 'application'}
                  onChecked={(includeReferences) =>
                    updateOptions(draft, setDraft, { includeReferences })
                  }
                />
              </FieldGroup>
              <div className='flex flex-wrap justify-end gap-2'>
                {!draft.isDefault ? (
                  <Button
                    variant='outline'
                    disabled={saving}
                    onClick={() =>
                      void mutate(() =>
                        window.desktop.app.setDefaultPublicationPreset({ presetId: draft.presetId })
                      )
                    }
                  >
                    <Check /> Use by default
                  </Button>
                ) : null}
                {draft.origin === 'user' && !draft.isDefault ? (
                  <Button
                    variant='destructive'
                    disabled={saving}
                    onClick={() =>
                      void mutate(async () => {
                        const snapshot = await window.desktop.app.deletePublicationPreset({
                          presetId: draft.presetId
                        })
                        setSelectedId(snapshot.defaultPresetId)
                        return snapshot
                      })
                    }
                  >
                    <Trash2 /> Delete
                  </Button>
                ) : null}
                {draft.origin === 'user' ? (
                  <Button
                    disabled={saving || draft.name.trim() === ''}
                    onClick={() =>
                      void mutate(() =>
                        window.desktop.app.updatePublicationPreset({
                          presetId: draft.presetId,
                          name: draft.name,
                          options: draft.options
                        })
                      )
                    }
                  >
                    <Save /> Save preset
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}

function PresetSelect<T extends string>(props: {
  label: string
  value: T
  values: readonly T[]
  disabled: boolean
  onValue(value: T): void
}): React.JSX.Element {
  return (
    <Field>
      <FieldTitle>{props.label}</FieldTitle>
      <Select value={props.value} disabled={props.disabled} onValueChange={props.onValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.values.map((value) => (
            <SelectItem key={value} value={value}>
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function PresetSwitch(props: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChecked(checked: boolean): void
}): React.JSX.Element {
  return (
    <Field orientation='horizontal'>
      <div className='min-w-0 flex-1'>
        <FieldTitle>{props.label}</FieldTitle>
        <FieldDescription>{props.description}</FieldDescription>
      </div>
      <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChecked} />
    </Field>
  )
}

function updateOptions(
  preset: PublicationPreset,
  setPreset: (preset: PublicationPreset) => void,
  update: Partial<PublicationOptions>
): void {
  setPreset({ ...preset, options: { ...preset.options, ...update } })
}

function defaultOptions(): PublicationOptions {
  return {
    schemaVersion: 1,
    pageSize: 'A4',
    marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
    template: 'academic',
    includeTableOfContents: true,
    includeReferences: true,
    mermaidFallback: 'rendered'
  }
}
