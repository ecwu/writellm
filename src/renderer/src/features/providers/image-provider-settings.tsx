import { useEffect, useId, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, ShieldAlert, Trash2 } from 'lucide-react'
import type {
  GoogleGeminiImageModel,
  GoogleVertexImageModel,
  ImageProviderConfig,
  ImageProviderId,
  ProviderConnectionTestResult
} from '../../../../shared/contracts/providers'
import {
  GOOGLE_GEMINI_IMAGE_MODELS,
  GOOGLE_VERTEX_IMAGE_MODELS
} from '../../../../shared/contracts/providers'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
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
import { Spinner } from '@/components/ui/spinner'
import { ConfigField, type ProviderSettingsWorkspaceProps } from './provider-settings-common'

export function defaultImageConfig(providerId: ImageProviderId): ImageProviderConfig {
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

export function ImageProviderWorkspace({
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

export function vertexImageModelLabel(model: GoogleVertexImageModel): string {
  if (model === 'gemini-2.5-flash-image') return `Nano Banana · ${model}`
  if (model === 'gemini-3-pro-image') return `Nano Banana Pro · ${model}`
  return `Nano Banana 2 · ${model}`
}
