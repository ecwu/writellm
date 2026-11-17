import { reportRendererOperationError } from '../../diagnostics'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Boxes,
  Bot,
  Check,
  CheckCircle2,
  Ellipsis,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Trash2
} from 'lucide-react'
import {
  providerBaseUrlSchema,
  type AgentAuthInteractionEvent,
  type AgentManualModel,
  type AgentModelSelection,
  type AgentProviderPresetSummary,
  type CustomAgentPiApi,
  type PiApi,
  type ProviderConnectionTestResult,
  type ProviderSettingsSnapshot
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
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
import { orderEnabledAgentProvidersFirst } from './agent-provider-order'
import {
  ConfigField,
  customTransports,
  type ProviderSettingsWorkspaceProps
} from './provider-settings-common'
import { DefaultModelSelector } from './default-model-selector'
import { ManualModelDialog } from './manual-model-dialog'
import { useSettingsDraft } from './settings-draft-guard'

interface TestedAgentConnection {
  modelId: string
  modelApi: PiApi
  baseUrl: string | undefined
  authSource: string | null
  result: ProviderConnectionTestResult
}

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
  onError,
  initialPresetId
}: ProviderSettingsWorkspaceProps & { initialPresetId?: string }): React.JSX.Element {
  const { presets: savedPresets, defaultSelection } = snapshot.agentCatalog
  const orderedPresets = useMemo(
    () => orderEnabledAgentProvidersFirst(savedPresets),
    [savedPresets]
  )
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    () =>
      savedPresets.find((preset) => preset.presetId === initialPresetId)?.presetId ??
      orderedPresets[0]?.presetId ??
      null
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
  const [testResults, setTestResults] = useState<Record<string, TestedAgentConnection>>({})
  const [defaultCleared, setDefaultCleared] = useState(false)
  const [authFlowId, setAuthFlowId] = useState<string | null>(null)
  const [authEvent, setAuthEvent] = useState<AgentAuthInteractionEvent | null>(null)
  const [authValue, setAuthValue] = useState('')

  const selectedPreset = savedPresets.find((preset) => preset.presetId === selectedPresetId) ?? null
  const defaultPreset = orderedPresets.find(
    (preset) => preset.presetId === defaultSelection?.presetId
  )
  const defaultModel = defaultPreset?.models.find((model) => model.id === defaultSelection?.modelId)
  const testModel =
    selectedPreset?.models.find(
      (model) =>
        selectedPreset.presetId === defaultSelection?.presetId &&
        model.id === defaultSelection.modelId &&
        model.enabled
    ) ?? selectedPreset?.models.find((model) => model.enabled)
  const testedConnection =
    selectedPreset === null ? undefined : testResults[selectedPreset.presetId]
  const testResult =
    selectedPreset?.enabled &&
    selectedPreset.authConfigured &&
    testedConnection?.modelId === testModel?.id &&
    testedConnection?.modelApi === testModel?.api &&
    testedConnection?.baseUrl === selectedPreset.baseUrl &&
    testedConnection?.authSource === selectedPreset.authSource
      ? testedConnection?.result
      : undefined
  const defaultUnavailable =
    defaultSelection === null
      ? undefined
      : {
          label: `${defaultPreset?.name ?? defaultSelection.presetId} · ${defaultModel?.name ?? defaultSelection.modelId}`,
          reason:
            defaultModel === undefined
              ? 'The selected model is missing from its source.'
              : !defaultPreset?.authConfigured
                ? 'Configure authentication for this source.'
                : 'The selected source or model is disabled.'
        }
  const defaultGroups = useMemo(
    () =>
      orderedPresets
        .filter((preset) => preset.enabled && preset.authConfigured)
        .map((preset) => ({
          id: preset.presetId,
          label: preset.name,
          models: preset.models
            .filter((model) => model.enabled)
            .map((model) => ({
              value: modelSelectionKey({ presetId: preset.presetId, modelId: model.id }),
              label: model.name,
              keywords: [model.id]
            }))
        }))
        .filter((group) => group.models.length > 0),
    [orderedPresets]
  )
  const savedAuthMode = selectedPreset?.authMethods.includes('none') ? 'none' : 'api_key'
  const providerHasUnsavedChanges =
    draft !== null &&
    (selectedPreset === null ||
      draft.name.trim() !== selectedPreset.name ||
      draft.logoOverrideId !== selectedPreset.logoOverrideId ||
      draft.baseUrl.trim() !== (selectedPreset.baseUrl ?? '') ||
      draft.api !== (selectedPreset.api ?? 'openai-completions') ||
      draft.authMode !== savedAuthMode ||
      apiKey.trim() !== '')
  const providerCanSave =
    draft !== null &&
    draft.name.trim() !== '' &&
    draft.baseUrl.trim() !== '' &&
    busy === null &&
    providerHasUnsavedChanges

  const savedPresetId = selectedPreset?.presetId
  const savedName = selectedPreset?.name ?? ''
  const savedLogo = selectedPreset?.logoOverrideId ?? null
  const savedBaseUrl = selectedPreset?.baseUrl ?? ''
  const savedApi = selectedPreset?.api ?? 'openai-completions'
  const draftBaseUrl = providerBaseUrlSchema.safeParse(draft?.baseUrl.trim())
  const connectionIdentityChanged =
    selectedPreset?.kind === 'custom' &&
    draft?.presetId === selectedPreset.presetId &&
    selectedPreset.baseUrl !== undefined &&
    draftBaseUrl.success &&
    (new URL(draftBaseUrl.data).origin !== new URL(selectedPreset.baseUrl).origin ||
      draft.authMode !== savedAuthMode ||
      draft.api !== savedApi)
  const clearsStoredCredential =
    connectionIdentityChanged &&
    savedAuthMode === 'api_key' &&
    selectedPreset.authConfigured &&
    (draft.authMode === 'none' || apiKey.trim() === '')
  const clearsDiscoveredCatalog = connectionIdentityChanged && selectedPreset.checkedAt !== null

  useEffect(() => {
    if (savedPresetId !== undefined) {
      setDraft({
        presetId: savedPresetId,
        name: savedName,
        logoOverrideId: savedLogo,
        baseUrl: savedBaseUrl,
        api: savedApi,
        authMode: savedAuthMode
      })
    }
  }, [savedPresetId, savedName, savedLogo, savedBaseUrl, savedApi, savedAuthMode])

  const discardDraft = (): void => {
    setDraft(
      savedPresetId === undefined
        ? null
        : {
            presetId: savedPresetId,
            name: savedName,
            logoOverrideId: savedLogo,
            baseUrl: savedBaseUrl,
            api: savedApi,
            authMode: savedAuthMode
          }
    )
    setApiKey('')
  }

  const providerDisplayName = (preset: AgentProviderPresetSummary): string =>
    preset.presetId === selectedPresetId && draft?.presetId === preset.presetId
      ? draft.name.trim() || preset.name
      : preset.name
  const draftAutomaticLogoId =
    draft === null
      ? null
      : resolveModelsDevProviderLogoId({
          providerId: selectedPreset?.providerId ?? 'writellm-custom:draft',
          name: draft.name.trim(),
          baseUrl: draft.baseUrl.trim(),
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
    setModelSearch('')
  }

  const resetTestResult = (presetId: string, modelId?: string): void => {
    setTestResults((results) => {
      if (modelId !== undefined && results[presetId]?.modelId !== modelId) return results
      const { [presetId]: _, ...remaining } = results
      return remaining
    })
  }

  const testConnection = async (): Promise<void> => {
    if (
      busy !== null ||
      providerHasUnsavedChanges ||
      !selectedPreset?.enabled ||
      !selectedPreset.authConfigured ||
      !testModel
    )
      return
    const { presetId, baseUrl, authSource } = selectedPreset
    setBusy('test-connection')
    resetTestResult(presetId)
    try {
      const result = await window.desktop.providers.testAgentPreset({
        presetId,
        modelId: testModel.id
      })
      setTestResults((current) => ({
        ...current,
        [presetId]: { modelId: testModel.id, modelApi: testModel.api, baseUrl, authSource, result }
      }))
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('The Agent source connection test could not be completed.')
    } finally {
      setBusy(null)
    }
  }

  const savePreset = async (): Promise<boolean> => {
    if (!providerCanSave || draft === null) {
      onError(
        busy !== null
          ? 'Wait for the current source operation to finish.'
          : 'Enter a source name and base URL before saving.'
      )
      return false
    }
    const name = draft.name.trim()
    const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '')
    const previousIds = new Set(orderedPresets.map((preset) => preset.presetId))
    setBusy('save-preset')
    try {
      const next = await window.desktop.providers.saveAgentPreset({
        ...(draft.presetId === undefined ? {} : { presetId: draft.presetId }),
        name,
        logoOverrideId: draft.logoOverrideId,
        baseUrl,
        api: draft.api,
        authMode: draft.authMode,
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() })
      })
      updateSnapshot(next)
      const persisted = next.agentCatalog.presets.find((preset) =>
        draft.presetId === undefined
          ? !previousIds.has(preset.presetId) && preset.kind === 'custom'
          : preset.presetId === draft.presetId
      )
      if (persisted !== undefined) {
        setSelectedPresetId(persisted.presetId)
        if (connectionIdentityChanged || baseUrl !== savedBaseUrl || apiKey.trim() !== '') {
          resetTestResult(persisted.presetId)
        }
      }
      setApiKey('')
      return true
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('Custom Agent source was not saved. Check its name, URL, and credential.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const saveCredential = async (): Promise<boolean> => {
    if (busy !== null || selectedPreset === null || apiKey.trim() === '') {
      onError(
        busy !== null
          ? 'Wait for the current source operation to finish.'
          : 'Select a source and enter its API key before saving.'
      )
      return false
    }
    setBusy('credential')
    try {
      updateSnapshot(
        await window.desktop.providers.setAgentCredential({
          presetId: selectedPreset.presetId,
          apiKey: apiKey.trim()
        })
      )
      resetTestResult(selectedPreset.presetId)
      setApiKey('')
      return true
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('The Agent source credential could not be saved.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const requestLeave = useSettingsDraft(
    providerHasUnsavedChanges,
    selectedPreset?.kind === 'builtin' ? saveCredential : savePreset,
    discardDraft
  )

  const choosePreset = (presetId: string): void => {
    if (presetId === selectedPresetId) return
    requestLeave(() => {
      setSelectedPresetId(presetId)
      setApiKey('')
      setModelSearch('')
    })
  }

  const openAddProvider = (): void => requestLeave(() => setAddProviderOpen(true))

  const clearCredential = async (): Promise<void> => {
    if (selectedPreset === null) return
    setBusy('credential')
    try {
      updateAfterRemoval(
        await window.desktop.providers.clearAgentCredential({
          presetId: selectedPreset.presetId
        })
      )
      resetTestResult(selectedPreset.presetId)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
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
      resetTestResult(selectedPreset.presetId)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('Model discovery failed. The last successful catalog was retained.')
      try {
        updateSnapshot(await window.desktop.providers.snapshot())
      } catch (snapshotError) {
        reportRendererOperationError(snapshotError, 'agent-provider-settings')
      }
    } finally {
      setBusy(null)
    }
  }

  const toggleProvider = async (enabled: boolean): Promise<void> => {
    if (selectedPreset === null) return
    setBusy('provider-toggle')
    try {
      updateAfterRemoval(
        await window.desktop.providers.setAgentProviderEnabled({
          presetId: selectedPreset.presetId,
          enabled
        })
      )
      if (!enabled) resetTestResult(selectedPreset.presetId)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('Provider availability could not be changed.')
    } finally {
      setBusy(null)
    }
  }

  const toggleModel = async (modelId: string, enabled: boolean): Promise<void> => {
    if (selectedPreset === null) return
    setBusy(`model:${modelId}`)
    try {
      updateAfterRemoval(
        await window.desktop.providers.setAgentModelEnabled({
          presetId: selectedPreset.presetId,
          modelId,
          enabled
        })
      )
      if (!enabled) resetTestResult(selectedPreset.presetId, modelId)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('Model availability could not be changed.')
    } finally {
      setBusy(null)
    }
  }

  const setDefaultModel = async (selection: AgentModelSelection | null): Promise<void> => {
    setBusy('default')
    try {
      updateSnapshot(await window.desktop.providers.setAgentDefault(selection))
      setDefaultCleared(false)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('The Agent default model could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  const selectDefault = (value: string | null): void => {
    if (value === null) {
      void setDefaultModel(null)
      return
    }
    const group = defaultGroups.find((source) =>
      source.models.some((model) => model.value === value)
    )
    const preset = orderedPresets.find((source) => source.presetId === group?.id)
    const model = preset?.models.find(
      (model) => modelSelectionKey({ presetId: preset.presetId, modelId: model.id }) === value
    )
    if (preset && model) void setDefaultModel({ presetId: preset.presetId, modelId: model.id })
  }

  const updateAfterRemoval = (next: ProviderSettingsSnapshot): void => {
    updateSnapshot(next)
    if (defaultSelection !== null && next.agentCatalog.defaultSelection === null) {
      setDefaultCleared(true)
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
      resetTestResult(selectedPreset.presetId, model.id)
      setManualOpen(false)
      setManualModel(null)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
      onError('The manual model could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  const removeManualModel = async (modelId: string): Promise<void> => {
    if (selectedPreset === null) return
    setBusy(`model:${modelId}`)
    try {
      updateAfterRemoval(
        await window.desktop.providers.removeAgentManualModel({
          presetId: selectedPreset.presetId,
          modelId
        })
      )
      resetTestResult(selectedPreset.presetId, modelId)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
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
      updateAfterRemoval(next)
      setDraft(null)
      setSelectedPresetId(
        orderEnabledAgentProvidersFirst(next.agentCatalog.presets)[0]?.presetId ?? null
      )
      setConfirmRemove(false)
      resetTestResult(selectedPreset.presetId)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
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
      resetTestResult(selectedPreset.presetId)
    } catch (err) {
      reportRendererOperationError(err, 'agent-provider-settings')
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
      <div className='grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden'>
        <section className='flex min-h-0 min-w-0 flex-col border-r'>
          <div className='flex flex-col gap-2 border-b p-4'>
            <DefaultModelSelector
              id='agent-default-model'
              groups={defaultGroups}
              value={defaultSelection === null ? null : modelSelectionKey(defaultSelection)}
              onValueChange={selectDefault}
              disabled={busy !== null}
              unavailable={defaultUnavailable}
            />
            {defaultCleared && defaultSelection === null ? (
              <p role='status' className='text-sm text-muted-foreground'>
                Default model cleared.
              </p>
            ) : null}
          </div>
          <div className='flex flex-col gap-2 p-4 pb-2'>
            <h2 className='text-sm font-medium'>Sources</h2>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                aria-label='Search Agent sources'
                value={providerSearch}
                placeholder='Search sources…'
                onChange={(event) => setProviderSearch(event.target.value)}
              />
            </InputGroup>
          </div>
          <ScrollArea className='min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!'>
            <div className='flex flex-col gap-1 p-2' data-testid='agent-provider-list'>
              {presets.map((preset) => (
                <Button
                  key={preset.presetId}
                  data-agent-provider-preset-id={preset.presetId}
                  variant={preset.presetId === selectedPresetId ? 'secondary' : 'ghost'}
                  className='h-auto w-full min-w-0 justify-start px-3 py-2'
                  aria-pressed={preset.presetId === selectedPresetId}
                  disabled={busy !== null}
                  onClick={() => choosePreset(preset.presetId)}
                >
                  <ProviderLogo
                    logoId={providerDisplayLogoId(preset)}
                    name={providerDisplayName(preset)}
                  />
                  <span className='min-w-0 flex-1 truncate text-left'>
                    {providerDisplayName(preset)}
                  </span>
                  {!preset.enabled ? <Badge variant='secondary'>Off</Badge> : null}
                </Button>
              ))}
            </div>
          </ScrollArea>
          <div className='border-t p-3'>
            <Button
              className='w-full'
              variant='outline'
              disabled={busy !== null}
              onClick={openAddProvider}
            >
              <Plus data-icon='inline-start' /> Add source
            </Button>
          </div>
        </section>

        <section className='flex min-h-0 min-w-0 flex-col'>
          {draft === null ? (
            <>
              <div className='flex justify-end p-7 pb-0'>{closeAction}</div>
              <Empty className='h-full flex-1 border-0'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <Bot />
                  </EmptyMedia>
                  <EmptyTitle>Select a source</EmptyTitle>
                  <EmptyDescription>
                    Choose a Pi provider or add a custom endpoint to manage its models.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </>
          ) : (
            <ScrollArea className='h-full'>
              <div className='flex min-w-0 flex-col gap-6 p-7'>
                <header className='flex flex-wrap items-center gap-3'>
                  <ProviderLogo
                    logoId={
                      selectedPreset?.kind === 'custom'
                        ? draftLogoId
                        : (selectedPreset?.logoId ?? null)
                    }
                    name={draft.name}
                    size='lg'
                  />
                  <h2 className='min-w-0 flex-1 truncate text-xl font-semibold'>{draft.name}</h2>
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
                        {selectedPreset === null ? 'Save source' : 'Save changes'}
                      </Button>
                    </div>
                  ) : selectedPreset.authMethods.includes('api_key') ? (
                    <Button
                      disabled={busy !== null || apiKey.trim() === ''}
                      onClick={() => void saveCredential()}
                    >
                      {busy === 'credential' ? <Spinner data-icon='inline-start' /> : null}
                      Save credential
                    </Button>
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

                <section className='flex flex-col gap-4'>
                  <h3 className='font-medium'>Connection</h3>
                  {selectedPreset &&
                  !selectedPreset.authConfigured &&
                  selectedPreset.authMethods.length > 0 ? (
                    <p className='text-sm text-muted-foreground'>Authentication required.</p>
                  ) : selectedPreset?.authSource === 'OAuth' ? (
                    <p className='text-sm text-muted-foreground'>Connected through OAuth</p>
                  ) : null}
                  <FieldGroup>
                    {selectedPreset?.kind === 'custom' || selectedPreset === null ? (
                      <>
                        <ConfigField label='Source name'>
                          <Input
                            value={draft.name}
                            disabled={busy !== null}
                            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                          />
                        </ConfigField>
                        <ConfigField label='Source logo'>
                          <ProviderLogoPicker
                            value={draft.logoOverrideId}
                            automaticLogoId={draftAutomaticLogoId}
                            disabled={busy !== null}
                            onValueChange={(logoOverrideId) =>
                              setDraft({ ...draft, logoOverrideId })
                            }
                          />
                        </ConfigField>
                        <ConfigField label='Base URL'>
                          <Input
                            value={draft.baseUrl}
                            disabled={busy !== null}
                            autoComplete='url'
                            placeholder='https://api.example.com/v1'
                            onChange={(event) =>
                              setDraft({ ...draft, baseUrl: event.target.value })
                            }
                          />
                        </ConfigField>
                        <ConfigField label='Type'>
                          <Input
                            value={
                              customTransports.find((transport) => transport.value === draft.api)
                                ?.label ?? draft.api
                            }
                            readOnly
                          />
                        </ConfigField>
                        <Field>
                          <FieldLabel htmlFor='agent-authentication'>Authentication</FieldLabel>
                          <Select
                            value={draft.authMode}
                            disabled={busy !== null}
                            onValueChange={(value) => {
                              if (value === 'none') setApiKey('')
                              setDraft({ ...draft, authMode: value as 'api_key' | 'none' })
                            }}
                          >
                            <SelectTrigger id='agent-authentication'>
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
                    ) : null}

                    {draft.authMode === 'api_key' &&
                    (selectedPreset === null || selectedPreset.authMethods.includes('api_key')) ? (
                      <ConfigField label='API key'>
                        <Input
                          type='password'
                          value={apiKey}
                          disabled={busy !== null}
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

                  {clearsStoredCredential || clearsDiscoveredCatalog ? (
                    <Alert>
                      <AlertCircle />
                      <AlertTitle>Connection changes</AlertTitle>
                      <AlertDescription>
                        {clearsStoredCredential ? <p>The saved API key will be cleared.</p> : null}
                        {clearsDiscoveredCatalog ? (
                          <p>
                            The discovered model list will be cleared. Fetch models to refresh it.
                          </p>
                        ) : null}
                      </AlertDescription>
                    </Alert>
                  ) : null}

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
                    </div>
                    {selectedPreset ? (
                      <Button
                        variant='outline'
                        disabled={
                          busy !== null ||
                          providerHasUnsavedChanges ||
                          !selectedPreset.enabled ||
                          !selectedPreset.authConfigured ||
                          testModel === undefined
                        }
                        onClick={() => void testConnection()}
                      >
                        {busy === 'test-connection' ? <Spinner data-icon='inline-start' /> : null}
                        Test connection
                      </Button>
                    ) : null}
                  </div>
                  {testResult && !providerHasUnsavedChanges ? (
                    <Alert role='status' variant={testResult.ok ? 'default' : 'destructive'}>
                      {testResult.ok ? <CheckCircle2 /> : <AlertCircle />}
                      <AlertTitle>Tested {testModel?.name}</AlertTitle>
                      <AlertDescription>{testResult.message}</AlertDescription>
                    </Alert>
                  ) : null}
                </section>

                {selectedPreset ? (
                  <>
                    <Separator />
                    <section className='flex min-w-0 flex-col gap-4'>
                      <div className='flex flex-wrap items-end gap-3'>
                        <div className='min-w-0 flex-1'>
                          <h3 className='flex items-center gap-2 font-medium'>
                            <Boxes className='size-4 text-muted-foreground' aria-hidden='true' />
                            Models
                          </h3>
                        </div>
                        {selectedPreset.canRefresh ? (
                          <Button
                            variant='outline'
                            disabled={busy !== null}
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
                        ) : null}
                        <Button
                          variant='outline'
                          disabled={busy !== null || availableApis(selectedPreset).length === 0}
                          onClick={() => {
                            setManualModel(null)
                            setManualOpen(true)
                          }}
                        >
                          <Plus data-icon='inline-start' /> Add model
                        </Button>
                      </div>
                      {selectedPreset.lastErrorCode !== null ? (
                        <p className='text-sm text-muted-foreground'>
                          Model discovery failed. The last successful catalog was retained.
                        </p>
                      ) : null}
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
                              defaultSelection?.presetId === selectedPreset.presetId &&
                              defaultSelection.modelId === model.id
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
                                  {model.absentFromLastDiscovery === true ? (
                                    <p className='text-xs text-muted-foreground'>
                                      Missing from the last successful model list.
                                    </p>
                                  ) : null}
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
                                  onClick={() =>
                                    void setDefaultModel({
                                      presetId: selectedPreset.presetId,
                                      modelId: model.id
                                    })
                                  }
                                >
                                  {isDefault ? <Check /> : <Star />}
                                </Button>
                                {model.source === 'manual' ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        size='icon-sm'
                                        variant='ghost'
                                        disabled={busy !== null}
                                        aria-label={`Actions for ${model.name}`}
                                      >
                                        <Ellipsis />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align='end'>
                                      <DropdownMenuGroup>
                                        <DropdownMenuItem
                                          onSelect={() => {
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
                                          Edit model
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          variant='destructive'
                                          onSelect={() => void removeManualModel(model.id)}
                                        >
                                          Remove model
                                        </DropdownMenuItem>
                                      </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
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
                            disabled={busy !== null || providerHasUnsavedChanges}
                            onClick={() => setConfirmRemove(true)}
                          >
                            <Trash2 data-icon='inline-start' /> Remove source
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
            <DialogTitle>Add source</DialogTitle>
            <DialogDescription>
              Choose a transport and a display name. Endpoint and authentication are configured
              next.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <ConfigField label='Source name'>
              <Input
                value={newProviderName}
                placeholder='My writing provider'
                onChange={(event) => setNewProviderName(event.target.value)}
              />
            </ConfigField>
            <Field>
              <FieldLabel htmlFor='agent-source-type'>Type</FieldLabel>
              <Select
                value={newProviderApi}
                onValueChange={(value) => setNewProviderApi(value as CustomAgentPiApi)}
              >
                <SelectTrigger id='agent-source-type'>
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
            <AlertDialogTitle>Remove custom source?</AlertDialogTitle>
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
              Remove source
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

function modelSelectionKey(selection: AgentModelSelection): string {
  return JSON.stringify([selection.presetId, selection.modelId])
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
