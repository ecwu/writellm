import { reportRendererOperationError } from '../../diagnostics'
import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  ImageIcon,
  Plus,
  ShieldAlert,
  Star,
  Trash2
} from 'lucide-react'
import {
  IMAGE_TRANSPORT_LABELS,
  OFFICIAL_IMAGE_BASE_URLS,
  type ImageModelDefinition,
  type ImageModelSelection,
  type ImageProviderId,
  type ImageSize,
  type ImageSourceDraft,
  type ImageSourceStatus,
  type ProviderConnectionTestResult,
  type ProviderSettingsSnapshot
} from '../../../../shared/contracts/providers'
import { resolveModelsDevProviderLogoId } from '../../../../shared/models-dev-provider-logos'
import { ProviderLogo } from '@/components/provider-logo'
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { ConfigField, type ProviderSettingsWorkspaceProps } from './provider-settings-common'

const IMAGE_TRANSPORTS: ImageProviderId[] = ['google-gemini', 'google-vertex', 'openai', 'xai']

const transportLogoIds: Record<ImageProviderId, string> = {
  'google-gemini': 'google',
  'google-vertex': 'google-vertex',
  openai: 'openai',
  xai: 'xai'
}

interface ImageSourceFormDraft {
  sourceId?: string
  providerId: ImageProviderId
  name: string
  baseUrl: string
  projectId: string
}

function draftFromSource(source: ImageSourceStatus): ImageSourceFormDraft {
  const config = source.config
  return {
    sourceId: source.sourceId,
    providerId: source.providerId,
    name: source.name,
    baseUrl: config !== null && 'baseUrl' in config ? (config.baseUrl ?? '') : '',
    projectId: config?.providerId === 'google-vertex' ? config.projectId : ''
  }
}

function sourceDraftInput(draft: ImageSourceFormDraft): ImageSourceDraft {
  const name = draft.name.trim()
  if (draft.providerId === 'google-vertex') {
    return { providerId: draft.providerId, name, projectId: draft.projectId.trim() }
  }
  if (draft.providerId === 'openai' || draft.providerId === 'xai') {
    const baseUrl = draft.baseUrl.trim()
    return { providerId: draft.providerId, name, ...(baseUrl === '' ? {} : { baseUrl }) }
  }
  return { providerId: draft.providerId, name }
}

function imageSourceLogoId(source: {
  providerId: ImageProviderId
  name: string
  baseUrl: string
}): string | null {
  if (source.baseUrl === '') return transportLogoIds[source.providerId]
  return (
    resolveModelsDevProviderLogoId({
      providerId: '',
      name: source.name,
      baseUrl: source.baseUrl
    }) ?? transportLogoIds[source.providerId]
  )
}

export function selectionKey(selection: ImageModelSelection): string {
  return JSON.stringify([selection.sourceId, selection.modelId])
}

export function parseSelectionKey(value: string): ImageModelSelection {
  const [sourceId, modelId] = JSON.parse(value) as [string, string]
  return { sourceId, modelId }
}

/** Enabled models of authenticated sources, grouped for image model selectors. */
export function selectableImageModels(
  catalog: ProviderSettingsSnapshot['imageCatalog']
): Array<{ source: ImageSourceStatus; models: ImageSourceStatus['models'] }> {
  return catalog.sources
    .filter((source) => source.available)
    .map((source) => ({ source, models: source.models.filter((model) => model.enabled) }))
    .filter((group) => group.models.length > 0)
}

