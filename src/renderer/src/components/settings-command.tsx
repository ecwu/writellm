import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  BookOpen,
  Braces,
  FileArchive,
  FileOutput,
  FolderOpen,
  ImageIcon,
  Info,
  Keyboard,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Settings2,
  ShieldAlert,
  Sun,
  X
} from 'lucide-react'
import type { ProviderRole, ProviderSettingsSnapshot } from '../../../shared/contracts/providers'
import type {
  AccentPreference,
  AppInfo,
  CitationDisplayMode,
  ThemePreference
} from '../../../shared/contracts/app'
import type { AgentApprovalMode } from '../../../shared/contracts/agent'
import type { SkillsSnapshot } from '../../../shared/contracts/skills'
import type { PublicationPresetSnapshot } from '../../../shared/contracts/publication-presets'
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle
} from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ProviderSettingsWorkspace } from '@/features/providers/provider-settings-dialog'
import { notifyProviderCatalogChanged } from '@/features/providers/provider-catalog-events'
import { WritingSkillsSettings } from '@/features/skills/writing-skills-settings'
import { PublicationPresetsSettings } from '@/features/manuscript/publication-presets-settings'
import { useTheme } from '@/theme-provider'

type SettingsSection = 'general' | 'skills' | 'publication' | 'shortcuts' | 'about' | ProviderRole

interface SettingsCommandProps {
  open: boolean
  initialSection?: 'general' | 'skills'
  onOpenChange: (open: boolean) => void
  onOpenLogs: () => void
  onExportDiagnostics: () => void
  onError: (message: string) => void
}

export const settingsSections: Array<{
  id: SettingsSection
  label: string
  icon: typeof Bot
}> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'agent', label: 'Agent API', icon: Bot },
  { id: 'skills', label: 'Writing Skills', icon: BookOpen },
  { id: 'embedding', label: 'Embedding API', icon: Braces },
  { id: 'rerank', label: 'Reranking API', icon: Braces },
  { id: 'mineru', label: 'MinerU API', icon: KeyRound },
  { id: 'image', label: 'Image API', icon: ImageIcon },
  { id: 'publication', label: 'Publication', icon: FileOutput },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About & Diagnostics', icon: Info }
]

export const keyboardShortcuts = [
  { action: 'New project', shortcut: '⌘ / Ctrl + N', context: 'No project open' },
  { action: 'Open project', shortcut: '⌘ / Ctrl + O', context: 'No project open' },
  { action: 'Save current section', shortcut: '⌘ / Ctrl + S', context: 'Active project' },
  { action: 'Open Settings', shortcut: '⌘ / Ctrl + ,', context: 'Anywhere' },
  { action: 'Find in manuscript', shortcut: '⌘ / Ctrl + F', context: 'Active project' },
  { action: 'Toggle project sidebar', shortcut: '⌘ / Ctrl + B', context: 'Active project' },
  { action: 'Toggle writing Agent', shortcut: '⌘ / Ctrl + J', context: 'Active project' },
  {
    action: 'Open selection quick actions',
    shortcut: '⇧ + ⌘ / Ctrl + K',
    context: 'Selected editor text'
  },
  {
    action: 'Go to previous section',
    shortcut: '⌘ / Ctrl + ⌥ / Alt + ↑',
    context: 'Active project'
  },
  {
    action: 'Go to next section',
    shortcut: '⌘ / Ctrl + ⌥ / Alt + ↓',
    context: 'Active project'
  }
] as const

