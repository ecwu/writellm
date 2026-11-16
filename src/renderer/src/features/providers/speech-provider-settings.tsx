import { useEffect, useRef, useState } from 'react'
import { Check, Mic, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import type {
  ProviderSettingsSnapshot,
  SpeechSourceStatus
} from '../../../../shared/contracts/providers'
import { speechErrorMessage } from '../../../../shared/speech-errors'
import { reportRendererOperationError } from '../../diagnostics'
import { PanelTitle, panelHeaderClassName } from '@/components/panel-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ConfigField, type ProviderSettingsWorkspaceProps } from './provider-settings-common'
import { ModelCandidatePicker, ModelCatalogRefresh } from './model-candidate-controls'

export interface SpeechSourceDraft {
  name: string
  baseUrl: string
  model: string
  mode: 'realtime' | 'file'
}
export const speechDefaultModels = {
  realtime: 'gpt-live-transcribe',
  file: 'gpt-transcribe'
} as const
export function newSpeechSourceDraft(): SpeechSourceDraft {
  return {
    name: '',
    baseUrl: 'https://api.openai.com/v1',
    model: speechDefaultModels.realtime,
    mode: 'realtime'
  }
}
export function changeSpeechDraftMode(
  draft: SpeechSourceDraft,
  mode: SpeechSourceDraft['mode'],
  isNew: boolean
): SpeechSourceDraft {
  return {
    ...draft,
    mode,
    model:
      isNew && draft.model === speechDefaultModels[draft.mode]
        ? speechDefaultModels[mode]
        : draft.model
  }
}
function sourceDraft(source: SpeechSourceStatus): SpeechSourceDraft {
  const config = source.config
  return {
    name: source.name,
    baseUrl: config?.baseUrl ?? '',
    model: config?.model ?? '',
    mode: config?.mode ?? 'realtime'
  }
}
export function SpeechProviderWorkspace({
  snapshot,
  closeAction,
  onSnapshotChange,
  onError
}: ProviderSettingsWorkspaceProps): React.JSX.Element {
  const catalog = snapshot.speechCatalog
  const [selectedId, setSelectedId] = useState<string | null>(
    catalog.activeSourceId ?? catalog.sources[0]?.sourceId ?? null
  )
  const selected = catalog.sources.find((source) => source.sourceId === selectedId)
  const [draft, setDraft] = useState<SpeechSourceDraft | null>(() =>
    selected ? sourceDraft(selected) : null
  )
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const savedDraftSignature = useRef<string | null>(null)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  useEffect(() => {
    const signature = JSON.stringify([selected?.sourceId, selected ? sourceDraft(selected) : null])
    if (savedDraftSignature.current === signature) return
    savedDraftSignature.current = signature
    if (selected) setDraft(sourceDraft(selected))
    setApiKey('')
    setMessage(null)
  }, [selected])
  useEffect(
    () => () => {
      void window.desktop.speech
        .cancelTest()
        .catch((err: unknown) => reportRendererOperationError(err, 'speech-settings.cancel-test'))
    },
    []
  )
  const unsaved =
    draft !== null &&
    (!selected ||
      JSON.stringify(draft) !== JSON.stringify(sourceDraft(selected)) ||
      apiKey.trim() !== '')
  const run = async (
    operation: 'save' | 'remove' | 'activate' | 'refresh',
    work: () => Promise<ProviderSettingsSnapshot>
  ): Promise<ProviderSettingsSnapshot | undefined> => {
    setBusy(operation)
    setMessage(null)
    try {
      const next = await work()
      onSnapshotChange(next)
      return next
    } catch (err) {
      reportRendererOperationError(err, `speech-settings.${operation}`)
      onError(
        {
          save: 'Speech source could not be saved.',
          remove: 'Speech source could not be removed.',
          activate: 'The active speech source could not be changed.',
          refresh: 'Speech models could not be refreshed.'
        }[operation]
      )
      return undefined
    } finally {
      setBusy(null)
    }
  }
  const save = async (): Promise<void> => {
    if (!draft) return
    const ids = new Set(catalog.sources.map((source) => source.sourceId))
    const next = await run('save', () =>
      window.desktop.providers.saveSpeechSource({
        ...(selected ? { sourceId: selected.sourceId } : {}),
        source: {
          ...draft,
          name: draft.name.trim(),
          baseUrl: draft.baseUrl.trim(),
          model: draft.model.trim()
        },
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      })
    )
    if (!next) return
    setApiKey('')
    if (!selected)
      setSelectedId(
        next.speechCatalog.sources.find((source) => !ids.has(source.sourceId))?.sourceId ?? null
      )
  }
  const testConnection = async (): Promise<void> => {
    if (!selected) return
    const sourceId = selected.sourceId
    setBusy('test')
    setMessage(null)
    try {
      await window.desktop.speech.testConnection({ sourceId })
      if (selectedRef.current === sourceId) setMessage('Connection and protocol accepted.')
    } catch (err) {
      reportRendererOperationError(err, 'speech-settings.test')
      onError(speechErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const cancelTest = (): void => {
    void window.desktop.speech
      .cancelTest()
      .catch((err: unknown) => reportRendererOperationError(err, 'speech-settings.cancel-test'))
  }
  return (
    <>
      <div className='grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden'>
        <section className='flex min-h-0 flex-col border-r'>
          <div className={panelHeaderClassName}>
            <PanelTitle icon={Mic} title='Speech sources' />
          </div>
          <div className='border-b p-4'>
            <Field>
              <FieldLabel htmlFor='speech-active-source'>Active speech source</FieldLabel>
              <Select
                value={catalog.activeSourceId ?? '__none__'}
                disabled={busy !== null}
                onValueChange={(sourceId) =>
                  void run('activate', () =>
                    window.desktop.providers.setActiveSpeechSource({
                      sourceId: sourceId === '__none__' ? null : sourceId
                    })
                  )
                }
              >
                <SelectTrigger id='speech-active-source'>
                  <SelectValue placeholder='Choose a source' />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value='__none__'>None</SelectItem>
                    {catalog.sources.map((source) => (
                      <SelectItem key={source.sourceId} value={source.sourceId}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col gap-1 p-2' data-testid='speech-source-list'>
              {catalog.sources.map((source) => (
                <Button
                  key={source.sourceId}
                  variant={source.sourceId === selectedId ? 'secondary' : 'ghost'}
                  className='h-auto min-w-0 justify-start px-3 py-2'
                  disabled={busy !== null}
                  onClick={() => setSelectedId(source.sourceId)}
                >
                  <Mic />
                  <span className='min-w-0 flex-1 truncate text-left'>{source.name}</span>
                  {catalog.activeSourceId === source.sourceId ? (
                    <Check aria-label='Active source' />
                  ) : null}
                </Button>
              ))}
            </div>
          </ScrollArea>
          <div className='border-t p-3'>
            <Button
              variant='outline'
              className='w-full'
              disabled={busy !== null}
              onClick={() => {
                setSelectedId(null)
                setDraft(newSpeechSourceDraft())
                setApiKey('')
                setMessage(null)
              }}
            >
              <Plus data-icon='inline-start' />
              Add source
            </Button>
          </div>
        </section>
        <section className='flex min-h-0 min-w-0 flex-col'>
          {draft === null ? (
            <>
              <div className='flex justify-end p-5'>{closeAction}</div>
              <Empty className='flex-1'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <Mic />
                  </EmptyMedia>
                  <EmptyTitle>No speech source selected</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant='outline' onClick={() => setDraft(newSpeechSourceDraft())}>
                    <Plus />
                    Add source
                  </Button>
                </EmptyContent>
              </Empty>
            </>
          ) : (
            <ScrollArea className='h-full'>
              <div className='flex min-w-0 flex-col gap-6 p-5 lg:p-7'>
                <header className='flex flex-wrap items-center gap-3'>
                  <Mic />
                  <h2 className='min-w-0 flex-1 truncate text-xl font-semibold'>
                    {draft.name.trim() || 'New speech source'}
                  </h2>
                  {catalog.activeSourceId === selectedId && selected ? <Badge>Active</Badge> : null}
                  {unsaved && selected ? <Badge variant='secondary'>Unsaved changes</Badge> : null}
                  <Button
                    disabled={
                      busy !== null ||
                      !unsaved ||
                      !draft.name.trim() ||
                      !draft.baseUrl.trim() ||
                      !draft.model.trim()
                    }
                    onClick={() => void save()}
                  >
                    {busy === 'save' ? <Spinner /> : null}
                    {selected ? 'Save changes' : 'Save source'}
                  </Button>
                  {closeAction}
                </header>
                {snapshot.credentialBackend.warning ? (
                  <Alert variant='destructive'>
                    <ShieldAlert />
                    <AlertTitle>Secure credential storage unavailable</AlertTitle>
                    <AlertDescription>{snapshot.credentialBackend.warning}</AlertDescription>
                  </Alert>
                ) : null}
                {message ? (
                  <Alert>
                    <Check />
                    <AlertTitle>Connected</AlertTitle>
                    <AlertDescription>{message}</AlertDescription>
                  </Alert>
                ) : null}
                {selected && !selected.available ? (
                  <Alert>
                    <AlertTitle>Source unavailable</AlertTitle>
                    <AlertDescription>
                      {selected.issues[0] ?? 'Check the source configuration.'}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <FieldGroup>
                  <ConfigField label='Source name'>
                    <Input
                      value={draft.name}
                      disabled={busy !== null}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </ConfigField>
                  <ConfigField
                    label='Base URL'
                    description='Changing the protocol, host, or port removes the stored key.'
                  >
                    <Input
                      value={draft.baseUrl}
                      disabled={busy !== null}
                      autoComplete='url'
                      onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                    />
                  </ConfigField>
                  <ConfigField label='Model ID'>
                    <Input
                      value={draft.model}
                      disabled={busy !== null}
                      autoComplete='off'
                      onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                    />
                  </ConfigField>
                  {selected ? (
                    <ModelCandidatePicker
                      candidates={selected.modelCandidates}
                      purpose={{ capability: 'transcription', mode: draft.mode }}
                      disabled={busy !== null}
                      onSelect={(candidate) => setDraft({ ...draft, model: candidate.id })}
                    />
                  ) : null}
                  <ConfigField label='Recognition mode'>
                    <ToggleGroup
                      type='single'
                      variant='outline'
                      value={draft.mode}
                      disabled={busy !== null}
                      onValueChange={(mode) => {
                        if (mode === 'realtime' || mode === 'file')
                          setDraft(changeSpeechDraftMode(draft, mode, !selected))
                      }}
                    >
                      <ToggleGroupItem value='realtime'>Realtime</ToggleGroupItem>
                      <ToggleGroupItem value='file'>After recording</ToggleGroupItem>
                    </ToggleGroup>
                  </ConfigField>
                  <ConfigField label='API key or token'>
                    <Input
                      type='password'
                      autoComplete='new-password'
                      value={apiKey}
                      disabled={busy !== null}
                      placeholder={
                        selected?.configured
                          ? 'Stored — enter a new value to replace'
                          : 'Optional for local services'
                      }
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                  </ConfigField>
                </FieldGroup>
                {selected ? (
                  <>
                    <ModelCatalogRefresh
                      candidates={selected.modelCandidates}
                      catalog={selected.catalog}
                      busy={busy === 'refresh'}
                      disabled={busy !== null || unsaved}
                      onRefresh={() =>
                        void run('refresh', () =>
                          window.desktop.providers.refreshSpeechModels({
                            sourceId: selected.sourceId
                          })
                        )
                      }
                    />
                    <div className='flex flex-wrap items-center gap-3'>
                      <Button
                        variant='outline'
                        disabled={busy !== null || unsaved}
                        onClick={() => void testConnection()}
                      >
                        {busy === 'test' ? <Spinner /> : null}Test connection
                      </Button>
                      {busy === 'test' ? (
                        <Button variant='outline' onClick={cancelTest}>
                          Cancel test
                        </Button>
                      ) : null}
                    </div>
                    <p className='text-sm text-muted-foreground'>
                      Testing contacts the saved endpoint. File mode sends one second of silence and
                      may incur a charge.
                    </p>
                    <Separator />
                    <div className='flex justify-end'>
                      <Button
                        variant='destructive'
                        disabled={busy !== null}
                        onClick={() => setConfirmRemove(true)}
                      >
                        <Trash2 />
                        Remove source
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </ScrollArea>
          )}
        </section>
      </div>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selected?.name ?? 'speech source'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its encrypted credential and model catalog are removed. Removing the active source
              stops new dictation until another source is chosen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (!selected) return
                void run('remove', () =>
                  window.desktop.providers.removeSpeechSource({ sourceId: selected.sourceId })
                ).then((next) => {
                  if (!next) return
                  const first = next.speechCatalog.sources[0]
                  setSelectedId(first?.sourceId ?? null)
                  setDraft(first ? sourceDraft(first) : null)
                  setConfirmRemove(false)
                })
              }}
            >
              Remove source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
