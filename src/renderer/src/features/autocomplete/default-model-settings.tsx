import { Button } from '@/components/ui/button'
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
import type { AgentProviderPresetSummary } from '../../../../shared/contracts/providers'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ArrowUpRight, Pilcrow, Text, WholeWord } from 'lucide-react'
import { PanelTitle, panelHeaderClassName } from '@/components/panel-header'
import { Spinner } from '@/components/ui/spinner'
import { DefaultModelSelector } from '@/features/providers/default-model-selector'
import { reportAutocompleteError } from './autocomplete-errors'

const deepSeekModels = [
  {
    id: 'builtin:deepseek',
    label: 'DeepSeek',
    models: AUTOCOMPLETE_MODELS.map((modelId) => ({ value: modelId, label: modelId }))
  }
]

export function AutocompleteSettingsWorkspace({
  closeAction,
  onOpenAgentSettings,
  source
}: {
  closeAction: React.ReactNode
  onOpenAgentSettings: () => void
  source: AgentProviderPresetSummary | undefined
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
  const select = (value: string | null) =>
    save(() =>
      window.desktop.autocomplete.select(
        value === null
          ? null
          : {
              providerPresetId: 'builtin:deepseek',
              modelId: autocompleteModelSchema.parse(value)
            }
      )
    )
  const unavailableReason =
    settings?.sourceAvailable || settings === null
      ? null
      : source?.authConfigured && !source.enabled
        ? 'Enable DeepSeek in Agent.'
        : 'Add a DeepSeek API key in Agent.'
  const currentModel = settings?.selection?.modelId ?? null
  return (
    <div className='grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden'>
      <section className='flex min-h-0 flex-col border-r' aria-label='Autocomplete sources'>
        <div className={panelHeaderClassName}>
          <PanelTitle title='Autocomplete' />
        </div>
        <div className='border-b p-4'>
          <DefaultModelSelector
            id='autocomplete-default-model'
            groups={settings?.sourceAvailable ? deepSeekModels : []}
            value={currentModel}
            disabled={settings === null || busy}
            onValueChange={(value) => void select(value)}
            unavailable={
              currentModel !== null && unavailableReason !== null
                ? { label: `DeepSeek · ${currentModel}`, reason: unavailableReason }
                : undefined
            }
          />
        </div>
        <div className='flex flex-col gap-2 p-4'>
          <h3 className='text-sm font-medium'>Sources</h3>
          <ul aria-label='Sources'>
            <li aria-current='true' className='rounded-md bg-secondary px-3 py-2 text-sm'>
              DeepSeek
            </li>
          </ul>
        </div>
      </section>
      <section className='flex min-h-0 min-w-0 flex-col'>
        <div className={panelHeaderClassName}>
          <PanelTitle title='DeepSeek' />
          {closeAction}
        </div>
        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex flex-col gap-6 p-5'>
            <section className='flex flex-col items-start gap-2'>
              <h3 className='font-medium'>Connection</h3>
              {unavailableReason && currentModel === null ? (
                <p className='text-sm text-muted-foreground'>{unavailableReason}</p>
              ) : null}
              <Button variant='outline' size='sm' onClick={onOpenAgentSettings}>
                Manage DeepSeek in Agent <ArrowUpRight data-icon='inline-end' />
              </Button>
            </section>
            <section className='flex flex-col gap-2'>
              <h3 className='font-medium'>Models</h3>
              <ul aria-label='Autocomplete models' className='divide-y rounded-md border'>
                {AUTOCOMPLETE_MODELS.map((modelId) => (
                  <li key={modelId} className='px-3 py-2 text-sm'>
                    {modelId}
                  </li>
                ))}
              </ul>
            </section>
            {settings ? (
              <FieldGroup>
                <Field orientation='horizontal'>
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
                </Field>
                <Field>
                  <FieldLabel id='autocomplete-default-length'>
                    Default completion length
                  </FieldLabel>
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
                    <ToggleGroupItem value='word'>
                      <WholeWord /> Words
                    </ToggleGroupItem>
                    <ToggleGroupItem value='sentence'>
                      <Text /> Sentence
                    </ToggleGroupItem>
                    <ToggleGroupItem value='paragraph'>
                      <Pilcrow /> Paragraph
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </FieldGroup>
            ) : !error ? (
              <Spinner />
            ) : null}
            {error ? (
              <FieldDescription role='alert'>
                Autocomplete settings could not be updated.
              </FieldDescription>
            ) : null}
          </div>
        </ScrollArea>
      </section>
    </div>
  )
}
