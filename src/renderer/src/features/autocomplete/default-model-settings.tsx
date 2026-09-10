import { ScrollArea } from '@/components/ui/scroll-area'
import { useEffect, useState } from 'react'
import {
  AUTOCOMPLETE_MODELS,
  autocompleteModelSchema,
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
  useEffect(() => {
    let current = true
    const load = () => {
      void window.desktop.autocomplete
        .settings()
        .then((value) => {
          if (current) {
            setSettings(value)
            setError(false)
          }
        })
        .catch((err) => {
          reportAutocompleteError(err)
          if (current) setError(true)
        })
    }
    load()
    const unsubscribe = window.desktop.autocomplete.subscribeChanges(load)
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  const select = async (value: string) => {
    setBusy(true)
    try {
      setSettings(
        await window.desktop.autocomplete.select(
          value === 'none'
            ? null
            : {
                providerPresetId: 'builtin:deepseek',
                modelId: autocompleteModelSchema.parse(value)
              }
        )
      )
      setError(false)
    } catch (err) {
      reportAutocompleteError(err)
      setError(true)
    } finally {
      setBusy(false)
    }
  }
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
              Turn on Autocomplete in the editor for each project session. Tab accepts a suggestion;
              Esc dismisses it.
            </FieldDescription>
            {error ? (
              <FieldDescription role='alert'>
                Default model settings could not be updated.
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
      </div>
    </ScrollArea>
  )
}
