import { cloneElement, isValidElement, type ReactNode, useEffect, useId, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
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
  GoogleGeminiImageModel,
  GoogleVertexImageModel,
  ImageProviderConfig,
  ImageProviderId,
  PiApi,
  ProviderConfig,
  ProviderConnectionTestResult,
  ProviderRole,
  ProviderSettingsSnapshot
} from '../../../../shared/contracts/providers'
import {
  GOOGLE_GEMINI_IMAGE_MODELS,
  GOOGLE_VERTEX_IMAGE_MODELS
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

interface ProviderSettingsWorkspaceProps {
  role: ProviderRole
  snapshot: ProviderSettingsSnapshot
  closeAction: ReactNode
  onSnapshotChange: (snapshot: ProviderSettingsSnapshot) => void
  onError: (message: string) => void
}

const roleLabels: Record<ProviderRole, string> = {
  agent: 'Agent API',
  embedding: 'Embedding API',
  rerank: 'Reranking API',
  mineru: 'MinerU API',
  image: 'Image API'
}

const customTransports: Array<{ value: CustomAgentPiApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'mistral-conversations', label: 'Mistral Conversations' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' }
]

export function ProviderSettingsWorkspace(
  props: ProviderSettingsWorkspaceProps
): React.JSX.Element {
  if (props.role === 'agent') return <AgentProviderWorkspace {...props} />
  if (props.role === 'image') return <ImageProviderWorkspace {...props} />
  return <SingletonProviderWorkspace {...props} role={props.role} />
}

type SingletonProviderRole = Exclude<ProviderRole, 'agent' | 'image'>
type SingletonProviderConfig = Extract<ProviderConfig, { role: SingletonProviderRole }>

function defaultConfig(role: SingletonProviderRole): SingletonProviderConfig {
  if (role === 'mineru') {
    return {
      role,
      providerId: 'mineru',
      baseUrl: 'https://mineru.net',
      model: 'vlm',
      timeoutMs: 120_000,
      embeddingDimension: null,
      batchLimit: 200,
      fileSizeLimitMb: 200
    }
  }
  if (role === 'embedding') {
    return {
      role,
      providerId: 'openai-compatible',
      baseUrl: '',
      model: '',
      modelRevision: 'unspecified',
      timeoutMs: 60_000,
      embeddingDimension: 1_536,
      batchLimit: 100,
      fileSizeLimitMb: null
    }
  }
  return {
    role,
    providerId: 'cohere-compatible',
    baseUrl: '',
    model: '',
    modelRevision: 'unspecified',
    timeoutMs: 60_000,
    embeddingDimension: null,
    batchLimit: 100,
    fileSizeLimitMb: null
  }
}

function SingletonProviderWorkspace({
  role,
  snapshot,
  closeAction,
  onSnapshotChange,
  onError
}: ProviderSettingsWorkspaceProps & { role: SingletonProviderRole }): React.JSX.Element {
  const status = snapshot.providers.find((provider) => provider.role === role)
  const [config, setConfig] = useState<SingletonProviderConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null)
  const [message, setMessage] = useState<ProviderConnectionTestResult | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    setConfig(
      status?.config !== null &&
        status?.config !== undefined &&
        status.config.role !== 'agent' &&
        status.config.role !== 'image'
        ? status.config
        : defaultConfig(role)
    )
    setApiKey('')
    setMessage(null)
  }, [role, status?.config])

  const save = async (): Promise<void> => {
    if (config === null) return
    setBusy('save')
    try {
      const next = await window.desktop.providers.save({
        config,
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() })
      })
      onSnapshotChange(next)
      setApiKey('')
    } catch {
      onError('Configuration was not saved. Check every value and credential storage status.')
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async (): Promise<void> => {
    setBusy('test')
    try {
      setMessage(await window.desktop.providers.testConnection({ role }))
    } catch {
      onError('The connection test could not be completed.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy('remove')
    try {
      onSnapshotChange(await window.desktop.providers.remove({ role }))
      setConfirmRemove(false)
      setConfig(defaultConfig(role))
    } catch {
      onError('The provider configuration could not be removed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <ScrollArea className='h-full'>
        <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 lg:p-8'>
          <header className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <h2 className='text-xl font-semibold'>{roleLabels[role]}</h2>
              <p className='text-sm text-muted-foreground'>
                Application-global configuration. Credentials stay encrypted in Electron Main.
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <Badge variant={status?.available ? 'default' : 'secondary'}>
                {status?.available
                  ? 'Ready'
                  : status?.configured
                    ? 'Unavailable'
                    : 'Not configured'}
              </Badge>
              {closeAction}
            </div>
          </header>

          {snapshot.credentialBackend.warning ? (
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

          {config === null ? (
            <div className='flex min-h-48 items-center justify-center'>
              <Spinner />
            </div>
          ) : (
            <SingletonConfigFields
              role={role}
              config={config}
              setConfig={setConfig}
              statusConfigured={status?.configured === true}
              apiKey={apiKey}
              setApiKey={setApiKey}
            />
          )}

          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Button
              variant='destructive'
              disabled={!status?.config || busy !== null}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 data-icon='inline-start' /> Remove
            </Button>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                disabled={!status?.config || busy !== null}
                onClick={() => void testConnection()}
              >
                {busy === 'test' ? <Spinner data-icon='inline-start' /> : null}
                Test connection
              </Button>
              <Button disabled={config === null || busy !== null} onClick={() => void save()}>
                {busy === 'save' ? <Spinner data-icon='inline-start' /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove provider configuration?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes encrypted credentials and application-global metadata. Project files
              remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === 'remove' ? <Spinner data-icon='inline-start' /> : null}
              Remove provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function defaultImageConfig(providerId: ImageProviderId): ImageProviderConfig {
  const common = {
    role: 'image' as const,
    timeoutMs: 120_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null,
    defaultAspectRatio: 'auto' as const,
    defaultImageSize: '1K' as const
  }
  if (providerId === 'google-gemini') {
    return { ...common, providerId, model: 'gemini-3.1-flash-image' }
  }
  if (providerId === 'google-vertex') {
    return {
      ...common,
      providerId,
      projectId: 'my-google-cloud-project',
      location: 'global',
      model: 'gemini-3.1-flash-image'
    }
  }
  if (providerId === 'openai') return { ...common, providerId, model: 'gpt-image-2' }
  return { ...common, providerId, model: 'grok-imagine-image-2.0' }
}

function ImageProviderWorkspace({
  snapshot,
  closeAction,
  onSnapshotChange,
  onError
}: ProviderSettingsWorkspaceProps): React.JSX.Element {
  const [selectedProviderId, setSelectedProviderId] = useState<ImageProviderId>(
    snapshot.imageCatalog.activeProviderId ?? 'google-gemini'
  )
  const source =
    snapshot.imageCatalog.sources.find((item) => item.providerId === selectedProviderId) ??
    snapshot.imageCatalog.sources[0]
  const [config, setConfig] = useState<ImageProviderConfig>(
    source.config ?? defaultImageConfig(source.providerId)
  )
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | 'activate' | null>(null)
  const [message, setMessage] = useState<ProviderConnectionTestResult | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const imageModelId = useId()
  const activeProviderId = snapshot.imageCatalog.activeProviderId

  useEffect(() => {
    setConfig(source.config ?? defaultImageConfig(source.providerId))
    setApiKey('')
    setMessage(null)
  }, [source.config, source.providerId])

  const save = async (): Promise<void> => {
    setBusy('save')
    try {
      const next = await window.desktop.providers.save({
        config,
        ...(config.providerId === 'google-vertex' || apiKey.trim() === ''
          ? {}
          : { apiKey: apiKey.trim() })
      })
      onSnapshotChange(next)
      setApiKey('')
    } catch {
      onError('Image provider configuration was not saved.')
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async (): Promise<void> => {
    setBusy('test')
    try {
      setMessage(
        await window.desktop.providers.testConnection({
          role: 'image',
          providerId: selectedProviderId
        })
      )
    } catch {
      onError('The image provider connection test could not be completed.')
    } finally {
      setBusy(null)
    }
  }

  const activate = async (): Promise<void> => {
    setBusy('activate')
    try {
      onSnapshotChange(
        await window.desktop.providers.setActiveImage({ providerId: selectedProviderId })
      )
    } catch {
      onError('The image provider could not be activated.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy('remove')
    try {
      onSnapshotChange(
        await window.desktop.providers.remove({
          role: 'image',
          providerId: selectedProviderId
        })
      )
      setConfirmRemove(false)
      setConfig(defaultImageConfig(selectedProviderId))
    } catch {
      onError('The image provider configuration could not be removed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <ScrollArea className='h-full'>
        <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 lg:p-8'>
          <header className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <h2 className='text-xl font-semibold'>Image API</h2>
              <p className='text-sm text-muted-foreground'>
                Configure each source independently, then explicitly choose the only source used for
                new image requests. Google Vertex AI uses this computer's local ADC login.
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <Badge variant={activeProviderId === null ? 'secondary' : 'default'}>
                {activeProviderId === null
                  ? 'No active source'
                  : `Active: ${snapshot.imageCatalog.sources.find((item) => item.providerId === activeProviderId)?.label ?? activeProviderId}`}
              </Badge>
              {closeAction}
            </div>
          </header>

          {snapshot.credentialBackend.warning && selectedProviderId !== 'google-vertex' ? (
            <Alert variant='destructive'>
              <ShieldAlert />
              <AlertTitle>Secure credential storage unavailable</AlertTitle>
              <AlertDescription>{snapshot.credentialBackend.warning}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel>Active image source</FieldLabel>
            <Select
              value={activeProviderId ?? undefined}
              onValueChange={(value) => {
                setSelectedProviderId(value as ImageProviderId)
                void window.desktop.providers
                  .setActiveImage({ providerId: value as ImageProviderId })
                  .then(onSnapshotChange)
                  .catch(() => onError('The image provider could not be activated.'))
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder='Choose a saved source' />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {snapshot.imageCatalog.sources.map((item) => (
                    <SelectItem
                      key={item.providerId}
                      value={item.providerId}
                      disabled={!item.available}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Requests never fall back or rotate to another provider after a failure.
            </FieldDescription>
          </Field>

          <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
            {snapshot.imageCatalog.sources.map((item) => (
              <Button
                key={item.providerId}
                type='button'
                variant={item.providerId === selectedProviderId ? 'secondary' : 'outline'}
                className='h-auto min-w-0 items-start justify-between overflow-hidden py-3 text-left'
                onClick={() => setSelectedProviderId(item.providerId)}
              >
                <span className='flex min-w-0 flex-1 flex-col items-start overflow-hidden'>
                  <span>{item.label}</span>
                  <span className='block max-w-full truncate text-xs font-normal text-muted-foreground'>
                    {item.available
                      ? item.config?.model
                      : item.configured
                        ? 'Saved · unavailable'
                        : 'Not configured'}
                  </span>
                </span>
                {item.active ? <Check aria-label='Active' className='shrink-0' /> : null}
              </Button>
            ))}
          </div>

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
            <Field>
              <FieldLabel htmlFor={imageModelId}>Model ID</FieldLabel>
              {config.providerId === 'google-gemini' ? (
                <Select
                  value={config.model}
                  onValueChange={(model: GoogleGeminiImageModel) => setConfig({ ...config, model })}
                >
                  <SelectTrigger id={imageModelId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {GOOGLE_GEMINI_IMAGE_MODELS.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : config.providerId === 'google-vertex' ? (
                <Select
                  value={config.model}
                  onValueChange={(model: GoogleVertexImageModel) => setConfig({ ...config, model })}
                >
                  <SelectTrigger id={imageModelId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {GOOGLE_VERTEX_IMAGE_MODELS.map((model) => (
                        <SelectItem key={model} value={model}>
                          {vertexImageModelLabel(model)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Input id={imageModelId} value={config.model} readOnly />
              )}
              <FieldDescription>
                Uses the fixed official {source.label} endpoint; custom endpoints are not accepted.
              </FieldDescription>
            </Field>
            {config.providerId === 'google-vertex' ? (
              <>
                <ConfigField label='Google Cloud Project ID'>
                  <Input
                    value={config.projectId}
                    autoComplete='off'
                    placeholder='my-google-cloud-project'
                    onChange={(event) => setConfig({ ...config, projectId: event.target.value })}
                  />
                </ConfigField>
                <ConfigField label='Vertex location'>
                  <Input value={config.location} readOnly />
                </ConfigField>
              </>
            ) : null}
            {config.providerId === 'google-vertex' ? (
              <Alert>
                <ShieldAlert />
                <AlertTitle>Application Default Credentials</AlertTitle>
                <AlertDescription>
                  Uses the local Google Cloud ADC account. Run gcloud auth application-default login
                  on this computer, enable Vertex AI for the project, and grant that identity
                  roles/aiplatform.user. No Google credential is saved by WriteLLM.
                </AlertDescription>
              </Alert>
            ) : (
              <ConfigField label={`${source.label} API key`}>
                <Input
                  type='password'
                  value={apiKey}
                  autoComplete='new-password'
                  placeholder={
                    source.configured ? 'Stored — enter a new value to replace' : 'Required'
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </ConfigField>
            )}
          </FieldGroup>

          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Button
              variant='destructive'
              disabled={source.config === null || busy !== null}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 data-icon='inline-start' /> Remove
            </Button>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                disabled={source.config === null || busy !== null}
                onClick={() => void testConnection()}
              >
                {busy === 'test' ? <Spinner data-icon='inline-start' /> : null}
                Test connection
              </Button>
              <Button
                variant='outline'
                disabled={!source.available || source.active || busy !== null}
                onClick={() => void activate()}
              >
                {busy === 'activate' ? <Spinner data-icon='inline-start' /> : null}
                Make active
              </Button>
              <Button disabled={busy !== null} onClick={() => void save()}>
                {busy === 'save' ? <Spinner data-icon='inline-start' /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {source.label} image configuration?</AlertDialogTitle>
            <AlertDialogDescription>
              {source.providerId === 'google-vertex'
                ? 'Its project configuration is removed. Local ADC files are not changed. If this source is active, image generation stops until another saved source is explicitly activated.'
                : 'Its encrypted credential is removed. If this source is active, image generation stops until another saved source is explicitly activated.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={() => void remove()}>
              {busy === 'remove' ? <Spinner data-icon='inline-start' /> : null}
              Remove provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function vertexImageModelLabel(model: GoogleVertexImageModel): string {
  if (model === 'gemini-2.5-flash-image') return `Nano Banana · ${model}`
  if (model === 'gemini-3-pro-image') return `Nano Banana Pro · ${model}`
  return `Nano Banana 2 · ${model}`
}

function SingletonConfigFields({
  role,
  config,
  setConfig,
  statusConfigured,
  apiKey,
  setApiKey
}: {
  role: SingletonProviderRole
  config: SingletonProviderConfig
  setConfig: (config: SingletonProviderConfig) => void
  statusConfigured: boolean
  apiKey: string
  setApiKey: (value: string) => void
}): React.JSX.Element {
  return (
    <FieldGroup>
      <ConfigField label='Base URL'>
        <Input
          value={config.baseUrl}
          autoComplete='url'
          placeholder='https://api.example.com/v1'
          onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
        />
      </ConfigField>
      <ConfigField label='Model ID'>
        <Input
          value={config.model}
          autoComplete='off'
          placeholder={role === 'mineru' ? 'vlm' : 'provider model ID'}
          onChange={(event) => setConfig({ ...config, model: event.target.value })}
        />
      </ConfigField>
      {config.role !== 'mineru' ? (
        <ConfigField label='Model revision'>
          <Input
            value={config.modelRevision}
            onChange={(event) => setConfig({ ...config, modelRevision: event.target.value })}
          />
        </ConfigField>
      ) : null}
      <ConfigField label='API key or token'>
        <Input
          type='password'
          value={apiKey}
          autoComplete='new-password'
          placeholder={statusConfigured ? 'Stored — enter a new value to replace' : 'Required'}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </ConfigField>
      <div className='grid gap-4 sm:grid-cols-2'>
        <ConfigField label='Request timeout (milliseconds)'>
          <Input
            type='number'
            min={1_000}
            max={300_000}
            value={config.timeoutMs}
            onChange={(event) => setConfig({ ...config, timeoutMs: Number(event.target.value) })}
          />
        </ConfigField>
        <ConfigField label='Batch limit'>
          <Input
            type='number'
            min={1}
            value={config.batchLimit}
            onChange={(event) => setConfig({ ...config, batchLimit: Number(event.target.value) })}
          />
        </ConfigField>
        {config.role === 'embedding' ? (
          <ConfigField label='Embedding dimensions'>
            <Input
              type='number'
              min={1}
              value={config.embeddingDimension}
              onChange={(event) =>
                setConfig({ ...config, embeddingDimension: Number(event.target.value) })
              }
            />
          </ConfigField>
        ) : null}
        {config.role === 'mineru' ? (
          <ConfigField label='File limit (MB)'>
            <Input
              type='number'
              min={1}
              max={200}
              value={config.fileSizeLimitMb ?? ''}
              onChange={(event) =>
                setConfig({ ...config, fileSizeLimitMb: Number(event.target.value) })
              }
            />
          </ConfigField>
        ) : null}
      </div>
    </FieldGroup>
  )
}

interface AgentDraft {
  presetId?: string
  name: string
  logoOverrideId: ModelsDevProviderLogoId | null
  baseUrl: string
  api: CustomAgentPiApi
  authMode: 'api_key' | 'none'
}

function AgentProviderWorkspace({
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
                        description='Use HTTPS, or HTTP only for a loopback endpoint.'
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

function ManualModelDialog({
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

function availableApis(preset: AgentProviderPresetSummary): PiApi[] {
  return [
    ...new Set([...(preset.api ? [preset.api] : []), ...preset.models.map((model) => model.api)])
  ]
}

function authNoticeText(event: Extract<AgentAuthInteractionEvent, { kind: 'notice' }>): string {
  const notice = event.notice
  if (notice.type === 'device_code') {
    return `A browser window was opened. Enter device code ${notice.userCode}.`
  }
  if (notice.type === 'auth_url') {
    return notice.instructions ?? 'Complete sign-in in the browser window that was opened.'
  }
  return notice.message
}

function ConfigField({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactElement<{ id?: string }>
}): React.JSX.Element {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}
