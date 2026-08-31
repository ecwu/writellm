import {
  ArchiveRestore,
  Bot,
  FilePlus2,
  FileText,
  FileJson2,
  FileDown,
  FolderOpen,
  FolderSync,
  GitCommitHorizontal,
  History,
  Logs,
  Save,
  CopyPlus,
  Search,
  Settings2,
  TriangleAlert
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
  onClone: () => void
  onSaveTemplate: () => void
  onExportNative: () => void
  onExportMarkdown: () => void
  onExportPandoc: () => void
  onExportDocx: () => void
  onExportLatex: () => void
  onExportPdf: () => void
  onCreateSnapshot: () => void
  onRestoreSnapshot: () => void
  versionHistoryState: 'uninitialized' | 'ready' | 'damaged' | null
  onEnableVersionHistory: () => void
  onCreateCheckpoint: () => void
  onOpenVersionHistory: () => void
  canRestoreSnapshot: boolean
  onClose: () => void
  onOpenSettings: () => void
  onOpenLogs: () => void
  onToggleAgent: () => void
  onOpenFind: () => void
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
  onClone,
  onSaveTemplate,
  onExportNative,
  onExportMarkdown,
  onExportPandoc,
  onExportDocx,
  onExportLatex,
  onExportPdf,
  onCreateSnapshot,
  onRestoreSnapshot,
  versionHistoryState,
  onEnableVersionHistory,
  onCreateCheckpoint,
  onOpenVersionHistory,
  canRestoreSnapshot,
  onClose,
  onOpenSettings,
  onOpenLogs,
  onToggleAgent,
  onOpenFind
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
              <MenubarItem disabled={busy || !hasProject} onSelect={onClone}>
                <CopyPlus /> Save As independent copy…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onSaveTemplate}>
                <FilePlus2 /> Save as reusable template…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onExportNative}>
                <FileJson2 /> Export native manuscript…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onExportMarkdown}>
                <FileDown /> Export Markdown manuscript…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onExportPandoc}>
                <FileDown /> Export Pandoc citation package…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onExportDocx}>
                <FileText /> Export Word manuscript…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onExportLatex}>
                <FileText /> Export LaTeX manuscript…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onExportPdf}>
                <FileDown /> Export PDF manuscript…
              </MenubarItem>
              <MenubarItem disabled={busy || !hasProject} onSelect={onCreateSnapshot}>
                <Save /> Create snapshot
              </MenubarItem>
              <MenubarItem disabled={busy || !canRestoreSnapshot} onSelect={onRestoreSnapshot}>
                <ArchiveRestore /> Restore snapshot
              </MenubarItem>
              {versionHistoryState === 'uninitialized' ? (
                <MenubarItem disabled={busy || !hasProject} onSelect={onEnableVersionHistory}>
                  <History /> Enable version history…
                </MenubarItem>
              ) : versionHistoryState === 'ready' ? (
                <>
                  <MenubarItem disabled={busy || !hasProject} onSelect={onCreateCheckpoint}>
                    <GitCommitHorizontal /> Create checkpoint…
                  </MenubarItem>
                  <MenubarItem disabled={busy || !hasProject} onSelect={onOpenVersionHistory}>
                    <History /> Version history…
                  </MenubarItem>
                </>
              ) : versionHistoryState === 'damaged' ? (
                <MenubarItem disabled={busy || !hasProject} onSelect={onOpenVersionHistory}>
                  <TriangleAlert /> Version history unavailable…
                </MenubarItem>
              ) : null}
              <MenubarItem disabled={busy || !hasProject} variant='destructive' onSelect={onClose}>
                <FileText /> Close project
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={busy || !hasProject} onSelect={onOpenFind}>
              <Search /> Find in manuscript
              <MenubarShortcut>⌘F</MenubarShortcut>
            </MenubarItem>
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
