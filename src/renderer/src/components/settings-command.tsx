import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  Braces,
  FileArchive,
  FolderOpen,
  ImageIcon,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Settings2,
  Sun,
  X
} from 'lucide-react'
import type { ProviderRole, ProviderSettingsSnapshot } from '../../../shared/contracts/providers'
import type { AccentPreference, ThemePreference } from '../../../shared/contracts/app'
import type { AgentApprovalMode } from '../../../shared/contracts/agent'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { DialogClose } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldTitle } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ProviderSettingsWorkspace } from '@/features/providers/provider-settings-dialog'
import { useTheme } from '@/theme-provider'

type SettingsSection = 'general' | ProviderRole

interface SettingsCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenLogs: () => void
  onExportDiagnostics: () => void
  onError: (message: string) => void
}

const sections: Array<{
  id: SettingsSection
  label: string
  icon: typeof Bot
}> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'agent', label: 'Agent API', icon: Bot },
  { id: 'embedding', label: 'Embedding API', icon: Braces },
  { id: 'rerank', label: 'Reranking API', icon: Braces },
  { id: 'mineru', label: 'MinerU API', icon: KeyRound },
  { id: 'image', label: 'Image API', icon: ImageIcon }
]

export function SettingsCommand({
  open,
  onOpenChange,
  onOpenLogs,
  onExportDiagnostics,
  onError
}: SettingsCommandProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ProviderSettingsSnapshot | null>(null)
  const [section, setSection] = useState<SettingsSection>('general')
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>('manual')
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const { preference, accent, setPreference, setAccent } = useTheme()

  useEffect(() => {
    if (!open) return
    let current = true
    setMobileSectionOpen(false)
    setLoading(true)
    setLoadError(null)
    void Promise.all([
      window.desktop.providers.snapshot(),
      window.desktop.app.getDefaultAgentApprovalMode()
    ])
      .then(([nextSnapshot, nextApprovalMode]) => {
        if (!current) return
        setSnapshot(nextSnapshot)
        setApprovalMode(nextApprovalMode)
      })
      .catch(() => {
        if (current) setLoadError('Settings could not be loaded.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [open])

  const selectTheme = async (next: ThemePreference): Promise<void> => {
    try {
      await setPreference(next)
    } catch {
      onError('Theme preference could not be saved.')
    }
  }

  const selectAccent = async (next: AccentPreference): Promise<void> => {
    try {
      await setAccent(next)
    } catch {
      onError('Accent preference could not be saved.')
    }
  }

  const selectApprovalMode = async (mode: AgentApprovalMode): Promise<void> => {
    try {
      setApprovalMode(await window.desktop.app.setDefaultAgentApprovalMode({ mode }))
    } catch {
      onError('Default Agent approval mode could not be saved.')
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Settings'
      description='Application settings and provider configuration'
      className='h-[min(90vh,56rem)] w-[min(96vw,90rem)] max-w-none sm:max-w-none'
      showCloseButton={false}
      onOpenAutoFocus={() => {
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      }}
      onCloseAutoFocus={(event) => {
        const returnFocus = returnFocusRef.current
        returnFocusRef.current = null
        if (returnFocus === null || !returnFocus.isConnected) return
        event.preventDefault()
        returnFocus.focus()
      }}
    >
      <div className='grid h-full min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[14rem_minmax(0,1fr)]'>
        <aside
          className={`${mobileSectionOpen ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r bg-muted/30`}
        >
          <div className='flex h-14 items-center gap-2 border-b px-4'>
            <Settings2 />
            <h1 className='font-semibold'>Settings</h1>
            <div className='ml-auto md:hidden'>
              <SettingsCloseButton />
            </div>
          </div>
          <CommandList className='max-h-none flex-1 p-2'>
            <CommandGroup heading='Application'>
              {sections.map((item) => {
                const Icon = item.icon
                const provider =
                  item.id === 'general'
                    ? null
                    : snapshot?.providers.find((candidate) => candidate.role === item.id)
                return (
                  <CommandItem
                    key={item.id}
                    value={`settings-${item.id}`}
                    data-selected={section === item.id}
                    onSelect={() => {
                      setSection(item.id)
                      setMobileSectionOpen(true)
                    }}
                  >
                    <Icon /> {item.label}
                    {provider ? (
                      <CommandShortcut>
                        <Badge variant={provider.available ? 'default' : 'secondary'}>
                          {provider.available ? 'Ready' : 'Setup'}
                        </Badge>
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </aside>

        <main
          className={`${mobileSectionOpen ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col overflow-hidden`}
        >
          <div className='flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden'>
            <Button
              size='icon-sm'
              variant='ghost'
              aria-label='Back to settings categories'
              onClick={() => setMobileSectionOpen(false)}
            >
              <ArrowLeft />
            </Button>
            <span className='font-medium'>
              {sections.find((candidate) => candidate.id === section)?.label}
            </span>
          </div>
          <div className='min-h-0 flex-1 overflow-hidden'>
            {loading && snapshot === null ? (
              <div className='flex h-full flex-col gap-4 p-6'>
                <div className='flex justify-end'>
                  <SettingsCloseButton />
                </div>
                <div className='flex flex-1 items-center justify-center gap-2 text-muted-foreground'>
                  <Spinner /> Loading settings…
                </div>
              </div>
            ) : loadError ? (
              <div className='flex h-full flex-col gap-4 p-6'>
                <div className='flex justify-end'>
                  <SettingsCloseButton />
                </div>
                <Alert variant='destructive'>
                  <AlertTitle>Settings unavailable</AlertTitle>
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              </div>
            ) : section === 'general' ? (
              <GeneralSettings
                snapshot={snapshot}
                theme={preference}
                accent={accent}
                approvalMode={approvalMode}
                closeAction={<SettingsCloseButton />}
                onTheme={selectTheme}
                onAccent={selectAccent}
                onApprovalMode={selectApprovalMode}
                onOpenLogs={onOpenLogs}
                onExportDiagnostics={onExportDiagnostics}
              />
            ) : snapshot ? (
              <ProviderSettingsWorkspace
                role={section}
                snapshot={snapshot}
                closeAction={<SettingsCloseButton />}
                onSnapshotChange={setSnapshot}
                onError={onError}
              />
            ) : null}
          </div>
        </main>
      </div>
    </CommandDialog>
  )
}

function GeneralSettings({
  snapshot,
  theme,
  accent,
  approvalMode,
  closeAction,
  onTheme,
  onAccent,
  onApprovalMode,
  onOpenLogs,
  onExportDiagnostics
}: {
  snapshot: ProviderSettingsSnapshot | null
  theme: ThemePreference
  accent: AccentPreference
  approvalMode: AgentApprovalMode
  closeAction: React.ReactNode
  onTheme: (value: ThemePreference) => Promise<void>
  onAccent: (value: AccentPreference) => Promise<void>
  onApprovalMode: (value: AgentApprovalMode) => Promise<void>
  onOpenLogs: () => void
  onExportDiagnostics: () => void
}): React.JSX.Element {
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-8'>
        <header className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <h2 className='text-xl font-semibold'>General</h2>
            <p className='text-sm text-muted-foreground'>
              Appearance, Agent behavior, credential security, and diagnostics.
            </p>
          </div>
          {closeAction}
        </header>

        <FieldGroup>
          <Field orientation='horizontal'>
            <div className='min-w-0 flex-1'>
              <FieldTitle id='theme-mode'>Theme mode</FieldTitle>
              <FieldDescription>Follow the system or choose a fixed appearance.</FieldDescription>
            </div>
            <ToggleGroup
              type='single'
              value={theme}
              aria-labelledby='theme-mode'
              variant='outline'
              onValueChange={(value) => {
                if (value) void onTheme(value as ThemePreference)
              }}
            >
              <ToggleGroupItem value='system'>
                <Monitor /> System
              </ToggleGroupItem>
              <ToggleGroupItem value='light'>
                <Sun /> Light
              </ToggleGroupItem>
              <ToggleGroupItem value='dark'>
                <Moon /> Dark
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field>
            <FieldTitle id='accent-color'>UI accent</FieldTitle>
            <FieldDescription>
              A bounded semantic palette keeps light and dark contrast predictable.
            </FieldDescription>
            <ToggleGroup
              type='single'
              value={accent}
              aria-labelledby='accent-color'
              variant='outline'
              className='flex-wrap justify-start'
              onValueChange={(value) => {
                if (value) void onAccent(value as AccentPreference)
              }}
            >
              {(['neutral', 'blue', 'green', 'violet', 'rose', 'orange'] as const).map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  <Palette /> {capitalize(value)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldTitle id='approval-mode'>Default Agent approval</FieldTitle>
            <FieldDescription>Applied to newly created conversations.</FieldDescription>
            <ToggleGroup
              type='single'
              value={approvalMode}
              aria-labelledby='approval-mode'
              variant='outline'
              className='flex-wrap justify-start'
              onValueChange={(value) => {
                if (value) void onApprovalMode(value as AgentApprovalMode)
              }}
            >
              <ToggleGroupItem value='manual'>Manual</ToggleGroupItem>
              <ToggleGroupItem value='section_auto'>Section auto</ToggleGroupItem>
              <ToggleGroupItem value='yolo'>YOLO</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field orientation='horizontal'>
            <div className='min-w-0 flex-1'>
              <FieldTitle>Credential security</FieldTitle>
              <FieldDescription>
                Provider secrets remain encrypted in Electron Main and are never returned here.
              </FieldDescription>
            </div>
            <Badge
              variant={snapshot?.credentialBackend.securePersistence ? 'outline' : 'destructive'}
            >
              <KeyRound /> {snapshot?.credentialBackend.backend ?? 'Unavailable'}
            </Badge>
          </Field>

          <Field orientation='horizontal'>
            <div className='min-w-0 flex-1'>
              <FieldTitle>Diagnostics</FieldTitle>
              <FieldDescription>
                Inspect logs or export a sanitized support bundle.
              </FieldDescription>
            </div>
            <div className='flex flex-wrap justify-end gap-2'>
              <Button variant='outline' onClick={onOpenLogs}>
                <FolderOpen data-icon='inline-start' /> Open logs
              </Button>
              <Button variant='outline' onClick={onExportDiagnostics}>
                <FileArchive data-icon='inline-start' /> Export diagnostics
              </Button>
            </div>
          </Field>
        </FieldGroup>
      </div>
    </ScrollArea>
  )
}

function SettingsCloseButton(): React.JSX.Element {
  return (
    <DialogClose asChild>
      <Button size='icon-sm' variant='ghost' aria-label='Close settings'>
        <X />
      </Button>
    </DialogClose>
  )
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
