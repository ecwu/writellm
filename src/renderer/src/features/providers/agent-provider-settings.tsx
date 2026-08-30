import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Trash2
} from 'lucide-react'
import type {
  AgentAuthInteractionEvent,
  AgentManualModel,
  AgentProviderPresetSummary,
  CustomAgentPiApi,
  PiApi,
  ProviderSettingsSnapshot
} from '../../../../shared/contracts/providers'
import { resolveModelsDevProviderLogoId } from '../../../../shared/models-dev-provider-logos'
import type { ModelsDevProviderLogoId } from '../../../../shared/models-dev-provider-logos'
import { ProviderLogo, ProviderLogoPicker } from '@/components/provider-logo'
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
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
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
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { orderEnabledAgentProvidersFirst } from './agent-provider-order'
import {
  ConfigField,
  customTransports,
  type ProviderSettingsWorkspaceProps
} from './provider-settings-common'
import { ManualModelDialog } from './manual-model-dialog'

export interface AgentDraft {
  presetId?: string
  name: string
  logoOverrideId: ModelsDevProviderLogoId | null
  baseUrl: string
  api: CustomAgentPiApi
  authMode: 'api_key' | 'none'
}

export function AgentProviderWorkspace({
  snapshot,
  closeAction,
  onSnapshotChange,
  onError
}: ProviderSettingsWorkspaceProps): React.JSX.Element {
  const orderedPresets = orderEnabledAgentProvidersFirst(snapshot.agentCatalog.presets)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    orderedPresets[0]?.presetId ?? null
  )
  const [providerSearch, setProviderSearch] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [addProviderOpen, setAddProviderOpen] = useState(false)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderApi, setNewProviderApi] = useState<CustomAgentPiApi>('openai-completions')
  const [manualModel, setManualModel] = useState<AgentManualModel | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [authFlowId, setAuthFlowId] = useState<string | null>(null)
  const [authEvent, setAuthEvent] = useState<AgentAuthInteractionEvent | null>(null)
  const [authValue, setAuthValue] = useState('')

  const selectedPreset =
    snapshot.agentCatalog.presets.find((preset) => preset.presetId === selectedPresetId) ?? null
  const savedAuthMode = selectedPreset?.authMethods.includes('none') ? 'none' : 'api_key'
  const providerHasUnsavedChanges =
    draft !== null &&
    (selectedPreset === null ||
      draft.name.trim() !== selectedPreset.name ||
      draft.logoOverrideId !== selectedPreset.logoOverrideId ||
      draft.baseUrl.trim() !== (selectedPreset.baseUrl ?? '') ||
      draft.authMode !== savedAuthMode ||
      apiKey.trim() !== '')
  const providerCanSave =
    draft !== null &&
    draft.name.trim() !== '' &&
    draft.baseUrl.trim() !== '' &&
    busy === null &&
    providerHasUnsavedChanges

  useEffect(() => {
    if (selectedPreset !== null) {
      setDraft({
        presetId: selectedPreset.presetId,
        name: selectedPreset.name,
        logoOverrideId: selectedPreset.logoOverrideId,
        baseUrl: selectedPreset.baseUrl ?? '',
        api: selectedPreset.api ?? 'openai-completions',
        authMode: selectedPreset.authMethods.includes('none') ? 'none' : 'api_key'
      })
      setApiKey('')
      setModelSearch('')
    }
  }, [selectedPreset])

  const providerDisplayName = (preset: AgentProviderPresetSummary): string =>
    preset.presetId === selectedPresetId && draft?.presetId === preset.presetId
      ? draft.name.trim() || preset.name
      : preset.name
  const draftAutomaticLogoId =
    draft === null
      ? null
      : resolveModelsDevProviderLogoId({
          providerId: selectedPreset?.providerId ?? 'writellm-custom:draft',
          name: draft.name,
          baseUrl: draft.baseUrl,
          logoOverrideId: null
        })
  const draftLogoId = draft?.logoOverrideId ?? draftAutomaticLogoId
  const providerDisplayLogoId = (preset: AgentProviderPresetSummary): string | null =>
    preset.presetId === selectedPresetId && draft?.presetId === preset.presetId
      ? draftLogoId
      : preset.logoId
  const presets = orderedPresets.filter((preset) =>
    `${providerDisplayName(preset)} ${preset.providerId}`
      .toLowerCase()
      .includes(providerSearch.toLowerCase())
  )
  const visibleModels = (selectedPreset?.models ?? []).filter((model) =>
    `${model.name} ${model.id} ${model.api}`.toLowerCase().includes(modelSearch.toLowerCase())
  )

  const updateSnapshot = (next: ProviderSettingsSnapshot): void => {
    onSnapshotChange(next)
  }

  const choosePreset = (presetId: string): void => {
    setSelectedPresetId(presetId)
    setMobileDetail(true)
  }

  const beginAddProvider = (): void => {
    if (newProviderName.trim() === '') return
    setSelectedPresetId(null)
    setDraft({
      name: newProviderName.trim(),
      logoOverrideId: null,
      baseUrl: '',
      api: newProviderApi,
      authMode: 'api_key'
    })
    setApiKey('')
    setAddProviderOpen(false)
    setNewProviderName('')
    setMobileDetail(true)
  }

  const savePreset = async (): Promise<void> => {
    if (draft === null || draft.baseUrl.trim() === '') return
    setBusy('save-preset')
    try {
      const next = await window.desktop.providers.saveAgentPreset({
        ...(draft.presetId === undefined ? {} : { presetId: draft.presetId }),
        name: draft.name,
        logoOverrideId: draft.logoOverrideId,
        baseUrl: draft.baseUrl,
        api: draft.api,
        authMode: draft.authMode,
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() })
      })
      updateSnapshot(next)
      const persisted =
        draft.presetId === undefined
          ? next.agentCatalog.presets.find(
              (preset) =>
                preset.kind === 'custom' &&
                preset.name === draft.name &&
                preset.baseUrl === draft.baseUrl
            )
          : next.agentCatalog.presets.find((preset) => preset.presetId === draft.presetId)
      setSelectedPresetId(persisted?.presetId ?? null)
      setApiKey('')
    } catch {
      onError('Custom Agent provider was not saved. Check its name, URL, and credential.')
    } finally {
      setBusy(null)
    }
  }

  const saveCredential = async (): Promise<void> => {
    if (selectedPreset === null || apiKey.trim() === '') return
    setBusy('credential')
    try {
      updateSnapshot(
        await window.desktop.providers.setAgentCredential({
          presetId: selectedPreset.presetId,
          apiKey: apiKey.trim()
        })
      )
      setApiKey('')
    } catch {
      onError('The Agent provider credential could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  const clearCredential = async (): Promise<void> => {
    if (selectedPreset === null) return
    setBusy('credential')
    try {
      updateSnapshot(
        await window.desktop.providers.clearAgentCredential({
          presetId: selectedPreset.presetId
        })
      )
    } catch {
      onError('The Agent provider credential could not be cleared.')
    } finally {
      setBusy(null)
    }
  }

  const refresh = async (): Promise<void> => {
    if (selectedPreset === null) return
    setBusy('refresh')
    try {
      updateSnapshot(
        await window.desktop.providers.refreshAgentPreset({
          presetId: selectedPreset.presetId
        })
      )
    } catch {
      onError('Model discovery failed. The last successful catalog was retained.')
      updateSnapshot(await window.desktop.providers.snapshot())
    } finally {
      setBusy(null)
    }
  }

  const toggleProvider = async (enabled: boolean): Promise<void> => {
    if (selectedPreset === null) return
    setBusy('provider-toggle')
    try {
      updateSnapshot(
        await window.desktop.providers.setAgentProviderEnabled({
          presetId: selectedPreset.presetId,
          enabled
        })
      )
    } catch {
      onError('Provider availability could not be changed.')
    } finally {
      setBusy(null)
    }
  }

  const toggleModel = async (modelId: string, enabled: boolean): Promise<void> => {
    if (selectedPreset === null) return
    setBusy(`model:${modelId}`)
    try {
      updateSnapshot(
        await window.desktop.providers.setAgentModelEnabled({
          presetId: selectedPreset.presetId,
          modelId,
          enabled
        })
      )
    } catch {
      onError('Model availability could not be changed.')
    } finally {
      setBusy(null)
    }
  }

  const setDefaultModel = async (modelId: string): Promise<void> => {
    if (selectedPreset === null) return
    setBusy(`default:${modelId}`)
    try {
      updateSnapshot(
        await window.desktop.providers.setAgentDefault({
          presetId: selectedPreset.presetId,
          modelId
        })
      )
    } catch {
      onError('Only an enabled, authenticated model can be the default.')
    } finally {
      setBusy(null)
    }
  }

  const saveManualModel = async (model: AgentManualModel): Promise<void> => {
    if (selectedPreset === null) return
    setBusy('manual-model')
    try {
      updateSnapshot(
        await window.desktop.providers.saveAgentManualModel({
          presetId: selectedPreset.presetId,
          model
        })
      )
      setManualOpen(false)
      setManualModel(null)
    } catch {
      onError('The manual model could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  const removeManualModel = async (modelId: string): Promise<void> => {
    if (selectedPreset === null) return
    setBusy(`model:${modelId}`)
    try {
      updateSnapshot(
        await window.desktop.providers.removeAgentManualModel({
          presetId: selectedPreset.presetId,
          modelId
        })
      )
    } catch {
      onError('The manual model could not be removed.')
    } finally {
      setBusy(null)
    }
  }

  const removeProvider = async (): Promise<void> => {
    if (selectedPreset === null) return
    setBusy('remove')
    try {
      const next = await window.desktop.providers.removeAgentPreset({
        presetId: selectedPreset.presetId
      })
      updateSnapshot(next)
      setSelectedPresetId(
        orderEnabledAgentProvidersFirst(next.agentCatalog.presets)[0]?.presetId ?? null
      )
      setConfirmRemove(false)
      setMobileDetail(false)
    } catch {
      onError('The Agent provider could not be removed.')
    } finally {
      setBusy(null)
    }
  }

  const login = async (): Promise<void> => {
    if (selectedPreset === null) return
    const flowId = globalThis.crypto.randomUUID()
    setAuthFlowId(flowId)
    setAuthEvent(null)
    setAuthValue('')
    setBusy('login')
    try {
      updateSnapshot(
        await window.desktop.providers.loginAgentPreset(
          { flowId, presetId: selectedPreset.presetId, type: 'oauth' },
          (event) => {
            setAuthEvent(event)
            if (event.kind === 'prompt') setAuthValue('')
          }
        )
      )
    } catch {
      onError('Provider sign-in did not complete.')
    } finally {
      setBusy(null)
      setAuthFlowId(null)
      setAuthEvent(null)
      setAuthValue('')
    }
  }

  return (
    <>
      <div className='grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)]'>
        <section
          className={cn('min-h-0 flex-col border-r', mobileDetail ? 'hidden lg:flex' : 'flex')}
        >
          <div className='flex flex-col gap-3 border-b p-4'>
            <div className='flex items-start gap-3'>
              <div className='min-w-0 flex-1'>
                <h2 className='font-semibold'>Agent providers</h2>
                <p className='text-xs text-muted-foreground'>Pi built-ins and custom endpoints.</p>
              </div>
              <div className='lg:hidden'>{closeAction}</div>
            </div>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                aria-label='Search Agent providers'
                value={providerSearch}
                placeholder='Search providers…'
                onChange={(event) => setProviderSearch(event.target.value)}
              />
            </InputGroup>
          </div>
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col gap-1 p-2' data-testid='agent-provider-list'>
              {presets.map((preset) => (
                <Button
                  key={preset.presetId}
                  data-agent-provider-preset-id={preset.presetId}
                  variant={preset.presetId === selectedPresetId ? 'secondary' : 'ghost'}
                  className='h-auto min-w-0 justify-start px-3 py-2'
                  onClick={() => choosePreset(preset.presetId)}
                >
                  <ProviderLogo
                    logoId={providerDisplayLogoId(preset)}
                    name={providerDisplayName(preset)}
                  />
                  <span className='min-w-0 flex-1 text-left'>
                    <span className='block truncate'>{providerDisplayName(preset)}</span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {preset.models.filter((model) => model.enabled).length} enabled
                    </span>
                  </span>
                  <Badge variant={preset.enabled ? 'default' : 'secondary'}>
                    {preset.enabled ? 'On' : 'Off'}
                  </Badge>
                </Button>
              ))}
            </div>
          </ScrollArea>
          <div className='border-t p-3'>
            <Button className='w-full' variant='outline' onClick={() => setAddProviderOpen(true)}>
              <Plus data-icon='inline-start' /> Add provider
            </Button>
          </div>
        </section>

        <section
          className={cn('min-h-0 min-w-0 flex-col', mobileDetail ? 'flex' : 'hidden lg:flex')}
        >
          {draft === null ? (
            <>
              <div className='flex justify-end p-5 pb-0 lg:p-7 lg:pb-0'>{closeAction}</div>
              <Empty className='h-full flex-1 border-0'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <Bot />
                  </EmptyMedia>
                  <EmptyTitle>Select a provider</EmptyTitle>
                  <EmptyDescription>
                    Choose a Pi provider or add a custom endpoint to manage its models.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant='outline' onClick={() => setAddProviderOpen(true)}>
                    <Plus data-icon='inline-start' /> Add provider
                  </Button>
                </EmptyContent>
              </Empty>
            </>
          ) : (
            <ScrollArea className='h-full'>
              <div className='flex min-w-0 flex-col gap-6 p-5 lg:p-7'>
                <header className='flex flex-wrap items-center gap-3'>
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    className='lg:hidden'
                    aria-label='Back to providers'
                    onClick={() => setMobileDetail(false)}
                  >
                    <ArrowLeft />
                  </Button>
                  <ProviderLogo
                    logoId={
                      selectedPreset?.kind === 'custom'
                        ? draftLogoId
                        : (selectedPreset?.logoId ?? null)
                    }
                    name={draft.name}
                    size='lg'
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='truncate text-xl font-semibold'>{draft.name}</h2>
                      <Badge variant='outline'>
                        {selectedPreset?.kind ?? 'custom'} · {draft.api}
                      </Badge>
                    </div>
                    <p className='text-sm text-muted-foreground'>
                      {selectedPreset?.authConfigured
                        ? `Connected${selectedPreset.authSource ? ` through ${selectedPreset.authSource}` : ''}`
                        : 'Not connected'}
                    </p>
                  </div>
                  {selectedPreset ? (
                    <Field orientation='horizontal' className='w-auto shrink-0'>
                      <FieldLabel htmlFor='agent-provider-enabled'>Enabled</FieldLabel>
                      <Switch
                        id='agent-provider-enabled'
                        checked={selectedPreset.enabled}
                        disabled={busy !== null}
                        onCheckedChange={(checked) => void toggleProvider(checked)}
                      />
                    </Field>
                  ) : null}
                  {selectedPreset?.kind === 'custom' || selectedPreset === null ? (
                    <div className='flex shrink-0 items-center gap-2'>
                      {providerHasUnsavedChanges ? (
                        <Badge variant='secondary'>Unsaved changes</Badge>
                      ) : null}
                      <Button disabled={!providerCanSave} onClick={() => void savePreset()}>
                        {busy === 'save-preset' ? <Spinner data-icon='inline-start' /> : null}
                        {selectedPreset === null ? 'Save provider' : 'Save changes'}
                      </Button>
                    </div>
                  ) : null}
                  {closeAction}
                </header>

                {snapshot.credentialBackend.warning ? (
                  <Alert variant='destructive'>
                    <ShieldAlert />
                    <AlertTitle>Secure credential storage unavailable</AlertTitle>
                    <AlertDescription>{snapshot.credentialBackend.warning}</AlertDescription>
                  </Alert>
                ) : null}

                <FieldGroup>
                  {selectedPreset?.kind === 'custom' || selectedPreset === null ? (
                    <>
                      <ConfigField label='Provider name'>
                        <Input
                          value={draft.name}
                          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        />
                      </ConfigField>
                      <ConfigField
                        label='Provider logo'
                        description='Uses a packaged models.dev logo. Automatic matching checks the endpoint and Provider name.'
                      >
                        <ProviderLogoPicker
                          value={draft.logoOverrideId}
                          automaticLogoId={draftAutomaticLogoId}
                          disabled={busy !== null}
                          onValueChange={(logoOverrideId) => setDraft({ ...draft, logoOverrideId })}
                        />
                      </ConfigField>
                      <ConfigField
                        label='Base URL'
                        description='Use HTTPS, or HTTP for localhost and 10.*, 100.*, 127.*, or 192.* IPv4 endpoints.'
                      >
                        <Input
                          value={draft.baseUrl}
                          autoComplete='url'
                          placeholder='https://api.example.com/v1'
                          onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                        />
                      </ConfigField>
                      <Field>
                        <FieldLabel>Authentication</FieldLabel>
                        <Select
                          value={draft.authMode}
                          onValueChange={(value) =>
                            setDraft({ ...draft, authMode: value as 'api_key' | 'none' })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value='api_key'>API key</SelectItem>
                              <SelectItem value='none'>Keyless</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    </>
                  ) : (
                    <Field>
                      <FieldTitle>Endpoint</FieldTitle>
                      <FieldDescription>
                        Managed by the pinned Pi provider. Add a custom provider to use another
                        endpoint.
                      </FieldDescription>
                    </Field>
                  )}

                  {draft.authMode === 'api_key' &&
                  (selectedPreset === null || selectedPreset.authMethods.includes('api_key')) ? (
                    <ConfigField label='API key'>
                      <Input
                        type='password'
                        value={apiKey}
                        autoComplete='new-password'
                        placeholder={
                          selectedPreset?.authConfigured
                            ? 'Stored — enter a new value to replace'
                            : 'Enter provider API key'
                        }
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </ConfigField>
                  ) : null}
                </FieldGroup>

                <div className='flex flex-wrap items-center gap-2'>
                  <div className='flex flex-wrap gap-2'>
                    {selectedPreset?.authMethods.includes('oauth') ? (
                      <Button
                        variant='outline'
                        disabled={busy !== null}
                        onClick={() => void login()}
                      >
                        {busy === 'login' ? <Spinner data-icon='inline-start' /> : <KeyRound />}
                        Sign in
                      </Button>
                    ) : null}
                    {selectedPreset?.authConfigured && draft.authMode !== 'none' ? (
                      <Button
                        variant='outline'
                        disabled={busy !== null}
                        onClick={() => void clearCredential()}
                      >
                        Disconnect
                      </Button>
                    ) : null}
                    {selectedPreset !== null &&
                    draft.authMode === 'api_key' &&
                    selectedPreset.authMethods.includes('api_key') ? (
                      <Button
                        variant='outline'
                        disabled={busy !== null || apiKey.trim() === ''}
                        onClick={() => void saveCredential()}
                      >
                        Save credential
                      </Button>
                    ) : null}
                  </div>
                </div>

                {selectedPreset ? (
                  <>
                    <Separator />
                    <section className='flex min-w-0 flex-col gap-4'>
                      <div className='flex flex-wrap items-end gap-3'>
                        <div className='min-w-0 flex-1'>
                          <h3 className='font-semibold'>Models</h3>
                          <p className='text-sm text-muted-foreground'>
                            {selectedPreset.models.length} models · {selectedPreset.catalogStatus}
                            {selectedPreset.checkedAt
                              ? ` · checked ${new Date(selectedPreset.checkedAt).toLocaleString()}`
                              : ''}
                          </p>
                        </div>
                        <Button
                          variant='outline'
                          disabled={busy !== null || !selectedPreset.canRefresh}
                          aria-label={`Fetch ${selectedPreset.name} models`}
                          onClick={() => void refresh()}
                        >
                          {busy === 'refresh' ? (
                            <Spinner data-icon='inline-start' />
                          ) : (
                            <RefreshCw data-icon='inline-start' />
                          )}
                          Fetch models
                        </Button>
                        <Button
                          variant='outline'
                          disabled={availableApis(selectedPreset).length === 0}
                          onClick={() => {
                            setManualModel(null)
                            setManualOpen(true)
                          }}
                        >
                          <Plus data-icon='inline-start' /> Add model
                        </Button>
                      </div>
                      <InputGroup>
                        <InputGroupAddon>
                          <Search />
                        </InputGroupAddon>
                        <InputGroupInput
                          aria-label='Search Agent models'
                          value={modelSearch}
                          placeholder='Search models…'
                          onChange={(event) => setModelSearch(event.target.value)}
                        />
                      </InputGroup>

                      {visibleModels.length === 0 ? (
                        <Empty className='min-h-52'>
                          <EmptyHeader>
                            <EmptyMedia variant='icon'>
                              <Bot />
                            </EmptyMedia>
                            <EmptyTitle>No models</EmptyTitle>
                            <EmptyDescription>
                              Fetch the provider catalog or add a manual model ID.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <div className='flex min-w-0 flex-col divide-y rounded-md border'>
                          {visibleModels.map((model) => {
                            const isDefault =
                              snapshot.agentCatalog.defaultSelection?.presetId ===
                                selectedPreset.presetId &&
                              snapshot.agentCatalog.defaultSelection.modelId === model.id
                            return (
                              <div
                                key={model.id}
                                className='flex min-w-0 flex-wrap items-center gap-3 px-3 py-3'
                              >
                                <Switch
                                  checked={model.enabled}
                                  disabled={busy !== null}
                                  aria-label={`Enable ${model.name}`}
                                  onCheckedChange={(checked) => void toggleModel(model.id, checked)}
                                />
                                <div className='min-w-48 flex-1'>
                                  <div className='flex min-w-0 flex-wrap items-center gap-2'>
                                    <span className='truncate text-sm font-medium'>
                                      {model.name}
                                    </span>
                                    <Badge variant='outline'>{model.source}</Badge>
                                    {model.reasoning ? (
                                      <Badge variant='secondary'>Reasoning</Badge>
                                    ) : null}
                                    {model.input.includes('image') ? (
                                      <Badge variant='secondary'>Vision</Badge>
                                    ) : null}
                                  </div>
                                  <div className='truncate text-xs text-muted-foreground'>
                                    {model.id} · {model.api} ·{' '}
                                    {model.contextWindow.toLocaleString()} context ·{' '}
                                    {model.maxTokens.toLocaleString()} output
                                  </div>
                                </div>
                                <Button
                                  size='icon-sm'
                                  variant={isDefault ? 'secondary' : 'ghost'}
                                  aria-label={`Set ${model.name} as default`}
                                  disabled={
                                    busy !== null ||
                                    !model.enabled ||
                                    !selectedPreset.enabled ||
                                    !selectedPreset.authConfigured
                                  }
                                  onClick={() => void setDefaultModel(model.id)}
                                >
                                  {isDefault ? <Check /> : <Star />}
                                </Button>
                                {model.source === 'manual' ? (
                                  <>
                                    <Button
                                      size='icon-sm'
                                      variant='ghost'
                                      aria-label={`Edit ${model.name}`}
                                      onClick={() => {
                                        setManualModel({
                                          id: model.id,
                                          name: model.name,
                                          api: model.api,
                                          reasoning: model.reasoning,
                                          input: model.input,
                                          contextWindow: model.contextWindow,
                                          maxTokens: model.maxTokens
                                        })
                                        setManualOpen(true)
                                      }}
                                    >
                                      <ChevronRight />
                                    </Button>
                                    <Button
                                      size='icon-sm'
                                      variant='ghost'
                                      aria-label={`Remove ${model.name}`}
                                      disabled={busy !== null}
                                      onClick={() => void removeManualModel(model.id)}
                                    >
                                      <Trash2 />
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </section>

                    {selectedPreset.kind === 'custom' ? (
                      <>
                        <Separator />
                        <div className='flex justify-end'>
                          <Button
                            variant='destructive'
                            disabled={busy !== null}
                            onClick={() => setConfirmRemove(true)}
                          >
                            <Trash2 data-icon='inline-start' /> Remove provider
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            </ScrollArea>
          )}
        </section>
      </div>

      <Dialog open={addProviderOpen} onOpenChange={setAddProviderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
            <DialogDescription>
              Choose a transport and a display name. Endpoint and authentication are configured
              next.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <ConfigField label='Provider name'>
              <Input
                value={newProviderName}
                placeholder='My writing provider'
                onChange={(event) => setNewProviderName(event.target.value)}
              />
            </ConfigField>
            <Field>
              <FieldLabel>Provider type</FieldLabel>
              <Select
                value={newProviderApi}
                onValueChange={(value) => setNewProviderApi(value as CustomAgentPiApi)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {customTransports.map((transport) => (
                      <SelectItem key={transport.value} value={transport.value}>
                        {transport.label}
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
            <Button disabled={newProviderName.trim() === ''} onClick={beginAddProvider}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ManualModelDialog
        open={manualOpen}
        initial={manualModel}
        apis={selectedPreset ? availableApis(selectedPreset) : []}
        busy={busy !== null}
        onOpenChange={setManualOpen}
        onSave={saveManualModel}
      />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove custom provider?</AlertDialogTitle>
            <AlertDialogDescription>
              Its encrypted credential, discovered catalog, manual models, and preferences will be
              removed. Existing Agent run history remains unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={busy !== null}
              onClick={() => void removeProvider()}
            >
              {busy === 'remove' ? <Spinner data-icon='inline-start' /> : null}
              Remove provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={authFlowId !== null}
        onOpenChange={(open) => {
          if (!open && authFlowId !== null) {
            void window.desktop.providers.cancelAgentAuth({ flowId: authFlowId })
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provider sign-in</DialogTitle>
            <DialogDescription>
              {authEvent?.kind === 'notice'
                ? authNoticeText(authEvent)
                : authEvent?.kind === 'prompt'
                  ? authEvent.prompt.message
                  : 'Waiting for the provider…'}
            </DialogDescription>
          </DialogHeader>
          {authEvent?.kind === 'prompt' ? (
            authEvent.prompt.type === 'select' ? (
              <Select value={authValue} onValueChange={setAuthValue}>
                <SelectTrigger>
                  <SelectValue placeholder='Choose an account or login method' />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {authEvent.prompt.options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={authEvent.prompt.type === 'secret' ? 'password' : 'text'}
                value={authValue}
                placeholder={authEvent.prompt.placeholder}
                onChange={(event) => setAuthValue(event.target.value)}
              />
            )
          ) : (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Spinner /> Waiting for authorization…
            </div>
          )}
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                if (authFlowId !== null) {
                  void window.desktop.providers.cancelAgentAuth({ flowId: authFlowId })
                }
              }}
            >
              Cancel
            </Button>
            {authEvent?.kind === 'prompt' ? (
              <Button
                disabled={authValue === ''}
                onClick={() => {
                  void window.desktop.providers.respondAgentAuth({
                    flowId: authEvent.flowId,
                    promptId: authEvent.promptId,
                    value: authValue
                  })
                  setAuthEvent(null)
                  setAuthValue('')
                }}
              >
                Continue
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function availableApis(preset: AgentProviderPresetSummary): PiApi[] {
  return [
    ...new Set([...(preset.api ? [preset.api] : []), ...preset.models.map((model) => model.api)])
  ]
}

export function authNoticeText(
  event: Extract<AgentAuthInteractionEvent, { kind: 'notice' }>
): string {
  const notice = event.notice
  if (notice.type === 'device_code') {
    return `A browser window was opened. Enter device code ${notice.userCode}.`
  }
  if (notice.type === 'auth_url') {
    return notice.instructions ?? 'Complete sign-in in the browser window that was opened.'
  }
  return notice.message
}