export function SettingsCommand({
  open,
  initialSection = 'general',
  onOpenChange,
  onOpenLogs,
  onExportDiagnostics,
  onError
}: SettingsCommandProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ProviderSettingsSnapshot | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [section, setSection] = useState<SettingsSection>('general')
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>('manual')
  const [skillSnapshot, setSkillSnapshot] = useState<SkillsSnapshot | null>(null)
  const [publicationPresets, setPublicationPresets] = useState<PublicationPresetSnapshot | null>(
    null
  )
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const {
    preference,
    accent,
    citationDisplayMode,
    setPreference,
    setAccent,
    setCitationDisplayMode
  } = useTheme()

  useEffect(() => {
    if (!open) return
    let current = true
    setSection(initialSection)
    setMobileSectionOpen(initialSection !== 'general')
    setLoading(true)
    setLoadError(null)
    void Promise.all([
      window.desktop.app.getInfo(),
      window.desktop.providers.snapshot(),
      window.desktop.app.getDefaultAgentApprovalMode(),
      window.desktop.skills.snapshot(),
      window.desktop.app.publicationPresets()
    ])
      .then(
        ([
          nextAppInfo,
          nextSnapshot,
          nextApprovalMode,
          nextSkillSnapshot,
          nextPublicationPresets
        ]) => {
          if (!current) return
          setAppInfo(nextAppInfo)
          setSnapshot(nextSnapshot)
          setApprovalMode(nextApprovalMode)
          setSkillSnapshot(nextSkillSnapshot)
          setPublicationPresets(nextPublicationPresets)
        }
      )
      .catch(() => {
        if (current) setLoadError('Settings could not be loaded.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [initialSection, open])

  useEffect(() => {
    if (!open) return
    return window.desktop.skills.subscribeChanges(() => {
      void window.desktop.skills
        .snapshot()
        .then(setSkillSnapshot)
        .catch(() => undefined)
    })
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

  const selectCitationDisplayMode = async (mode: CitationDisplayMode): Promise<void> => {
    try {
      await setCitationDisplayMode(mode)
    } catch {
      onError('Citation display preference could not be saved.')
    }
  }

  const updateProviderSnapshot = (next: ProviderSettingsSnapshot): void => {
    setSnapshot(next)
    notifyProviderCatalogChanged()
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
      <div className='grid h-full min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[16rem_minmax(0,1fr)]'>
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
            <CommandGroup>
              {settingsSections.map((item) => {
                const Icon = item.icon
                const provider = isProviderSection(item.id)
                  ? snapshot?.providers.find((candidate) => candidate.role === item.id)
                  : null
                return (
                  <CommandItem
                    key={item.id}
                    value={`settings-${item.id}`}
                    data-settings-section={item.id}
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
              {settingsSections.find((candidate) => candidate.id === section)?.label}
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
                theme={preference}
                accent={accent}
                approvalMode={approvalMode}
                citationDisplayMode={citationDisplayMode}
                closeAction={<SettingsCloseButton />}
                onTheme={selectTheme}
                onAccent={selectAccent}
                onApprovalMode={selectApprovalMode}
                onCitationDisplayMode={selectCitationDisplayMode}
              />
            ) : section === 'skills' && skillSnapshot ? (
              <WritingSkillsSettings
                snapshot={skillSnapshot}
                closeAction={<SettingsCloseButton />}
                onSnapshot={setSkillSnapshot}
                onError={onError}
              />
            ) : section === 'publication' && publicationPresets ? (
              <PublicationPresetsSettings
                snapshot={publicationPresets}
                closeAction={<SettingsCloseButton />}
                onSnapshot={setPublicationPresets}
                onError={onError}
              />
            ) : section === 'shortcuts' ? (
              <KeyboardShortcutsSettings closeAction={<SettingsCloseButton />} />
            ) : section === 'about' ? (
              <AboutDiagnosticsSettings
                appInfo={appInfo}
                snapshot={snapshot}
                closeAction={<SettingsCloseButton />}
                onOpenLogs={onOpenLogs}
                onExportDiagnostics={onExportDiagnostics}
              />
            ) : snapshot && isProviderSection(section) ? (
              <ProviderSettingsWorkspace
                role={section}
                snapshot={snapshot}
                closeAction={<SettingsCloseButton />}
                onSnapshotChange={updateProviderSnapshot}
                onError={onError}
              />
            ) : null}
          </div>
        </main>
      </div>
    </CommandDialog>
  )
}

export function GeneralSettings({
  theme,
  accent,
  approvalMode,
  citationDisplayMode,
  closeAction,
  onTheme,
  onAccent,
  onApprovalMode,
  onCitationDisplayMode
}: {
  theme: ThemePreference
  accent: AccentPreference
  approvalMode: AgentApprovalMode
  citationDisplayMode: CitationDisplayMode
  closeAction: React.ReactNode
  onTheme: (value: ThemePreference) => Promise<void>
  onAccent: (value: AccentPreference) => Promise<void>
  onApprovalMode: (value: AgentApprovalMode) => Promise<void>
  onCitationDisplayMode: (value: CitationDisplayMode) => Promise<void>
}): React.JSX.Element {
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-8'>
        <header className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <h2 className='text-xl font-semibold'>General</h2>
            <p className='text-sm text-muted-foreground'>
              Appearance, writing presentation, and default Agent behavior.
            </p>
          </div>
          {closeAction}
        </header>

        <div className='flex flex-col gap-10'>
          <FieldSet>
            <FieldLegend>Appearance</FieldLegend>
            <FieldGroup>
              <Field orientation='responsive'>
                <FieldContent className='min-w-0'>
                  <FieldTitle id='theme-mode'>Theme mode</FieldTitle>
                  <FieldDescription>
                    Follow the system or choose a fixed appearance.
                  </FieldDescription>
                </FieldContent>
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
                  {(['neutral', 'blue', 'green', 'violet', 'rose', 'orange'] as const).map(
                    (value) => (
                      <ToggleGroupItem key={value} value={value}>
                        <Palette /> {capitalize(value)}
                      </ToggleGroupItem>
                    )
                  )}
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Writing</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldTitle id='citation-display'>Citation display</FieldTitle>
                <FieldDescription>
                  Choose how canonical source citations appear while editing. Stored manuscript text
                  remains unchanged.
                </FieldDescription>
                <ToggleGroup
                  type='single'
                  value={citationDisplayMode}
                  aria-labelledby='citation-display'
                  variant='outline'
                  className='flex-wrap justify-start'
                  onValueChange={(value) => {
                    if (value) void onCitationDisplayMode(value as CitationDisplayMode)
                  }}
                >
                  <ToggleGroupItem value='full'>Full</ToggleGroupItem>
                  <ToggleGroupItem value='numbered'>[1]</ToggleGroupItem>
                  <ToggleGroupItem value='icon'>Icon</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Agent defaults</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldTitle id='approval-mode'>Default approval</FieldTitle>
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
                  <ToggleGroupItem value='section_auto'>Write Auto</ToggleGroupItem>
                  <ToggleGroupItem value='yolo'>YOLO</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </FieldSet>
        </div>
      </div>
    </ScrollArea>
  )
}

export function KeyboardShortcutsSettings({
  closeAction
}: {
  closeAction: React.ReactNode
}): React.JSX.Element {
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-8'>
        <header className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <h2 className='text-xl font-semibold'>Keyboard Shortcuts</h2>
            <p className='text-sm text-muted-foreground'>
              Current application commands. Shortcuts are fixed and cannot be customized.
            </p>
          </div>
          {closeAction}
        </header>

        <div className='border-y'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead className='text-right'>Shortcut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keyboardShortcuts.map((shortcut) => (
                <TableRow key={shortcut.action}>
                  <TableCell>
                    <div className='font-medium'>{shortcut.action}</div>
                    <div className='text-xs text-muted-foreground'>{shortcut.context}</div>
                  </TableCell>
                  <TableCell className='text-right font-medium whitespace-normal tabular-nums sm:whitespace-nowrap'>
                    {shortcut.shortcut}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </ScrollArea>
  )
}

export function AboutDiagnosticsSettings({
  appInfo,
  snapshot,
  closeAction,
  onOpenLogs,
  onExportDiagnostics
}: {
  appInfo: AppInfo | null
  snapshot: ProviderSettingsSnapshot | null
  closeAction: React.ReactNode
  onOpenLogs: () => void
  onExportDiagnostics: () => void
}): React.JSX.Element {
  const credentialBackend = snapshot?.credentialBackend
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-8'>
        <header className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <h2 className='text-xl font-semibold'>About & Diagnostics</h2>
            <p className='text-sm text-muted-foreground'>
              Application information, credential security, and sanitized support tools.
            </p>
          </div>
          {closeAction}
        </header>

        <FieldGroup>
          <Field orientation='responsive'>
            <FieldContent className='min-w-0'>
              <FieldTitle>{appInfo?.name ?? 'WriteLLM'}</FieldTitle>
              <FieldDescription>A local-first AI-assisted writing workspace.</FieldDescription>
            </FieldContent>
            <Badge variant='outline'>Version {appInfo?.version ?? 'unavailable'}</Badge>
          </Field>

          <Field orientation='responsive'>
            <FieldContent className='min-w-0'>
              <FieldTitle>Credential security</FieldTitle>
              <FieldDescription>
                Provider secrets remain in Electron Main and are never returned to Settings.
              </FieldDescription>
            </FieldContent>
            <Badge variant={credentialBackend?.securePersistence ? 'outline' : 'destructive'}>
              <KeyRound />
              {credentialBackend === undefined
                ? 'Unavailable'
                : `${credentialBackend.securePersistence ? 'Secure' : 'Not secure'} · ${credentialBackend.backend}`}
            </Badge>
          </Field>

          {credentialBackend?.warning ? (
            <Alert variant='destructive'>
              <ShieldAlert />
              <AlertTitle>Secure credential storage unavailable</AlertTitle>
              <AlertDescription>{credentialBackend.warning}</AlertDescription>
            </Alert>
          ) : null}

          <Field orientation='responsive'>
            <FieldContent className='min-w-0'>
              <FieldTitle>Diagnostics</FieldTitle>
              <FieldDescription>
                Inspect application logs or export the existing sanitized support bundle.
              </FieldDescription>
            </FieldContent>
            <div className='flex flex-wrap gap-2'>
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

function isProviderSection(section: SettingsSection): section is ProviderRole {
  return ['agent', 'embedding', 'rerank', 'mineru', 'image'].includes(section)
}
