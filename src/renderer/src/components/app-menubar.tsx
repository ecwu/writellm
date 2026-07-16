import { FilePlus2, FileText, FolderOpen, FolderSync, Logs, Save, Settings2 } from 'lucide-react'
import {
  Menubar,
  MenubarContent,
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
  onCreate: () => void
  onOpen: () => void
  onSwitch: () => void
  onSave: () => void
  onClose: () => void
  onOpenSettings: () => void
  onOpenLogs: () => void
}

export function AppMenubar({
  busy,
  projectSelectionDisabled,
  hasProject,
  onCreate,
  onOpen,
  onSwitch,
  onSave,
  onClose,
  onOpenSettings,
  onOpenLogs
}: AppMenubarProps): React.JSX.Element {
  return (
    <div className='relative z-50 flex h-10 shrink-0 items-center border-b bg-background px-2'>
      <span className='px-2 text-sm font-semibold'>WriteLLM</span>
      <Menubar className='h-8 border-0 shadow-none'>
        <MenubarMenu>
          <MenubarTrigger>Project</MenubarTrigger>
          <MenubarContent>
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
            <MenubarSeparator />
            <MenubarItem disabled={busy || !hasProject} onSelect={onSave}>
              <Save /> Save
              <MenubarShortcut>⌘S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled={busy || !hasProject} variant='destructive' onSelect={onClose}>
              <FileText /> Close project
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Tools</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onOpenSettings}>
              <Settings2 /> Settings
              <MenubarShortcut>⌘,</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarLabel>Diagnostics</MenubarLabel>
            <MenubarItem onSelect={onOpenLogs}>
              <Logs /> Open logs folder
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  )
}
