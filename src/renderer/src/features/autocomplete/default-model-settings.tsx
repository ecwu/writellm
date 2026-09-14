import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useRef, useState } from 'react'
import {
  AUTOCOMPLETE_MODELS,
  autocompleteModelSchema,
  autocompleteStyleSchema,
  type AutocompleteSettings
} from '../../../../shared/contracts/autocomplete'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { reportAutocompleteError } from './autocomplete-errors'

export function DefaultModelSettings({
  closeAction
}: {
  closeAction: React.ReactNode
}): React.JSX.Element {
  const [settings, setSettings] = useState<AutocompleteSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const sequence = useRef(0)
  useEffect(() => {
    let current = true
    const load = () => {
      const request = ++sequence.current
      void window.desktop.autocomplete
        .settings()
        .then((value) => {
          if (current && request === sequence.current) {
            setSettings(value)
            setError(false)
          }
        })
        .catch((err) => {
          reportAutocompleteError(err)
          if (current && request === sequence.current) setError(true)
        })
    }
    load()
    const unsubscribe = window.desktop.autocomplete.subscribeChanges(load)
    return () => {
      current = false
      sequence.current++
      unsubscribe()
    }
  }, [])
  const save = async (action: () => Promise<AutocompleteSettings>) => {
    const request = ++sequence.current
    setBusy(true)
    try {
      const next = await action()
      if (request === sequence.current) {
        setSettings(next)
        setError(false)
      }
    } catch (err) {
      reportAutocompleteError(err)
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const select = (value: string) =>
    save(() =>
      window.desktop.autocomplete.select(
        value === 'none'
          ? null
          : {
              providerPresetId: 'builtin:deepseek',
              modelId: autocompleteModelSchema.parse(value)
            }
      )
    )
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-8'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='text-xl font-semibold'>Default Models</h2>
          {closeAction}
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='autocomplete-model'>FIM / Autocomplete</FieldLabel>
            <FieldDescription>
              Uses the enabled DeepSeek connection from Agent API. This choice is independent of
              your writing Agent model.
            </FieldDescription>
            {settings ? (
              <Select
                value={settings.selection?.modelId ?? 'none'}
                disabled={busy}
                onValueChange={(value) => void select(value)}
              >
                <SelectTrigger id='autocomplete-model'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value='none'>Not selected</SelectItem>
                    {AUTOCOMPLETE_MODELS.map((model) => (
                      <SelectItem key={model} value={model}>
                        DeepSeek · {model}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : !error ? (
              <Spinner />
            ) : null}
            {settings?.selection && !settings.available ? (
              <FieldDescription>
                Configure and enable DeepSeek in Agent API to use autocomplete.
              </FieldDescription>
            ) : null}
            <FieldDescription>
              Editor changes apply until app exit and do not change these saved defaults. Tab
              accepts a suggestion; Esc dismisses it.
            </FieldDescription>
            {error ? (
              <FieldDescription role='alert'>
                Default model settings could not be updated.
              </FieldDescription>
            ) : null}
          </Field>
          {settings ? (
            <>
              <Field>
                <FieldLabel htmlFor='autocomplete-auto-enable'>
                  Automatically enable autocomplete
                </FieldLabel>
                <Switch
                  id='autocomplete-auto-enable'
                  checked={settings.defaultEnabled}
                  disabled={busy}
                  onCheckedChange={(enabled) =>
                    void save(() => window.desktop.autocomplete.setDefaultEnabled(enabled))
                  }
                />
                <FieldDescription>
                  Use autocomplete by default when a model is available. Applies across all
                  projects.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel id='autocomplete-default-length'>Default completion length</FieldLabel>
                <ToggleGroup
                  type='single'
                  variant='outline'
                  aria-labelledby='autocomplete-default-length'
                  value={settings.style}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value)
                      void save(() =>
                        window.desktop.autocomplete.setStyle(autocompleteStyleSchema.parse(value))
                      )
                  }}
                >
                  <ToggleGroupItem value='word'>Words</ToggleGroupItem>
                  <ToggleGroupItem value='sentence'>Sentence</ToggleGroupItem>
                  <ToggleGroupItem value='paragraph'>Paragraph</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </>
          ) : null}
        </FieldGroup>
      </div>
    </ScrollArea>
  )
}
