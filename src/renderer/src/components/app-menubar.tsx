import {
  menuCommandEnabled,
  type MenuAction,
  type MenuState
} from '../../../shared/contracts/application-menu'
import { useNativeMenu } from '@/lib/native-menu'
import {
  layoutTools,
  layoutPages,
  type LayoutControls,
  type LayoutPage
} from '@/features/workbench/layout-controls'
import type { WorkbenchTool } from '../../../shared/contracts/workbench'
import { shortcutLabel } from '@/lib/keyboard-shortcuts'
import {
  ArchiveRestore,
  Bot,
  FilePlus2,
  FileText,
  FileJson2,
  FileDown,
  FolderOpen,
  LogOut,
  Power,
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
  MenubarCheckboxItem,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger
} from '@/components/ui/menubar'

interface AppMenubarProps {
  projectSessionId: string | null
  ready: boolean
  layoutControls: LayoutControls | null
  busy: boolean
  projectSelectionDisabled: boolean
  hasProject: boolean
  agentOpen: boolean
  onCreate: () => void
  onOpen: () => void
  onQuit: () => void
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

export function AppMenubar(props: AppMenubarProps): React.JSX.Element | null {
  const {
    projectSessionId,
    ready,
    layoutControls,
    busy,
    projectSelectionDisabled,
    hasProject,
    agentOpen,
    onCreate,
    onOpen,
    onQuit,
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
  } = props
  const state: MenuState = {
    projectSessionId,
    ready,
    busy,
    modal: false,
    projectSelectionDisabled,
    hasProject,
    canRestoreSnapshot,
    versionHistoryState,
    layout: layoutControls
      ? {
          tools: layoutControls.tools,
          pages: layoutControls.pages,
          canCreateNotebook: layoutControls.canCreateNotebook
        }
      : null
  }
  const enabled = (action: MenuAction) => menuCommandEnabled({ kind: 'action', action }, state)
  useNativeMenu(state, (command) => {
    if (command.kind === 'tool') {
      layoutControls?.setTool(command.tool, !layoutControls.tools.includes(command.tool))
      return
    }
    if (command.kind === 'page') {
      layoutControls?.setPage(command.page, !layoutControls.pages.includes(command.page))
      return
    }
    if (command.action === 'newNotebook') {
      layoutControls?.newNotebook()
      return
    }
    if (command.action === 'resetLayout') {
      layoutControls?.reset()
      return
    }
    props[command.action]()
  })
  if (window.desktop.menu.native) return null
  return (
    <div className='relative z-50 flex h-10 shrink-0 items-center border-b bg-background px-2'>
      <span className='px-2 text-sm font-semibold'>WriteLLM</span>
      <Menubar className='h-8 border-0 shadow-none'>
        <MenubarMenu>
          <MenubarTrigger>Project</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem disabled={!enabled('onCreate')} onSelect={onCreate}>
                <FilePlus2 /> New project
                <MenubarShortcut>{shortcutLabel('newProject')}</MenubarShortcut>
              </MenubarItem>
              <MenubarItem disabled={!enabled('onOpen')} onSelect={onOpen}>
                <FolderOpen /> Open project
                <MenubarShortcut>{shortcutLabel('openProject')}</MenubarShortcut>
              </MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem disabled={!enabled('onSave')} onSelect={onSave}>
                <Save /> Save
                <MenubarShortcut>{shortcutLabel('save')}</MenubarShortcut>
              </MenubarItem>
              <MenubarItem disabled={!enabled('onClone')} onSelect={onClone}>
                <CopyPlus /> Save As independent copy…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onSaveTemplate')} onSelect={onSaveTemplate}>
                <FilePlus2 /> Save as reusable template…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onExportNative')} onSelect={onExportNative}>
                <FileJson2 /> Export native manuscript…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onExportMarkdown')} onSelect={onExportMarkdown}>
                <FileDown /> Export Markdown manuscript…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onExportPandoc')} onSelect={onExportPandoc}>
                <FileDown /> Export Pandoc citation package…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onExportDocx')} onSelect={onExportDocx}>
                <FileText /> Export Word manuscript…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onExportLatex')} onSelect={onExportLatex}>
                <FileText /> Export LaTeX manuscript…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onExportPdf')} onSelect={onExportPdf}>
                <FileDown /> Export PDF manuscript…
              </MenubarItem>
              <MenubarItem disabled={!enabled('onCreateSnapshot')} onSelect={onCreateSnapshot}>
                <Save /> Create snapshot
              </MenubarItem>
              <MenubarItem disabled={!enabled('onRestoreSnapshot')} onSelect={onRestoreSnapshot}>
                <ArchiveRestore /> Restore snapshot
              </MenubarItem>
              {versionHistoryState === 'uninitialized' ? (
                <MenubarItem
                  disabled={!enabled('onEnableVersionHistory')}
                  onSelect={onEnableVersionHistory}
                >
                  <History /> Enable version history…
                </MenubarItem>
              ) : versionHistoryState === 'ready' ? (
                <>
                  <MenubarItem
                    disabled={!enabled('onCreateCheckpoint')}
                    onSelect={onCreateCheckpoint}
                  >
                    <GitCommitHorizontal /> Create checkpoint…
                  </MenubarItem>
                  <MenubarItem
                    disabled={!enabled('onOpenVersionHistory')}
                    onSelect={onOpenVersionHistory}
                  >
                    <History /> Version history…
                  </MenubarItem>
                </>
              ) : versionHistoryState === 'damaged' ? (
                <MenubarItem
                  disabled={!enabled('onOpenVersionHistory')}
                  onSelect={onOpenVersionHistory}
                >
                  <TriangleAlert /> Version history unavailable…
                </MenubarItem>
              ) : null}
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem disabled={!enabled('onClose')} onSelect={onClose}>
                <LogOut /> Close project and return to chooser
              </MenubarItem>
              <MenubarItem disabled={!enabled('onQuit')} onSelect={onQuit}>
                <Power /> Quit WriteLLM
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={!enabled('onOpenFind')} onSelect={onOpenFind}>
              <Search /> Find in manuscript
              <MenubarShortcut>{shortcutLabel('find')}</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Layout</MenubarTrigger>
          <MenubarContent>
            <MenubarLabel>Tool panels</MenubarLabel>
            <MenubarGroup>
              {Object.entries(layoutTools).map(([kind, label]) => (
                <MenubarCheckboxItem
                  key={kind}
                  disabled={!enabled('resetLayout')}
                  checked={layoutControls?.tools.includes(kind as WorkbenchTool) ?? false}
                  onCheckedChange={(open) => layoutControls?.setTool(kind as WorkbenchTool, open)}
                >
                  {label}
                </MenubarCheckboxItem>
              ))}
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarLabel>Content pages</MenubarLabel>
            <MenubarGroup>
              {Object.entries(layoutPages).map(([kind, label]) => (
                <MenubarCheckboxItem
                  key={kind}
                  disabled={!enabled('resetLayout')}
                  checked={layoutControls?.pages.includes(kind as LayoutPage) ?? false}
                  onCheckedChange={(open) => layoutControls?.setPage(kind as LayoutPage, open)}
                >
                  {label}
                </MenubarCheckboxItem>
              ))}
              <MenubarItem
                disabled={!enabled('newNotebook')}
                onSelect={() => layoutControls?.newNotebook()}
              >
                New Notebook
              </MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem
                disabled={!enabled('resetLayout')}
                onSelect={() => layoutControls?.reset()}
              >
                Reset layout
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Tools</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem disabled={!enabled('onOpenSettings')} onSelect={onOpenSettings}>
                <Settings2 /> Settings
                <MenubarShortcut>{shortcutLabel('settings')}</MenubarShortcut>
              </MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarLabel>Diagnostics</MenubarLabel>
            <MenubarGroup>
              <MenubarItem disabled={!enabled('onOpenLogs')} onSelect={onOpenLogs}>
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
        title='Toggle writing agent'
        onClick={onToggleAgent}
      >
        <Bot />
      </Button>
    </div>
  )
}
