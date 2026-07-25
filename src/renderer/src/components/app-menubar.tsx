import {
  ArchiveRestore,
  Bot,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderSync,
  Logs,
  Save,
  Settings2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger
} from '@/components/ui/menubar'

interface AppMenubarProps {
  busy: boolean
  projectSelectionDisabled: boolean
  hasProject: boolean
  agentOpen: boolean
  onCreate: () => void
  onOpen: () => void
  onSwitch: () => void
  onSave: () => void
  onCreateSnapshot: () => void
  onRestoreSnapshot: () => void
  canRestoreSnapshot: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenLogs: () => void
  onToggleAgent: () => void
}

export function AppMenubar({
  busy,
  projectSelectionDisabled,
  hasProject,
  agentOpen,
  onCreate,
  onOpen,
  onSwitch,
  onSave,
  onCreateSnapshot,
  onRestoreSnapshot,
  canRestoreSnapshot,
  onClose,
  onOpenSettings,
  onOpenLogs,
  onToggleAgent
}: AppMenubarProps): React.JSX.Element {
  return (
    <div className='relative z-50 flex h-10 shrink-0 items-center border-b bg-background px-2'>
      <span className='px-2 text-sm font-semibold'>WriteLLM</span>
      <Menubar className='h-8 border-0 shadow-none'>
        <MenubarMenu>
          <MenubarTrigger>Project</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem disabled={busy || projectSelectionDisabled} onSelect={onCreate}>
                <FilePlus2 /> New project
                <MenubarShortcut>⌘N</MenubarShortcut>
              </MenubarItem>
              <MenubarItem disabled={busy || projectSelectionDisabled} onSelect={onOpen}>
                <FolderOpen /> Open project
                <MenubarShortcut>⌘O</MenubarShortcut>
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onSwitch}>
                <FolderSync /> Switch project
              </MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem disabled={busy || !hasProject} onSelect={onSave}>
                <Save /> Save
                <MenubarShortcut>⌘S</MenubarShortcut>
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onCreateSnapshot}>
                <Save /> Create snapshot
              </MenubarItem>
              <MenubarItem disabled={busy || !canRestoreSnapshot} onSelect={onRestoreSnapshot}>
                <ArchiveRestore /> Restore snapshot
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} variant='destructive' onSelect={onClose}>
                <FileText /> Close project
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Tools</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem onSelect={onOpenSettings}>
                <Settings2 /> Settings
                <MenubarShortcut>⌘,</MenubarShortcut>
              </MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarLabel>Diagnostics</MenubarLabel>
            <MenubarGroup>
              <MenubarItem onSelect={onOpenLogs}>
                <Logs /> Open logs folder
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <Button
        className='ml-auto'
        variant={agentOpen ? 'secondary' : 'ghost'}
        size='icon-sm'
        disabled={busy || !hasProject}
        aria-label='Agent'
        aria-pressed={agentOpen}
        data-testid='agent-menubar-trigger'
        title='Toggle writing agent (⌘/Ctrl+J)'
        onClick={onToggleAgent}
      >
        <Bot />
      </Button>
    </div>
  )
}
