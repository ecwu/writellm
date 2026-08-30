import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ShieldAlert, Trash2 } from 'lucide-react'
import type { ProviderConnectionTestResult } from '../../../../shared/contracts/providers'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import {
  roleLabels,
  SingletonConfigFields,
  type ProviderSettingsWorkspaceProps,
  type SingletonProviderConfig,
  type SingletonProviderRole
} from './provider-settings-common'

export function defaultConfig(role: SingletonProviderRole): SingletonProviderConfig {
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

export function SingletonProviderWorkspace({
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
