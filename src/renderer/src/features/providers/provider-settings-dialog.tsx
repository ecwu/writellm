import { cloneElement, isValidElement, useEffect, useId, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import type {
  AgentAuthInteractionEvent,
  CustomAgentPiApi,
  GoogleGeminiImageModel,
  ProviderConfig,
  ProviderConnectionTestResult,
  ProviderRole,
  ProviderSettingsSnapshot
} from '../../../../shared/contracts/providers'
import { GOOGLE_GEMINI_IMAGE_MODELS } from '../../../../shared/contracts/providers'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

interface ProviderSettingsDialogProps {
  role: ProviderRole | null
  onOpenChange: (open: boolean) => void
  onSnapshotChange: (snapshot: ProviderSettingsSnapshot) => void
}

export function ProviderSettingsDialog(props: ProviderSettingsDialogProps): React.JSX.Element {
  return props.role === 'agent' ? (
    <AgentProviderCatalogDialog {...props} />
  ) : (
    <SingletonProviderSettingsDialog {...props} />
  )
}

const labels: Record<ProviderRole, string> = {
  agent: 'Agent model',
  embedding: 'Embeddings',
  rerank: 'Reranking',
  mineru: 'MinerU parser',
  image: 'Image generation'
}

function defaultConfig(role: ProviderRole): ProviderConfig {
  if (role === 'image') {
    return {
      role,
      providerId: 'google-gemini',
      model: 'gemini-3.1-flash-image',
      timeoutMs: 120_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null,
      defaultAspectRatio: 'auto',
      defaultImageSize: '1K'
    }
  }
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
  if (role === 'rerank') {
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
  return {
    role,
    providerId: 'openai-compatible',
    baseUrl: '',
    model: '',
    modelRevision: 'unspecified',
    contextWindowTokens: null,
    timeoutMs: 60_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null
  }
}

function SingletonProviderSettingsDialog({
  role,
  onOpenChange,
  onSnapshotChange
}: ProviderSettingsDialogProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ProviderSettingsSnapshot | null>(null)
  const [config, setConfig] = useState<ProviderConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'remove' | null>(null)
  const [message, setMessage] = useState<ProviderConnectionTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const imageModelId = useId()

  useEffect(() => {
    if (role === null) return
    let current = true
    setBusy('load')
    setError(null)
    setMessage(null)
    setApiKey('')
    void window.desktop.providers
      .snapshot()
      .then((next) => {
        if (!current) return
        const status = next.providers.find((provider) => provider.role === role)
        setSnapshot(next)
        setConfig(status?.config ?? defaultConfig(role))
      })
      .catch(() => {
        if (current) setError('Provider settings could not be loaded.')
      })
      .finally(() => {
        if (current) setBusy(null)
      })
    return () => {
      current = false
    }
  }, [role])

  const status = useMemo(
    () => snapshot?.providers.find((provider) => provider.role === role),
    [role, snapshot]
  )

  const updateSnapshot = (next: ProviderSettingsSnapshot): void => {
    setSnapshot(next)
    onSnapshotChange(next)
  }

  const save = async (): Promise<void> => {
    if (config === null) return
    setBusy('save')
    setError(null)
    setMessage(null)
    try {
      const next = await window.desktop.providers.save({
        config,
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() })
      })
      updateSnapshot(next)
      setConfig(next.providers.find((provider) => provider.role === role)?.config ?? config)
      setApiKey('')
    } catch {
      setError('Configuration was not saved. Check every value and credential storage status.')
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async (): Promise<void> => {
    if (role === null) return
    setBusy('test')
    setError(null)
    try {
      setMessage(await window.desktop.providers.testConnection({ role }))
    } catch {
      setError('The connection test could not be completed.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (role === null) return
    setBusy('remove')
    setError(null)
    try {
      updateSnapshot(await window.desktop.providers.remove({ role }))
      setConfirmRemove(false)
      onOpenChange(false)
    } catch {
      setError('The provider configuration could not be removed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Dialog open={role !== null} onOpenChange={onOpenChange}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{role === null ? 'Provider' : labels[role]}</DialogTitle>
            <DialogDescription>
              Provider metadata is application-global. Credentials are encrypted by Electron Main
              and are never returned to this window.
            </DialogDescription>
          </DialogHeader>

          {snapshot?.credentialBackend.warning && (
            <Alert variant='destructive'>
              <ShieldAlert />
              <AlertTitle>Secure credential storage unavailable</AlertTitle>
              <AlertDescription>{snapshot.credentialBackend.warning}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant='destructive'>
              <AlertCircle />
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {message && (
            <Alert variant={message.ok ? 'default' : 'destructive'}>
              {message.ok ? <CheckCircle2 /> : <AlertCircle />}
              <AlertTitle>{message.ok ? 'Connected' : 'Connection failed'}</AlertTitle>
              <AlertDescription>
                {message.message} ({message.durationMs} ms)
              </AlertDescription>
            </Alert>
          )}

          {busy === 'load' || config === null || role === null ? (
            <div
              className='flex min-h-48 items-center justify-center gap-2 text-muted-foreground'
              role='status'
            >
              <Spinner /> Loading provider settings…
            </div>
          ) : (
            <FieldGroup className='grid gap-4'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={status?.configured ? 'default' : 'secondary'}>
                  {status?.configured ? 'Credential stored' : 'Credential missing'}
                </Badge>
                <Badge variant='outline'>{config.providerId}</Badge>
                <Badge variant='outline'>
                  {snapshot?.credentialBackend.backend ?? 'unknown backend'}
                </Badge>
              </div>
              {config.role !== 'image' && (
                <ConfigField label='Base URL'>
                  <Input
                    value={config.baseUrl}
                    autoComplete='url'
                    placeholder='https://api.example.com/v1'
                    onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
                  />
                </ConfigField>
              )}
              {config.role === 'image' ? (
                <Field>
                  <FieldLabel htmlFor={imageModelId}>Model ID</FieldLabel>
                  <Select
                    value={config.model}
                    onValueChange={(model: GoogleGeminiImageModel) =>
                      setConfig({ ...config, model })
                    }
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
                </Field>
              ) : (
                <ConfigField label='Model ID'>
                  <Input
                    value={config.model}
                    autoComplete='off'
                    placeholder={role === 'mineru' ? 'vlm' : 'provider model ID'}
                    onChange={(event) => setConfig({ ...config, model: event.target.value })}
                  />
                </ConfigField>
              )}
              {config.role !== 'mineru' && config.role !== 'image' && (
                <ConfigField label='Model revision'>
                  <Input
                    value={config.modelRevision}
                    autoComplete='off'
                    placeholder='Provider snapshot or revision'
                    onChange={(event) =>
                      setConfig({ ...config, modelRevision: event.target.value })
                    }
                  />
                </ConfigField>
              )}
              {config.role === 'agent' && (
                <ConfigField
                  label='Context window override (tokens)'
                  description='Leave blank to use models.dev metadata, its offline cache, or the compatibility fallback.'
                >
                  <Input
                    type='number'
                    min={8_192}
                    max={10_000_000}
                    value={config.contextWindowTokens ?? ''}
                    placeholder='Auto-detect from models.dev'
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        contextWindowTokens:
                          event.target.value === '' ? null : Number(event.target.value)
                      })
                    }
                  />
                </ConfigField>
              )}
              <ConfigField label={config.role === 'image' ? 'Gemini API key' : 'API key or token'}>
                <Input
                  type='password'
                  value={apiKey}
                  autoComplete='new-password'
                  placeholder={
                    status?.configured ? 'Leave blank to keep the stored value' : 'Required'
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </ConfigField>
              {config.role === 'image' && (
                <p className='text-sm text-muted-foreground'>
                  Uses the fixed official Google Gemini endpoint through @google/genai. No custom
                  URL or API version is accepted.
                </p>
              )}
              {config.role !== 'image' && (
                <div className='grid gap-4 sm:grid-cols-2'>
                  <ConfigField
                    label='Request timeout (milliseconds)'
                    description={
                      config.role === 'agent'
                        ? 'Applies to each model request, including its automatic retries.'
                        : undefined
                    }
                  >
                    <Input
                      type='number'
                      min={1_000}
                      max={300_000}
                      value={config.timeoutMs}
                      onChange={(event) =>
                        setConfig({ ...config, timeoutMs: Number(event.target.value) })
                      }
                    />
                  </ConfigField>
                  <ConfigField label='Batch limit'>
                    <Input
                      type='number'
                      min={1}
                      max={status?.capability.maxBatchSize ?? 2_048}
                      value={config.batchLimit}
                      onChange={(event) =>
                        setConfig({ ...config, batchLimit: Number(event.target.value) })
                      }
                    />
                  </ConfigField>
                  {config.role === 'embedding' && (
                    <ConfigField label='Embedding dimensions'>
                      <Input
                        type='number'
                        min={1}
                        max={65_536}
                        value={config.embeddingDimension ?? ''}
                        onChange={(event) =>
                          setConfig({ ...config, embeddingDimension: Number(event.target.value) })
                        }
                      />
                    </ConfigField>
                  )}
                  {config.role === 'mineru' && (
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
                  )}
                </div>
              )}
              {status && status.capability.supportedFormats.length > 0 && (
                <p className='text-sm text-muted-foreground'>
                  Current import slice: {status.capability.supportedFormats.join(', ')}. Registered
                  maximum: {status.capability.maxFileSizeMb} MB and {status.capability.maxPages}{' '}
                  pages.
                </p>
              )}
              {status && status.issues.length > 0 && (
                <ul className='flex list-disc flex-col gap-1 pl-5 text-sm text-destructive'>
                  {status.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </FieldGroup>
          )}

          <DialogFooter className='gap-2 sm:justify-between'>
            <Button
              type='button'
              variant='destructive'
              disabled={!status?.config || busy !== null}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 data-icon='inline-start' /> Remove
            </Button>
            <div className='flex flex-col-reverse gap-2 sm:flex-row'>
              <DialogClose asChild>
                <Button type='button' variant='outline'>
                  Close
                </Button>
              </DialogClose>
              <Button
                type='button'
                variant='outline'
                disabled={!status?.config || busy !== null}
                onClick={() => void testConnection()}
              >
                {busy === 'test' && <Spinner data-icon='inline-start' />} Test connection
              </Button>
              <Button
                type='button'
                disabled={config === null || busy !== null}
                onClick={() => void save()}
              >
                {busy === 'save' && <Spinner data-icon='inline-start' />} Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove provider configuration?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes its encrypted credential and application-global metadata. Project files
              remain portable and unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === 'remove' && <Spinner data-icon='inline-start' />} Remove provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AgentProviderCatalogDialog({
  role,
  onOpenChange,
  onSnapshotChange
}: ProviderSettingsDialogProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ProviderSettingsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState<CustomAgentPiApi>('openai-completions')
  const [apiKey, setApiKey] = useState('')
  const [credentialPresetId, setCredentialPresetId] = useState<string | null>(null)
  const [credential, setCredential] = useState('')
  const [authFlowId, setAuthFlowId] = useState<string | null>(null)
  const [authEvent, setAuthEvent] = useState<AgentAuthInteractionEvent | null>(null)
  const [authValue, setAuthValue] = useState('')

  useEffect(() => {
    if (role !== 'agent') return
    let current = true
    setBusy(true)
    setError(null)
    void window.desktop.providers
      .snapshot()
      .then((next) => {
        if (current) setSnapshot(next)
      })
      .catch(() => {
        if (current) setError('Agent provider catalog could not be loaded.')
      })
      .finally(() => {
        if (current) setBusy(false)
      })
    return () => {
      current = false
    }
  }, [role])

  const updateSnapshot = (next: ProviderSettingsSnapshot): void => {
    setSnapshot(next)
    onSnapshotChange(next)
  }

  const createPreset = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.desktop.providers.saveAgentPreset({
        name,
        baseUrl,
        api,
        authMode: apiKey.trim() === '' ? 'none' : 'api_key',
        timeoutMs: 60_000,
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() })
      })
      updateSnapshot(next)
      setName('')
      setBaseUrl('')
      setApiKey('')
    } catch {
      setError('Custom Agent preset was not saved. Check its URL and credential.')
    } finally {
      setBusy(false)
    }
  }

  const refresh = async (presetId: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      updateSnapshot(await window.desktop.providers.refreshAgentPreset({ presetId }))
    } catch {
      setError('Model discovery failed. The last successful catalog was retained.')
      setSnapshot(await window.desktop.providers.snapshot())
    } finally {
      setBusy(false)
    }
  }

  const remove = async (presetId: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      updateSnapshot(await window.desktop.providers.removeAgentPreset({ presetId }))
    } catch {
      setError('The Agent provider preset could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  const saveCredential = async (): Promise<void> => {
    if (credentialPresetId === null || credential.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      updateSnapshot(
        await window.desktop.providers.setAgentCredential({
          presetId: credentialPresetId,
          apiKey: credential.trim()
        })
      )
      setCredential('')
      setCredentialPresetId(null)
    } catch {
      setError('The Agent provider credential could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const login = async (presetId: string): Promise<void> => {
    const flowId = globalThis.crypto.randomUUID()
    setBusy(true)
    setError(null)
    setAuthFlowId(flowId)
    setAuthEvent(null)
    setAuthValue('')
    try {
      const next = await window.desktop.providers.loginAgentPreset(
        { flowId, presetId, type: 'oauth' },
        (event) => {
          setAuthEvent(event)
          if (event.kind === 'prompt') setAuthValue('')
        }
      )
      updateSnapshot(next)
    } catch {
      setError('Provider sign-in did not complete.')
    } finally {
      setBusy(false)
      setAuthFlowId(null)
      setAuthEvent(null)
      setAuthValue('')
    }
  }

  const respondToAuthPrompt = async (): Promise<void> => {
    if (authEvent?.kind !== 'prompt') return
    await window.desktop.providers.respondAgentAuth({
      flowId: authEvent.flowId,
      promptId: authEvent.promptId,
      value: authValue
    })
    setAuthEvent(null)
    setAuthValue('')
  }

  const cancelAuth = async (): Promise<void> => {
    if (authFlowId === null) return
    await window.desktop.providers.cancelAgentAuth({ flowId: authFlowId })
  }

  return (
    <Dialog open={role === 'agent'} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Agent models</DialogTitle>
          <DialogDescription>
            Pi providers and custom endpoint presets are application-global. Credentials stay
            encrypted in Electron Main.
          </DialogDescription>
        </DialogHeader>
        {snapshot?.credentialBackend.warning ? (
          <Alert variant='destructive'>
            <ShieldAlert />
            <AlertTitle>Secure credential storage unavailable</AlertTitle>
            <AlertDescription>{snapshot.credentialBackend.warning}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant='destructive'>
            <AlertCircle />
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <section className='grid gap-3'>
          <div>
            <h3 className='text-sm font-medium'>Provider catalog</h3>
            <p className='text-xs text-muted-foreground'>
              Static providers use the pinned Pi catalog. Dynamic providers refresh only when you
              request it.
            </p>
          </div>
          <div className='max-h-72 space-y-1 overflow-y-auto rounded-md border p-2'>
            {busy && snapshot === null ? (
              <div className='flex min-h-24 items-center justify-center gap-2 text-muted-foreground'>
                <Spinner /> Loading providers…
              </div>
            ) : (
              snapshot?.agentCatalog.presets.map((preset) => (
                <div
                  key={preset.presetId}
                  className='flex min-w-0 flex-wrap items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50'
                >
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium'>{preset.name}</div>
                    <div className='truncate text-xs text-muted-foreground'>
                      {preset.models.length} models · {preset.catalogStatus}
                      {preset.authSource ? ` · ${preset.authSource}` : ''}
                    </div>
                  </div>
                  <Badge variant={preset.authConfigured ? 'default' : 'secondary'}>
                    {preset.authConfigured ? 'Connected' : 'Not connected'}
                  </Badge>
                  {preset.authMethods.includes('api_key') ? (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy}
                      onClick={() => setCredentialPresetId(preset.presetId)}
                    >
                      API key
                    </Button>
                  ) : null}
                  {preset.authMethods.includes('oauth') ? (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy}
                      onClick={() => void login(preset.presetId)}
                    >
                      Sign in
                    </Button>
                  ) : null}
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    aria-label={`Refresh ${preset.name} models`}
                    disabled={busy || preset.catalogStatus === 'packaged'}
                    onClick={() => void refresh(preset.presetId)}
                  >
                    <RefreshCw />
                  </Button>
                  {preset.kind === 'custom' || preset.authConfigured ? (
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      aria-label={`${preset.kind === 'custom' ? 'Remove' : 'Disconnect'} ${preset.name}`}
                      disabled={busy}
                      onClick={() => void remove(preset.presetId)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
        {credentialPresetId !== null ? (
          <FieldGroup className='grid gap-3 rounded-md border p-3'>
            <ConfigField label='Provider API key'>
              <Input
                type='password'
                value={credential}
                autoComplete='new-password'
                onChange={(event) => setCredential(event.target.value)}
              />
            </ConfigField>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => setCredentialPresetId(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || credential.trim() === ''}
                onClick={() => void saveCredential()}
              >
                Save credential
              </Button>
            </div>
          </FieldGroup>
        ) : null}
        {authFlowId !== null ? (
          <FieldGroup className='grid gap-3 rounded-md border p-3'>
            <div>
              <h3 className='text-sm font-medium'>Provider sign-in</h3>
              <p className='text-xs text-muted-foreground'>
                {authEvent?.kind === 'notice'
                  ? authNoticeText(authEvent)
                  : authEvent?.kind === 'prompt'
                    ? authEvent.prompt.message
                    : 'Waiting for the provider…'}
              </p>
            </div>
            {authEvent?.kind === 'prompt' ? (
              authEvent.prompt.type === 'select' ? (
                <Select value={authValue} onValueChange={setAuthValue}>
                  <SelectTrigger>
                    <SelectValue placeholder='Choose an account or login method' />
                  </SelectTrigger>
                  <SelectContent>
                    {authEvent.prompt.options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={authEvent.prompt.type === 'secret' ? 'password' : 'text'}
                  value={authValue}
                  placeholder={authEvent.prompt.placeholder}
                  autoComplete={authEvent.prompt.type === 'secret' ? 'new-password' : 'off'}
                  onChange={(event) => setAuthValue(event.target.value)}
                />
              )
            ) : null}
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => void cancelAuth()}>
                Cancel
              </Button>
              {authEvent?.kind === 'prompt' ? (
                <Button disabled={authValue === ''} onClick={() => void respondToAuthPrompt()}>
                  Continue
                </Button>
              ) : null}
            </div>
          </FieldGroup>
        ) : null}
        <FieldGroup className='grid gap-3 rounded-md border p-3'>
          <div>
            <h3 className='text-sm font-medium'>Add custom endpoint</h3>
            <p className='text-xs text-muted-foreground'>
              Custom endpoints support API-key or keyless authentication and explicit model
              discovery.
            </p>
          </div>
          <ConfigField label='Preset name'>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </ConfigField>
          <ConfigField label='Base URL'>
            <Input
              value={baseUrl}
              autoComplete='url'
              placeholder='https://api.example.com/v1'
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </ConfigField>
          <Field>
            <FieldLabel>Pi transport</FieldLabel>
            <Select value={api} onValueChange={(value) => setApi(value as CustomAgentPiApi)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[
                    'openai-completions',
                    'openai-responses',
                    'anthropic-messages',
                    'google-generative-ai',
                    'mistral-conversations',
                    'azure-openai-responses'
                  ].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <ConfigField label='API key (optional for local/keyless endpoints)'>
            <Input
              type='password'
              value={apiKey}
              autoComplete='new-password'
              onChange={(event) => setApiKey(event.target.value)}
            />
          </ConfigField>
          <Button
            disabled={busy || name.trim() === '' || baseUrl.trim() === ''}
            onClick={() => void createPreset()}
          >
            <Plus data-icon='inline-start' /> Add preset
          </Button>
        </FieldGroup>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
