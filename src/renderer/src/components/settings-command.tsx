import { useEffect, useState } from 'react'
import { Bot, Braces, FileArchive, FolderOpen, KeyRound, LoaderCircle } from 'lucide-react'
import type { ProviderRole, ProviderSettingsSnapshot } from '../../../shared/contracts/providers'
import { Badge } from '@/components/ui/badge'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command'
import { ProviderSettingsDialog } from '@/features/providers/provider-settings-dialog'

interface SettingsCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenLogs: () => void
  onExportDiagnostics: () => void
}

export function SettingsCommand({
  open,
  onOpenChange,
  onOpenLogs,
  onExportDiagnostics
}: SettingsCommandProps): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderSettingsSnapshot | null>(null)
  const [providerRole, setProviderRole] = useState<ProviderRole | null>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    void window.desktop.providers
      .snapshot()
      .then((snapshot) => {
        if (current) setProviders(snapshot)
      })
      .catch(() => {
        if (current) setProviders(null)
      })
    return () => {
      current = false
    }
  }, [open])

  const select = (action: () => void): void => {
    action()
    onOpenChange(false)
  }

  const selectProvider = (role: ProviderRole): void => {
    setProviderRole(role)
    onOpenChange(false)
  }

  const providerBadge = (role: ProviderRole): React.JSX.Element => {
    const status = providers?.providers.find((provider) => provider.role === role)
    if (providers === null) return <LoaderCircle className='size-3 animate-spin' />
    return (
      <Badge variant={status?.available ? 'default' : 'secondary'}>
        {status?.available ? 'Ready' : status?.configured ? 'Unavailable' : 'Not configured'}
      </Badge>
    )
  }

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title='Settings'
        description='Provider configuration and application diagnostics'
        className='sm:max-w-xl'
      >
        <CommandInput placeholder='Search settings and diagnostics…' />
        <CommandList>
          <CommandEmpty>No settings found.</CommandEmpty>
          <CommandGroup heading='API configuration'>
            <CommandItem
              keywords={['provider', 'model', 'api']}
              onSelect={() => selectProvider('agent')}
            >
              <Bot /> Agent model provider
              <CommandShortcut>{providerBadge('agent')}</CommandShortcut>
            </CommandItem>
            <CommandItem
              keywords={['embedding', 'api']}
              onSelect={() => selectProvider('embedding')}
            >
              <Braces /> Embeddings
              <CommandShortcut>{providerBadge('embedding')}</CommandShortcut>
            </CommandItem>
            <CommandItem keywords={['reranking', 'api']} onSelect={() => selectProvider('rerank')}>
              <Braces /> Reranking
              <CommandShortcut>{providerBadge('rerank')}</CommandShortcut>
            </CommandItem>
            <CommandItem
              keywords={['mineru', 'parser', 'api']}
              onSelect={() => selectProvider('mineru')}
            >
              <KeyRound /> MinerU parser
              <CommandShortcut>{providerBadge('mineru')}</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading='Credential security'>
            <CommandItem disabled>
              <KeyRound /> OS credential backend
              <CommandShortcut>
                <Badge
                  variant={
                    providers?.credentialBackend.securePersistence ? 'outline' : 'destructive'
                  }
                >
                  {providers?.credentialBackend.backend ?? 'Loading'}
                </Badge>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading='Diagnostics'>
            <CommandItem onSelect={() => select(onOpenLogs)}>
              <FolderOpen /> Open logs folder
            </CommandItem>
            <CommandItem onSelect={() => select(onExportDiagnostics)}>
              <FileArchive /> Export diagnostics bundle
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <ProviderSettingsDialog
        role={providerRole}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setProviderRole(null)
        }}
        onSnapshotChange={setProviders}
      />
    </>
  )
}
