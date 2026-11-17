import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Ellipsis, Plus, Star, Trash2 } from 'lucide-react'
import {
  type ProviderConnectionTestResult,
  type ProviderSettingsSnapshot,
  type PurposeModelDraft,
  type PurposeModelSelection,
  type PurposeModelStatus,
  type PurposeProviderRole,
  type PurposeSourceDraft,
  type PurposeSourceStatus,
  purposeSourceDraftSchema
} from '../../../../shared/contracts/providers'
import { resolveModelsDevProviderLogoId } from '../../../../shared/models-dev-provider-logos'
import { ProviderLogo } from '@/components/provider-logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { reportRendererOperationError } from '../../diagnostics'
import { DefaultModelSelector } from './default-model-selector'
import { ConfigField, type ProviderSettingsWorkspaceProps } from './provider-settings-common'
import { PurposeModelDialog } from './purpose-model-dialog'
import { purposeDefault, purposeModelLabel } from './purpose-model-label'
import { useSettingsDraft } from './settings-draft-guard'
import { SpeechModelDiscovery, testSpeechPurposeModel } from './speech-model-settings'
import { ModelCatalogRefresh } from './model-candidate-controls'

const providerInfo = {
  embedding: { providerId: 'openai-compatible', label: 'OpenAI compatible' },
  rerank: { providerId: 'cohere-compatible', label: 'Cohere compatible' },
  mineru: { providerId: 'mineru', label: 'MinerU' },
  speech: { providerId: 'openai-compatible', label: 'OpenAI compatible' }
} as const

function newSource(role: PurposeProviderRole): PurposeSourceDraft {
  return {
    role,
    providerId: providerInfo[role].providerId,
    name: role === 'mineru' ? 'MinerU' : '',
    baseUrl: role === 'mineru' ? 'https://mineru.net' : '',
    enabled: true,
    timeoutMs: role === 'mineru' ? 120_000 : 60_000,
    batchLimit: role === 'mineru' ? 200 : role === 'speech' ? 1 : 100,
    fileSizeLimitMb: role === 'mineru' ? 200 : null
  }
}

function sourceDraft(source: PurposeSourceStatus): PurposeSourceDraft {
  const { role, providerId, name, baseUrl, enabled, timeoutMs, batchLimit, fileSizeLimitMb } =
    source
  return { role, providerId, name, baseUrl, enabled, timeoutMs, batchLimit, fileSizeLimitMb }
}

function selectionKey({ sourceId, configId }: PurposeModelSelection) {
  return JSON.stringify([sourceId, configId])
}

const embeddingImpact =
  'Projects that use a different embedding configuration need an index update before they can use the new default.'

interface ActionConfirmation {
  title: string
  description: string
  label: string
  destructive?: boolean
  run: () => Promise<boolean>
}