export function ImageProviderWorkspace({
  snapshot,
  closeAction,
  onSnapshotChange,
  onError
}: ProviderSettingsWorkspaceProps): React.JSX.Element {
  const catalog = snapshot.imageCatalog
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    catalog.defaultSelection?.sourceId ?? catalog.sources[0]?.sourceId ?? null
  )
  const selectedSource = catalog.sources.find((source) => source.sourceId === selectedSourceId)
  const [draft, setDraft] = useState<ImageSourceFormDraft | null>(
    selectedSource === undefined ? null : draftFromSource(selectedSource)
  )
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<ProviderConnectionTestResult | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTransport, setNewTransport] = useState<ImageProviderId>('openai')
  const [modelDialog, setModelDialog] = useState<{
    open: boolean
    initial: ImageModelDefinition | null
  }>({ open: false, initial: null })
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (selectedSource !== undefined) setDraft(draftFromSource(selectedSource))
    setApiKey('')
    setMessage(null)
  }, [selectedSource])

  const run = async <T,>(
    label: string,
    operation: () => Promise<T>,
    failure: string
  ): Promise<T | undefined> => {
    setBusy(label)
    try {
      return await operation()
    } catch (err) {
      reportRendererOperationError(err, `image-provider-settings.${label}`)
      onError(failure)
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const unsaved =
    draft !== null &&
    (selectedSource === undefined ||
      JSON.stringify(sourceDraftInput(draft)) !==
        JSON.stringify(sourceDraftInput(draftFromSource(selectedSource))) ||
      apiKey.trim() !== '')
  const vertex = draft?.providerId === 'google-vertex'

  const save = async (): Promise<void> => {
    if (draft === null) return
    const previousIds = new Set(catalog.sources.map((source) => source.sourceId))
    const next = await run(
      'save',
      () =>
        window.desktop.providers.saveImageSource({
          ...(draft.sourceId === undefined ? {} : { sourceId: draft.sourceId }),
          source: sourceDraftInput(draft),
          ...(vertex || apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() })
        }),
      'The image source was not saved.'
    )
    if (next === undefined) return
    onSnapshotChange(next)
    setApiKey('')
    if (draft.sourceId === undefined) {
      const created = next.imageCatalog.sources.find((source) => !previousIds.has(source.sourceId))
      setSelectedSourceId(created?.sourceId ?? null)
    }
  }

  const testConnection = async (): Promise<void> => {
    if (selectedSource === undefined) return
    const result = await run(
      'test',
      () => window.desktop.providers.testImageSource({ sourceId: selectedSource.sourceId }),
      'The image source connection test could not be completed.'
    )
    if (result !== undefined) setMessage(result)
  }

  const updateSnapshot = async (
    label: string,
    operation: () => Promise<ProviderSettingsSnapshot>,
    failure: string
  ): Promise<void> => {
    const next = await run(label, operation, failure)
    if (next !== undefined) onSnapshotChange(next)
  }

  const removeSource = async (): Promise<void> => {
    if (selectedSource === undefined) return
    const next = await run(
      'remove',
      () => window.desktop.providers.removeImageSource({ sourceId: selectedSource.sourceId }),
      'The image source could not be removed.'
    )
    setConfirmRemove(false)
    if (next === undefined) return
    onSnapshotChange(next)
    setSelectedSourceId(next.imageCatalog.sources[0]?.sourceId ?? null)
    if (next.imageCatalog.sources.length === 0) setDraft(null)
  }

  const beginAddSource = (): void => {
    setSelectedSourceId(null)
    setDraft({
      providerId: newTransport,
      name: newName.trim(),
      baseUrl: '',
      projectId: ''
    })
    setApiKey('')
    setMessage(null)
    setAddOpen(false)
    setNewName('')
  }

  const defaultValue =
    catalog.defaultSelection === null ? undefined : selectionKey(catalog.defaultSelection)
  const groups = selectableImageModels(catalog)

  return (
    <>
      <div className='grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden'>
        <section className='flex min-h-0 flex-col border-r'>
          <div className='flex flex-col gap-3 border-b p-4'>
            <h2 className='font-semibold'>Image sources</h2>
            <Field>
              <FieldLabel htmlFor='image-default-model'>Default image model</FieldLabel>
              <Select
                value={defaultValue}
                disabled={busy !== null || groups.length === 0}
                onValueChange={(value) =>
                  void updateSnapshot(
                    'default',
                    () => window.desktop.providers.setImageDefault(parseSelectionKey(value)),
                    'The default image model could not be changed.'
                  )
                }
              >
                <SelectTrigger id='image-default-model'>
                  <SelectValue placeholder='Choose a model' />
                </SelectTrigger>
                <SelectContent>
                  {groups.map(({ source, models }) => (
                    <SelectGroup key={source.sourceId}>
                      <SelectLabel>{source.name}</SelectLabel>
                      {models.map((model) => (
                        <SelectItem
                          key={model.id}
                          value={selectionKey({ sourceId: source.sourceId, modelId: model.id })}
                        >
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Conversations can override it. Requests never fall back to another model.
              </FieldDescription>
            </Field>
          </div>
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col gap-1 p-2' data-testid='image-source-list'>
              {catalog.sources.map((source) => (
                <Button
                  key={source.sourceId}
                  data-image-source-id={source.sourceId}
                  variant={source.sourceId === selectedSourceId ? 'secondary' : 'ghost'}
                  className='h-auto min-w-0 justify-start px-3 py-2'
                  onClick={() => setSelectedSourceId(source.sourceId)}
                >
                  <ProviderLogo
                    logoId={imageSourceLogoId(draftFromSource(source))}
                    name={source.name}
                  />
                  <span className='min-w-0 flex-1 text-left'>
                    <span className='block truncate'>{source.name}</span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {source.available
                        ? `${source.label} · ${source.models.filter((model) => model.enabled).length} enabled`
                        : `${source.label} · not connected`}
                    </span>
                  </span>
                  {catalog.defaultSelection?.sourceId === source.sourceId ? (
                    <Check aria-label='Default source' className='shrink-0' />
                  ) : null}
                </Button>
              ))}
            </div>
          </ScrollArea>
          <div className='border-t p-3'>
            <Button className='w-full' variant='outline' onClick={() => setAddOpen(true)}>
              <Plus data-icon='inline-start' /> Add source
            </Button>
          </div>
        </section>

        <section className='flex min-h-0 min-w-0 flex-col'>
          {draft === null ? (
            <>
              <div className='flex justify-end p-5 pb-0 lg:p-7 lg:pb-0'>{closeAction}</div>
              <Empty className='h-full flex-1 border-0'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <ImageIcon />
                  </EmptyMedia>
                  <EmptyTitle>No image source selected</EmptyTitle>
                  <EmptyDescription>
                    Add a Gemini, Vertex AI, OpenAI-compatible, or xAI source to generate images.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant='outline' onClick={() => setAddOpen(true)}>
                    <Plus data-icon='inline-start' /> Add source
                  </Button>
                </EmptyContent>
              </Empty>
            </>
          ) : (
            <ScrollArea className='h-full'>
              <div className='flex min-w-0 flex-col gap-6 p-5 lg:p-7'>
                <header className='flex flex-wrap items-center gap-3'>
                  <ProviderLogo logoId={imageSourceLogoId(draft)} name={draft.name} size='lg' />
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='truncate text-xl font-semibold'>
                        {draft.name.trim() || 'New image source'}
                      </h2>
                      <Badge variant='outline'>{IMAGE_TRANSPORT_LABELS[draft.providerId]}</Badge>
                    </div>
                    <p className='text-sm text-muted-foreground'>
                      {selectedSource === undefined
                        ? 'Not saved'
                        : selectedSource.available
                          ? 'Connected'
                          : (selectedSource.issues[0] ?? 'Not connected')}
                    </p>
                  </div>
                  <div className='flex shrink-0 items-center gap-2'>
                    {unsaved && selectedSource !== undefined ? (
                      <Badge variant='secondary'>Unsaved changes</Badge>
                    ) : null}
                    <Button
                      disabled={busy !== null || !unsaved || draft.name.trim() === ''}
                      onClick={() => void save()}
                    >
                      {busy === 'save' ? <Spinner data-icon='inline-start' /> : null}
                      {selectedSource === undefined ? 'Save source' : 'Save changes'}
                    </Button>
                  </div>
                  {closeAction}
                </header>

                {snapshot.credentialBackend.warning && !vertex ? (
                  <Alert variant='destructive'>
                    <ShieldAlert />
                    <AlertTitle>Secure credential storage unavailable</AlertTitle>
                    <AlertDescription>{snapshot.credentialBackend.warning}</AlertDescription>
                  </Alert>
                ) : null}

                {message ? (
                  <Alert variant={message.ok ? 'default' : 'destructive'}>
                    {message.ok ? <CheckCircle2 /> : <AlertCircle />}
                    <AlertTitle>{message.ok ? 'Connected' : 'Connection failed'}</AlertTitle>
                    <AlertDescription>
                      {message.message} ({message.durationMs} ms)
                    </AlertDescription>
                  </Alert>
                ) : null}

                <FieldGroup>
                  <ConfigField label='Source name'>
                    <Input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </ConfigField>
                  {draft.providerId === 'openai' || draft.providerId === 'xai' ? (
                    <ConfigField
                      label='Base URL'
                      description='Leave empty for the official endpoint. Changing the endpoint removes the stored key.'
                    >
                      <Input
                        value={draft.baseUrl}
                        autoComplete='url'
                        placeholder={OFFICIAL_IMAGE_BASE_URLS[draft.providerId]}
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      />
                    </ConfigField>
                  ) : null}
                  {vertex ? (
                    <>
                      <ConfigField label='Google Cloud Project ID'>
                        <Input
                          value={draft.projectId}
                          autoComplete='off'
                          placeholder='my-google-cloud-project'
                          onChange={(event) =>
                            setDraft({ ...draft, projectId: event.target.value })
                          }
                        />
                      </ConfigField>
                      <Alert>
                        <ShieldAlert />
                        <AlertTitle>Application Default Credentials</AlertTitle>
                        <AlertDescription>
                          Uses the local Google Cloud ADC account in the global location. Run gcloud
                          auth application-default login on this computer, enable Vertex AI for the
                          project, and grant that identity roles/aiplatform.user. No Google
                          credential is saved by WriteLLM.
                        </AlertDescription>
                      </Alert>
                    </>
                  ) : (
                    <ConfigField label='API key'>
                      <Input
                        type='password'
                        value={apiKey}
                        autoComplete='new-password'
                        placeholder={
                          selectedSource?.configured
                            ? 'Stored — enter a new value to replace'
                            : 'Required'
                        }
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </ConfigField>
                  )}
                </FieldGroup>

                {selectedSource !== undefined ? (
                  <>
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        variant='outline'
                        disabled={busy !== null || selectedSource.config === null}
                        onClick={() => void testConnection()}
                      >
                        {busy === 'test' ? <Spinner data-icon='inline-start' /> : null}
                        Test connection
                      </Button>
                    </div>

                    <Separator />
                    <section className='flex min-w-0 flex-col gap-4'>
                      <div className='flex flex-wrap items-end gap-3'>
                        <div className='min-w-0 flex-1'>
                          <h3 className='font-semibold'>Models</h3>
                          <p className='text-sm text-muted-foreground'>
                            Built-in models for {selectedSource.label}, plus model IDs you add.
                          </p>
                        </div>
                        <Button
                          variant='outline'
                          disabled={busy !== null}
                          onClick={() => setModelDialog({ open: true, initial: null })}
                        >
                          <Plus data-icon='inline-start' /> Add model
                        </Button>
                      </div>
                      <div className='flex min-w-0 flex-col divide-y rounded-md border'>
                        {selectedSource.models.map((model) => {
                          const isDefault =
                            catalog.defaultSelection?.sourceId === selectedSource.sourceId &&
                            catalog.defaultSelection.modelId === model.id
                          return (
                            <div
                              key={model.id}
                              className='flex min-w-0 flex-wrap items-center gap-3 px-3 py-3'
                            >
                              <Switch
                                checked={model.enabled}
                                disabled={busy !== null}
                                aria-label={`Enable ${model.name}`}
                                onCheckedChange={(enabled) =>
                                  void updateSnapshot(
                                    'model-enabled',
                                    () =>
                                      window.desktop.providers.setImageModelEnabled({
                                        sourceId: selectedSource.sourceId,
                                        modelId: model.id,
                                        enabled
                                      }),
                                    'The image model could not be updated.'
                                  )
                                }
                              />
                              <div className='min-w-48 flex-1'>
                                <div className='flex min-w-0 flex-wrap items-center gap-2'>
                                  <span className='truncate text-sm font-medium'>{model.name}</span>
                                  {model.source === 'manual' ? (
                                    <Badge variant='outline'>manual</Badge>
                                  ) : null}
                                </div>
                                <div className='truncate text-xs text-muted-foreground'>
                                  {model.id} · {model.imageSizes.join(', ')}
                                </div>
                              </div>
                              <Button
                                size='icon-sm'
                                variant={isDefault ? 'secondary' : 'ghost'}
                                aria-label={`Set ${model.name} as default`}
                                disabled={
                                  busy !== null || !model.enabled || !selectedSource.available
                                }
                                onClick={() =>
                                  void updateSnapshot(
                                    'default',
                                    () =>
                                      window.desktop.providers.setImageDefault({
                                        sourceId: selectedSource.sourceId,
                                        modelId: model.id
                                      }),
                                    'The default image model could not be changed.'
                                  )
                                }
                              >
                                {isDefault ? <Check /> : <Star />}
                              </Button>
                              {model.source === 'manual' ? (
                                <>
                                  <Button
                                    size='icon-sm'
                                    variant='ghost'
                                    aria-label={`Edit ${model.name}`}
                                    onClick={() =>
                                      setModelDialog({
                                        open: true,
                                        initial: {
                                          id: model.id,
                                          name: model.name,
                                          imageSizes: model.imageSizes
                                        }
                                      })
                                    }
                                  >
                                    <ChevronRight />
                                  </Button>
                                  <Button
                                    size='icon-sm'
                                    variant='ghost'
                                    aria-label={`Remove ${model.name}`}
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void updateSnapshot(
                                        'remove-model',
                                        () =>
                                          window.desktop.providers.removeImageManualModel({
                                            sourceId: selectedSource.sourceId,
                                            modelId: model.id
                                          }),
                                        'The image model could not be removed.'
                                      )
                                    }
                                  >
                                    <Trash2 />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </section>

                    <Separator />
                    <div className='flex justify-end'>
                      <Button
                        variant='destructive'
                        disabled={busy !== null}
                        onClick={() => setConfirmRemove(true)}
                      >
                        <Trash2 data-icon='inline-start' /> Remove source
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </ScrollArea>
          )}
        </section>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add image source</DialogTitle>
            <DialogDescription>
              Choose a transport and a display name. Endpoint and credentials are configured next.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <ConfigField label='Source name'>
              <Input
                value={newName}
                placeholder='My image gateway'
                onChange={(event) => setNewName(event.target.value)}
              />
            </ConfigField>
            <Field>
              <FieldLabel htmlFor='image-source-transport'>Source type</FieldLabel>
              <Select
                value={newTransport}
                onValueChange={(value) => setNewTransport(value as ImageProviderId)}
              >
                <SelectTrigger id='image-source-transport'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {IMAGE_TRANSPORTS.map((transport) => (
                      <SelectItem key={transport} value={transport}>
                        {IMAGE_TRANSPORT_LABELS[transport]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant='outline'>Cancel</Button>
            </DialogClose>
            <Button disabled={newName.trim() === ''} onClick={beginAddSource}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageModelDialog
        open={modelDialog.open}
        initial={modelDialog.initial}
        busy={busy !== null}
        onOpenChange={(open) => setModelDialog((current) => ({ ...current, open }))}
        onSave={async (model) => {
          if (selectedSource === undefined) return
          const next = await run(
            'save-model',
            () =>
              window.desktop.providers.saveImageManualModel({
                sourceId: selectedSource.sourceId,
                model
              }),
            'The image model was not saved.'
          )
          if (next === undefined) return
          onSnapshotChange(next)
          setModelDialog({ open: false, initial: null })
        }}
      />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedSource?.name ?? 'image source'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedSource?.providerId === 'google-vertex'
                ? 'Its project configuration and models are removed. Local ADC files are not changed.'
                : 'Its encrypted credential and models are removed.'}{' '}
              If it provides the default image model, image generation stops until another default
              is chosen. Conversations that selected it fail until they choose another model.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={() => void removeSource()}>
              {busy === 'remove' ? <Spinner data-icon='inline-start' /> : null}
              Remove source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ImageModelDialog({
  open,
  initial,
  busy,
  onOpenChange,
  onSave
}: {
  open: boolean
  initial: ImageModelDefinition | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSave: (model: ImageModelDefinition) => Promise<void>
}): React.JSX.Element {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [supports2K, setSupports2K] = useState(false)

  useEffect(() => {
    if (!open) return
    setId(initial?.id ?? '')
    setName(initial?.name ?? '')
    setSupports2K(initial?.imageSizes.includes('2K') ?? false)
  }, [initial, open])

  const imageSizes: ImageSize[] = supports2K ? ['1K', '2K'] : ['1K']
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial === null ? 'Add image model' : 'Edit image model'}</DialogTitle>
          <DialogDescription>
            Use the exact model ID accepted by this source. WriteLLM still validates the returned
            image.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <ConfigField label='Model ID'>
            <Input
              value={id}
              disabled={initial !== null}
              autoComplete='off'
              placeholder='provider-image-model'
              onChange={(event) => setId(event.target.value)}
            />
          </ConfigField>
          <ConfigField label='Display name'>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </ConfigField>
          <Field orientation='horizontal'>
            <Switch id='image-model-2k' checked={supports2K} onCheckedChange={setSupports2K} />
            <FieldLabel htmlFor='image-model-2k'>Supports 2K output</FieldLabel>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DialogClose>
          <Button
            disabled={busy || id.trim() === ''}
            onClick={() =>
              void onSave({ id: id.trim(), name: name.trim() || id.trim(), imageSizes })
            }
          >
            Save model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
