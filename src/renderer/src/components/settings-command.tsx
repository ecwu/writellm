import { useEffect, useState } from 'react'
import {
  Bot,
  Braces,
  Check,
  FileArchive,
  FolderOpen,
  ImageIcon,
  KeyRound,
  LoaderCircle,
  Monitor,
  Moon,
  Sun
} from 'lucide-react'
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
import { useTheme } from '@/theme-provider'
import type { ThemePreference } from '../../../shared/contracts/app'
import type { AgentApprovalMode } from '../../../shared/contracts/agent'

interface SettingsCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenLogs: () => void
  onExportDiagnostics: () => void
  onError: (message: string) => void
}

export function SettingsCommand({
  open,
  onOpenChange,
  onOpenLogs,
  onExportDiagnostics,
  onError
}: SettingsCommandProps): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderSettingsSnapshot | null>(null)
  const [providerRole, setProviderRole] = useState<ProviderRole | null>(null)
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>('manual')
  const { preference, setPreference } = useTheme()

  useEffect(() => {
    if (!open) return
    let current = true
    void window.desktop.providers.snapshot().then((snapshot) => {
      if (current) setProviders(snapshot)
    })
    void window.desktop.app
      .getDefaultAgentApprovalMode()
      .then((mode) => {
        if (current) setApprovalMode(mode)
      })
      .catch(() => {
        if (current) setApprovalMode('manual')
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

  const selectTheme = (nextPreference: ThemePreference): void => {
    void setPreference(nextPreference)
      .then(() => onOpenChange(false))
      .catch(() => onError('Theme preference could not be saved.'))
  }

  const selectApprovalMode = (mode: AgentApprovalMode): void => {
    void window.desktop.app
      .setDefaultAgentApprovalMode({ mode })
      .then((persisted) => {
        setApprovalMode(persisted)
        onOpenChange(false)
      })
      .catch(() => onError('Default Agent approval mode could not be saved.'))
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
            <CommandItem
              keywords={['image', 'gemini', 'generation', 'api']}
              onSelect={() => selectProvider('image')}
            >
              <ImageIcon /> Gemini image generation
              <CommandShortcut>{providerBadge('image')}</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading='Agent approval default'>
            {(['manual', 'section_auto', 'yolo'] as const).map((mode) => (
              <CommandItem
                key={mode}
                keywords={['agent', 'approval', mode]}
                onSelect={() => selectApprovalMode(mode)}
              >
                <Bot /> {settingsApprovalModeLabel(mode)}
                <CommandShortcut>
                  <Check className={approvalMode === mode ? 'opacity-100' : 'opacity-0'} />
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading='Appearance'>
            <CommandItem
              keywords={['theme', 'system', 'automatic', 'appearance']}
              onSelect={() => selectTheme('system')}
            >
              <Monitor /> Follow system
              <CommandShortcut>
                <Check className={preference === 'system' ? 'opacity-100' : 'opacity-0'} />
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              keywords={['theme', 'light', 'appearance']}
              onSelect={() => selectTheme('light')}
            >
              <Sun /> Light
              <CommandShortcut>
                <Check className={preference === 'light' ? 'opacity-100' : 'opacity-0'} />
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              keywords={['theme', 'dark', 'appearance']}
              onSelect={() => selectTheme('dark')}
            >
              <Moon /> Dark
              <CommandShortcut>
                <Check className={preference === 'dark' ? 'opacity-100' : 'opacity-0'} />
              </CommandShortcut>
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

function settingsApprovalModeLabel(mode: AgentApprovalMode): string {
  if (mode === 'manual') return 'Manual — review every proposal'
  if (mode === 'section_auto') return 'Section auto — review Brief and Outline'
  return 'YOLO — apply every proposal'
}