export function PurposeProviderWorkspace({
  role,
  snapshot,
  closeAction,
  onSnapshotChange,
  onError
}: ProviderSettingsWorkspaceProps & { role: PurposeProviderRole }) {
  const catalog = snapshot.purposeCatalog[role]
  const {
    source: defaultSource,
    model: defaultModel,
    available: defaultAvailable
  } = purposeDefault(catalog)
  const [sourceId, setSourceId] = useState<string | null>(
    () => defaultSource?.sourceId ?? catalog.sources[0]?.sourceId ?? null
  )
  const source = catalog.sources.find((candidate) => candidate.sourceId === sourceId)
  const [draft, setDraft] = useState<PurposeSourceDraft | null>(() =>
    source ? sourceDraft(source) : null
  )
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [speechDiscoveryBusy, setSpeechDiscoveryBusy] = useState(false)
  const [defaultCleared, setDefaultCleared] = useState(false)
  const [modelEditor, setModelEditor] = useState<{ model: PurposeModelStatus | null } | null>(null)
  const [confirmation, setConfirmation] = useState<ActionConfirmation | null>(null)
  const [probe, setProbe] = useState<{
    sourceId: string
    configId: string
    label: string
    result: ProviderConnectionTestResult
  } | null>(null)
  const [cancelingSpeech, setCancelingSpeech] = useState(false)
  const speechProbeActive = useRef(false)
  const locked = busy !== null || speechDiscoveryBusy

  useEffect(
    () => () => {
      if (speechProbeActive.current) {
        void window.desktop.speech
          .cancelTest()
          .catch((err: unknown) =>
            reportRendererOperationError(err, 'purpose-provider-settings.cancel-test')
          )
      }
    },
    []
  )

  const dirty =
    draft !== null &&
    (source === undefined ||
      JSON.stringify(sourceDraft(source)) !== JSON.stringify(draft) ||
      apiKey.trim() !== '')
  const parsedSource = purposeSourceDraftSchema.safeParse(
    draft === null
      ? null
      : {
          ...draft,
          baseUrl: draft.baseUrl.trim()
        }
  )
  const testModel =
    source?.sourceId === defaultSource?.sourceId && defaultModel?.enabled
      ? defaultModel
      : source?.models.find((model) => model.enabled)
  const shownProbe = probe && probe.sourceId === source?.sourceId && !dirty ? probe : null

  function showSource(next: PurposeSourceStatus | undefined) {
    setSourceId(next?.sourceId ?? null)
    setDraft(next ? sourceDraft(next) : null)
    setApiKey('')
    setProbe(null)
  }

  async function run<T>(
    label: string,
    action: () => Promise<T>,
    error: string
  ): Promise<T | undefined> {
    if (locked) return undefined
    setBusy(label)
    try {
      return await action()
    } catch (err) {
      reportRendererOperationError(err, `purpose-provider-settings.${role}.${label}`)
      onError(error)
      return undefined
    } finally {
      setBusy(null)
    }
  }

  function applySnapshot(next: ProviderSettingsSnapshot, reportCleared = true) {
    const selection = next.purposeCatalog[role].defaultSelection
    if (selection !== null) setDefaultCleared(false)
    else if (reportCleared && catalog.defaultSelection !== null) setDefaultCleared(true)
    onSnapshotChange(next)
  }

  async function mutate(
    label: string,
    action: () => Promise<ProviderSettingsSnapshot>,
    error: string,
    reportCleared = true
  ): Promise<boolean> {
    const next = await run(label, action, error)
    if (!next) return false
    applySnapshot(next, reportCleared)
    return true
  }

  async function saveSource(): Promise<boolean> {
    if (!parsedSource.success || !dirty) {
      onError('Check the source name, URL, and connection limits.')
      return false
    }
    const previousIds = new Set(catalog.sources.map((item) => item.sourceId))
    const next = await run(
      'save-source',
      () =>
        window.desktop.providers.savePurposeSource({
          ...(source ? { sourceId: source.sourceId } : {}),
          source: parsedSource.data,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
        }),
      'The source could not be saved.'
    )
    if (!next) return false
    applySnapshot(next)
    showSource(
      next.purposeCatalog[role].sources.find((item) =>
        source ? item.sourceId === source.sourceId : !previousIds.has(item.sourceId)
      )
    )
    return true
  }

  const requestLeave = useSettingsDraft(dirty, saveSource, () => showSource(source))
  function beginAdd() {
    requestLeave(() => {
      showSource(undefined)
      setDraft(newSource(role))
    })
  }

  async function testConnection(model: PurposeModelStatus): Promise<void> {
    if (!source || locked || dirty) return
    const selection = { sourceId: source.sourceId, configId: model.configId }
    setProbe(null)
    if (role === 'speech') speechProbeActive.current = true
    try {
      const result = await run(
        'test',
        () =>
          role === 'speech'
            ? testSpeechPurposeModel(selection)
            : window.desktop.providers.testPurposeModel({ role, ...selection }),
        'The connection test could not be completed.'
      )
      if (result) setProbe({ ...selection, label: purposeModelLabel(role, model), result })
    } finally {
      speechProbeActive.current = false
      setCancelingSpeech(false)
    }
  }

  async function cancelSpeechTest(): Promise<void> {
    setCancelingSpeech(true)
    try {
      await window.desktop.speech.cancelTest()
    } catch (err) {
      reportRendererOperationError(err, 'purpose-provider-settings.cancel-test')
      onError('The speech connection test could not be canceled.')
      setCancelingSpeech(false)
    }
  }

  function changeDefault(selection: PurposeModelSelection | null) {
    if (
      selection?.sourceId === catalog.defaultSelection?.sourceId &&
      selection?.configId === catalog.defaultSelection?.configId
    )
      return
    const apply = () =>
      mutate(
        'set-default',
        () => window.desktop.providers.setPurposeDefault({ role, selection }),
        'The default model could not be changed.',
        false
      )
    if (role === 'embedding') {
      setConfirmation({
        title: 'Change the default embedding model?',
        description:
          selection === null
            ? 'New indexing will require an embedding default. Existing index data is kept.'
            : embeddingImpact,
        label: 'Change default',
        run: apply
      })
    } else void apply()
  }

  async function saveModel(model: PurposeModelDraft): Promise<boolean> {
    if (!source || !modelEditor) return false
    const saved = await mutate(
      'save-model',
      () =>
        window.desktop.providers.savePurposeModel({
          role,
          sourceId: source.sourceId,
          ...(modelEditor.model ? { configId: modelEditor.model.configId } : {}),
          model
        }),
      'The model could not be saved. Check its configuration and whether it already exists.'
    )
    if (saved) {
      setModelEditor(null)
      setProbe(null)
    }
    return saved
  }

  function disableOrEnable(model: PurposeModelStatus, enabled: boolean) {
    if (!source) return
    const apply = async () => {
      const updated = await mutate(
        'model-enabled',
        () =>
          window.desktop.providers.setPurposeModelEnabled({
            role,
            sourceId: source.sourceId,
            configId: model.configId,
            enabled
          }),
        'The model could not be updated.'
      )
      if (updated && !enabled && probe?.configId === model.configId) setProbe(null)
      return updated
    }
    if (
      role === 'embedding' &&
      !enabled &&
      model.configId === defaultModel?.configId &&
      source.sourceId === defaultSource?.sourceId
    ) {
      setConfirmation({
        title: 'Disable the default embedding model?',
        description:
          'The embedding default will be cleared. New indexing will require an embedding default.',
        label: 'Disable model',
        run: apply
      })
    } else void apply()
  }

  function confirmRemoveModel(model: PurposeModelStatus) {
    if (!source) return
    const removesDefault =
      model.configId === defaultModel?.configId && source.sourceId === defaultSource?.sourceId
    setConfirmation({
      title: `Remove ${purposeModelLabel(role, model)}?`,
      description: removesDefault
        ? 'Removing this model also clears the default.'
        : 'This removes the saved model configuration.',
      label: 'Remove model',
      destructive: true,
      run: async () => {
        const removed = await mutate(
          'remove-model',
          () =>
            window.desktop.providers.removePurposeModel({
              role,
              sourceId: source.sourceId,
              configId: model.configId
            }),
          'The model could not be removed.'
        )
        if (removed && probe?.configId === model.configId) setProbe(null)
        return removed
      }
    })
  }

  function confirmRemoveSource() {
    if (!source) return
    setConfirmation({
      title: `Remove ${source.name}?`,
      description:
        source.sourceId === defaultSource?.sourceId
          ? 'This removes the source, its models, and its saved credential. The default will be cleared.'
          : 'This removes the source, its models, and its saved credential.',
      label: 'Remove source',
      destructive: true,
      run: async () => {
        const next = await run(
          'remove-source',
          () =>
            window.desktop.providers.removePurposeSource({
              role,
              sourceId: source.sourceId
            }),
          'The source could not be removed.'
        )
        if (!next) return false
        applySnapshot(next)
        showSource(next.purposeCatalog[role].sources[0])
        return true
      }
    })
  }

  const choices = new Map<string, PurposeModelSelection>()
  const groups = catalog.sources
    .filter((item) => item.available && item.enabled)
    .flatMap((item) => {
      const models = item.models
        .filter((model) => model.enabled)
        .map((model) => {
          const selection = { sourceId: item.sourceId, configId: model.configId }
          const value = selectionKey(selection)
          choices.set(value, selection)
          return { value, label: purposeModelLabel(role, model), keywords: [model.modelId] }
        })
      return models.length ? [{ id: item.sourceId, label: item.name, models }] : []
    })
  const selected = catalog.defaultSelection
  const unavailable =
    selected && !defaultAvailable
      ? {
          label: `${defaultSource?.name ?? selected.sourceId} · ${defaultModel ? purposeModelLabel(role, defaultModel) : selected.configId}`,
          reason: defaultSource?.issues[0] ?? 'The selected source or model is unavailable.'
        }
      : undefined

  return (
    <>
      <div className='grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden'>
        <section className='flex min-h-0 min-w-0 flex-col border-r'>
          <div className='flex flex-col gap-2 border-b p-4'>
            <DefaultModelSelector
              id={`${role}-default-model`}
              groups={groups}
              value={selected ? selectionKey(selected) : null}
              unavailable={unavailable}
              disabled={locked}
              onValueChange={(value) => {
                const selection = value === null ? null : choices.get(value)
                if (selection !== undefined) changeDefault(selection)
              }}
            />
            {defaultCleared && selected === null ? (
              <p role='status' className='text-sm text-muted-foreground'>
                Default model cleared.
              </p>
            ) : null}
          </div>
          <h3 className='px-4 pt-3 text-sm font-medium'>Sources</h3>
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col gap-1 p-2' data-testid={`${role}-source-list`}>
              {catalog.sources.map((item) => (
                <Button
                  key={item.sourceId}
                  variant={sourceId === item.sourceId ? 'secondary' : 'ghost'}
                  disabled={locked}
                  className='w-full justify-start'
                  onClick={() => {
                    if (item.sourceId !== sourceId) requestLeave(() => showSource(item))
                  }}
                >
                  <ProviderLogo
                    name={item.name}
                    logoId={resolveModelsDevProviderLogoId({
                      name: item.name,
                      providerId: item.providerId,
                      baseUrl: item.baseUrl
                    })}
                  />
                  <span className='min-w-0 flex-1 truncate text-left'>{item.name}</span>
                  {item.sourceId === selected?.sourceId ? (
                    <Check aria-label='Default source' />
                  ) : null}
                </Button>
              ))}
            </div>
          </ScrollArea>
          <div className='border-t p-3'>
            <Button className='w-full' variant='outline' disabled={locked} onClick={beginAdd}>
              <Plus data-icon='inline-start' /> Add source
            </Button>
          </div>
        </section>
        <section className='min-h-0 min-w-0'>
          {draft === null ? (
            <>
              <div className='flex justify-end p-5 pb-0'>{closeAction}</div>
              <Empty className='border-0'>
                <EmptyHeader>
                  <EmptyTitle>No source selected</EmptyTitle>
                </EmptyHeader>
              </Empty>
            </>
          ) : (
            <ScrollArea className='h-full'>
              <div className='flex min-w-0 flex-col gap-6 p-5 lg:p-7'>
                <header className='flex min-w-0 flex-wrap items-center gap-3'>
                  <h2 className='min-w-0 flex-1 truncate text-xl font-semibold'>
                    {draft.name.trim() || 'New source'}
                  </h2>
                  <Button
                    disabled={locked || !dirty || !parsedSource.success}
                    onClick={() => void saveSource()}
                  >
                    {busy === 'save-source' ? <Spinner data-icon='inline-start' /> : null}
                    {source ? 'Save changes' : 'Save source'}
                  </Button>
                  {closeAction}
                </header>
                {snapshot.credentialBackend.warning ? (
                  <Alert variant='destructive'>
                    <AlertCircle />
                    <AlertTitle>Secure credential storage unavailable</AlertTitle>
                    <AlertDescription>{snapshot.credentialBackend.warning}</AlertDescription>
                  </Alert>
                ) : null}
                <section className='flex flex-col gap-4' aria-label='Connection'>
                  <h3 className='font-medium'>Connection</h3>
                  <p className='text-sm text-muted-foreground'>{providerInfo[role].label}</p>
                  {source?.issues[0] ? (
                    <p className='text-sm text-muted-foreground'>{source.issues[0]}</p>
                  ) : null}
                  <FieldGroup>
                    {source ? (
                      <Field orientation='horizontal'>
                        <Switch
                          id={`${role}-source-enabled`}
                          checked={draft.enabled}
                          disabled={locked}
                          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                        />
                        <FieldLabel htmlFor={`${role}-source-enabled`}>Enable source</FieldLabel>
                      </Field>
                    ) : null}
                    <ConfigField label='Source name'>
                      <Input
                        value={draft.name}
                        disabled={locked}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </ConfigField>
                    <ConfigField label='Base URL'>
                      <Input
                        value={draft.baseUrl}
                        disabled={locked}
                        autoComplete='url'
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      />
                    </ConfigField>
                    <ConfigField label={role === 'mineru' ? 'API token' : 'API key'}>
                      <Input
                        value={apiKey}
                        disabled={locked}
                        type='password'
                        autoComplete='new-password'
                        placeholder={source?.authConfigured ? 'Stored' : undefined}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </ConfigField>
                  </FieldGroup>
                  {source && source.sourceId === defaultSource?.sourceId && !draft.enabled ? (
                    <p className='text-sm text-muted-foreground'>
                      Saving a disabled source will clear its default model.
                    </p>
                  ) : null}
                  {role === 'embedding' &&
                  source &&
                  source.sourceId === defaultSource?.sourceId &&
                  parsedSource.success &&
                  source.baseUrl !== parsedSource.data.baseUrl ? (
                    <p className='text-sm text-muted-foreground'>{embeddingImpact}</p>
                  ) : null}
                  <details>
                    <summary className='cursor-pointer text-sm font-medium'>
                      Connection limits
                    </summary>
                    <FieldGroup className='mt-3'>
                      <ConfigField label='Request timeout (milliseconds)'>
                        <Input
                          type='number'
                          value={draft.timeoutMs || ''}
                          disabled={locked}
                          onChange={(event) =>
                            setDraft({ ...draft, timeoutMs: Number(event.target.value) })
                          }
                        />
                      </ConfigField>
                      {role !== 'speech' ? (
                        <ConfigField label='Batch limit'>
                          <Input
                            type='number'
                            value={draft.batchLimit || ''}
                            disabled={locked}
                            onChange={(event) =>
                              setDraft({ ...draft, batchLimit: Number(event.target.value) })
                            }
                          />
                        </ConfigField>
                      ) : null}
                      {role === 'mineru' ? (
                        <ConfigField label='File size limit (MB)'>
                          <Input
                            type='number'
                            value={draft.fileSizeLimitMb ?? ''}
                            disabled={locked}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                fileSizeLimitMb: event.target.value
                                  ? Number(event.target.value)
                                  : null
                              })
                            }
                          />
                        </ConfigField>
                      ) : null}
                    </FieldGroup>
                  </details>
                  {source ? (
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        variant='outline'
                        disabled={locked || dirty || !source.available || !testModel}
                        onClick={() => {
                          if (testModel) void testConnection(testModel)
                        }}
                      >
                        {busy === 'test' ? <Spinner data-icon='inline-start' /> : null} Test
                        connection
                      </Button>
                      {role === 'speech' && busy === 'test' ? (
                        <Button
                          variant='outline'
                          disabled={cancelingSpeech}
                          onClick={() => void cancelSpeechTest()}
                        >
                          Cancel test
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {shownProbe ? (
                    <Alert role='status' variant={shownProbe.result.ok ? 'default' : 'destructive'}>
                      {shownProbe.result.ok ? <CheckCircle2 /> : <AlertCircle />}
                      <AlertTitle>Tested {shownProbe.label}</AlertTitle>
                      <AlertDescription>{shownProbe.result.message}</AlertDescription>
                    </Alert>
                  ) : null}
                </section>

                {source ? (
                  <>
                    <Separator />
                    <section className='flex min-w-0 flex-col gap-4' aria-label='Models'>
                      <div className='flex flex-wrap items-center gap-3'>
                        <h3 className='flex-1 font-medium'>Models</h3>
                        {role === 'speech' ? (
                          <SpeechModelDiscovery
                            sourceId={source.sourceId}
                            catalog={source.catalog}
                            disabled={locked || dirty || !source.available}
                            onBusyChange={setSpeechDiscoveryBusy}
                            onSnapshotChange={applySnapshot}
                            onError={onError}
                          />
                        ) : null}
                        {role === 'embedding' ? (
                          <ModelCatalogRefresh
                            candidates={source.modelCandidates}
                            catalog={source.catalog}
                            busy={busy === 'refresh-models'}
                            disabled={locked || dirty || !source.available}
                            onRefresh={() =>
                              void mutate(
                                'refresh-models',
                                () =>
                                  window.desktop.providers.refreshPurposeModels({
                                    role,
                                    sourceId: source.sourceId
                                  }),
                                'The model list could not be fetched.'
                              )
                            }
                          />
                        ) : null}
                        <Button
                          variant='outline'
                          disabled={locked || dirty}
                          onClick={() => setModelEditor({ model: null })}
                        >
                          <Plus data-icon='inline-start' /> Add model
                        </Button>
                      </div>
                      {source.models.length === 0 ? (
                        <p className='text-sm text-muted-foreground'>No models added.</p>
                      ) : (
                        <div className='divide-y rounded-md border'>
                          {source.models.map((model) => {
                            const label = purposeModelLabel(role, model)
                            const isDefault =
                              source.sourceId === selected?.sourceId &&
                              model.configId === selected.configId
                            return (
                              <div
                                key={model.configId}
                                className='flex min-w-0 items-center gap-3 p-3'
                              >
                                <Switch
                                  checked={model.enabled}
                                  disabled={locked || dirty}
                                  aria-label={`Enable ${label}`}
                                  onCheckedChange={(enabled) => disableOrEnable(model, enabled)}
                                />
                                <div className='min-w-0 flex-1'>
                                  <p className='truncate text-sm font-medium'>{label}</p>
                                  {model.embeddingDimension !== null ? (
                                    <p className='text-xs text-muted-foreground'>
                                      {model.embeddingDimension.toLocaleString()} dimensions
                                    </p>
                                  ) : null}
                                </div>
                                <Button
                                  size='icon-sm'
                                  variant={isDefault ? 'secondary' : 'ghost'}
                                  disabled={
                                    locked || !model.enabled || !source.available || !source.enabled
                                  }
                                  aria-label={`Set ${label} as default`}
                                  onClick={() =>
                                    changeDefault({
                                      sourceId: source.sourceId,
                                      configId: model.configId
                                    })
                                  }
                                >
                                  {isDefault ? <Check /> : <Star />}
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      size='icon-sm'
                                      variant='ghost'
                                      disabled={locked || dirty}
                                      aria-label={`Actions for ${label}`}
                                    >
                                      <Ellipsis />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align='end'>
                                    <DropdownMenuItem onSelect={() => setModelEditor({ model })}>
                                      Edit model
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={!model.enabled || !source.available}
                                      onSelect={() => void testConnection(model)}
                                    >
                                      Test connection
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant='destructive'
                                      onSelect={() => confirmRemoveModel(model)}
                                    >
                                      Remove model
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </section>
                    <Separator />
                    <div className='flex justify-end'>
                      <Button
                        variant='destructive'
                        disabled={locked || dirty}
                        onClick={confirmRemoveSource}
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
      {source && modelEditor ? (
        <PurposeModelDialog
          source={source}
          model={modelEditor.model}
          busy={busy === 'save-model'}
          onClose={() => setModelEditor(null)}
          onSave={(model) => {
            if (
              role === 'embedding' &&
              source.sourceId === defaultSource?.sourceId &&
              modelEditor.model?.configId === defaultModel?.configId
            ) {
              setConfirmation({
                title: 'Change the default embedding model?',
                description: embeddingImpact,
                label: 'Change default',
                run: () => saveModel(model)
              })
            } else void saveModel(model)
          }}
        />
      ) : null}
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !locked) setConfirmation(null)
        }}
      >
        {confirmation ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={locked}>Cancel</AlertDialogCancel>
              <Button
                variant={confirmation.destructive ? 'destructive' : 'default'}
                disabled={locked}
                onClick={async () => {
                  if (await confirmation.run()) setConfirmation(null)
                }}
              >
                {locked ? <Spinner data-icon='inline-start' /> : null}
                {confirmation.label}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </>
  )
}
