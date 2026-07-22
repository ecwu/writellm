import { cloneElement, isValidElement, useEffect, useId, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, ShieldAlert, Trash2 } from 'lucide-react'
import type {
  ProviderConfig,
  ProviderConnectionTestResult,
  ProviderRole,
  ProviderSettingsSnapshot
} from '../../../../shared/contracts/providers'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'

interface ProviderSettingsDialogProps {
  role: ProviderRole | null
  onOpenChange: (open: boolean) => void
  onSnapshotChange: (snapshot: ProviderSettingsSnapshot) => void
}

const labels: Record<ProviderRole, string> = {
  agent: 'Agent model',
  embedding: 'Embeddings',
  rerank: 'Reranking',
  mineru: 'MinerU parser'
}

function defaultConfig(role: ProviderRole): ProviderConfig {
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
    timeoutMs: 60_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null
  }
}

export function ProviderSettingsDialog({
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
            <div className='flex min-h-48 items-center justify-center text-muted-foreground'>
              <LoaderCircle className='mr-2 animate-spin' /> Loading provider settings…
            </div>
          ) : (
            <div className='grid gap-4'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={status?.configured ? 'default' : 'secondary'}>
                  {status?.configured ? 'Credential stored' : 'Credential missing'}
                </Badge>
                <Badge variant='outline'>{config.providerId}</Badge>
                <Badge variant='outline'>
                  {snapshot?.credentialBackend.backend ?? 'unknown backend'}
                </Badge>
              </div>
              <Field label='Base URL'>
                <Input
                  value={config.baseUrl}
                  autoComplete='url'
                  placeholder='https://api.example.com/v1'
                  onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
                />
              </Field>
              <Field label='Model ID'>
                <Input
                  value={config.model}
                  autoComplete='off'
                  placeholder={role === 'mineru' ? 'vlm' : 'provider model ID'}
                  onChange={(event) => setConfig({ ...config, model: event.target.value })}
                />
              </Field>
              {config.role !== 'mineru' && (
                <Field label='Model revision'>
                  <Input
                    value={config.modelRevision}
                    autoComplete='off'
                    placeholder='Provider snapshot or revision'
                    onChange={(event) =>
                      setConfig({ ...config, modelRevision: event.target.value })
                    }
                  />
                </Field>
              )}
              <Field label='API key or token'>
                <Input
                  type='password'
                  value={apiKey}
                  autoComplete='new-password'
                  placeholder={
                    status?.configured ? 'Leave blank to keep the stored value' : 'Required'
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </Field>
              <div className='grid gap-4 sm:grid-cols-2'>
                <Field label='Request timeout (milliseconds)'>
                  <div className='space-y-1'>
                    <Input
                      type='number'
                      min={1_000}
                      max={300_000}
                      value={config.timeoutMs}
                      onChange={(event) =>
                        setConfig({ ...config, timeoutMs: Number(event.target.value) })
                      }
                    />
                    {config.role === 'agent' ? (
                      <p className='text-xs text-muted-foreground'>
                        Applies to each model request, including its automatic retries.
                      </p>
                    ) : null}
                  </div>
                </Field>
                <Field label='Batch limit'>
                  <Input
                    type='number'
                    min={1}
                    max={status?.capability.maxBatchSize ?? 2_048}
                    value={config.batchLimit}
                    onChange={(event) =>
                      setConfig({ ...config, batchLimit: Number(event.target.value) })
                    }
                  />
                </Field>
                {config.role === 'embedding' && (
                  <Field label='Embedding dimensions'>
                    <Input
                      type='number'
                      min={1}
                      max={65_536}
                      value={config.embeddingDimension ?? ''}
                      onChange={(event) =>
                        setConfig({ ...config, embeddingDimension: Number(event.target.value) })
                      }
                    />
                  </Field>
                )}
                {config.role === 'mineru' && (
                  <Field label='File limit (MB)'>
                    <Input
                      type='number'
                      min={1}
                      max={200}
                      value={config.fileSizeLimitMb ?? ''}
                      onChange={(event) =>
                        setConfig({ ...config, fileSizeLimitMb: Number(event.target.value) })
                      }
                    />
                  </Field>
                )}
              </div>
              {status && status.capability.supportedFormats.length > 0 && (
                <p className='text-sm text-muted-foreground'>
                  Current import slice: {status.capability.supportedFormats.join(', ')}. Registered
                  maximum: {status.capability.maxFileSizeMb} MB and {status.capability.maxPages}{' '}
                  pages.
                </p>
              )}
              {status && status.issues.length > 0 && (
                <ul className='list-disc space-y-1 pl-5 text-sm text-destructive'>
                  {status.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter className='gap-2 sm:justify-between'>
            <Button
              type='button'
              variant='destructive'
              disabled={!status?.config || busy !== null}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 /> Remove
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
                {busy === 'test' && <LoaderCircle className='animate-spin' />} Test connection
              </Button>
              <Button
                type='button'
                disabled={config === null || busy !== null}
                onClick={() => void save()}
              >
                {busy === 'save' && <LoaderCircle className='animate-spin' />} Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove provider configuration?</DialogTitle>
            <DialogDescription>
              This removes its encrypted credential and application-global metadata. Project files
              remain portable and unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type='button' variant='outline'>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type='button'
              variant='destructive'
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === 'remove' && <LoaderCircle className='animate-spin' />} Remove provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactElement<{ id?: string }>
}): React.JSX.Element {
  const id = useId()
  return (
    <div className='grid gap-2'>
      <label className='text-sm font-medium' htmlFor={id}>
        {label}
      </label>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
    </div>
  )
}
