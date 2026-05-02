
import { Bot, FolderOpen, GitBranch, Library, Plus, RefreshCw, Settings, Upload, X } from 'lucide-react';
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger
} from '../components/ui/menubar';
import { Separator } from '../components/ui/separator';
import { SidebarTrigger } from '../components/ui/sidebar';
import type { PublicLlmSettings } from '../../shared/types';

export function SiteHeader({
  apiAvailable,
  llmSettings,
  workspaceTitle,
  onCreateWorkspace,
  onOpenWorkspace,
  onSwitchWorkspace,
  onRefresh,
  onExport,
  onClearSelection,
  onSelectFocus,
  onGenerateFromFocus,
  onSettings,
  canExport,
  canSelectFocus,
  hasSelection
}: {
  apiAvailable: boolean;
  llmSettings: PublicLlmSettings | null;
  workspaceTitle: string;
  onCreateWorkspace: () => void;
  onOpenWorkspace: () => void;
  onSwitchWorkspace: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onClearSelection: () => void;
  onSelectFocus: () => void;
  onGenerateFromFocus: () => void;
  onSettings: () => void;
  canExport: boolean;
  canSelectFocus: boolean;
  hasSelection: boolean;
}) {
  const llmConfigured = Boolean(llmSettings?.hasApiKey);
  const llmModel = llmSettings?.model.trim() ?? '';
  const llmStatus = llmConfigured ? `Configured: ${llmModel}` : 'Not configured';

  return (
    <header className="sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-3 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="data-vertical:h-6 data-vertical:self-center" />
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Library className="size-4" />
        </div>
        <div className="grid min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">PaperLab</div>
          <div className="truncate text-xs text-muted-foreground">{workspaceTitle}</div>
        </div>
      </div>
      <Menubar className="shrink-0 border-0 bg-transparent p-0">
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem onSelect={onCreateWorkspace} disabled={!apiAvailable}>
                <Plus />
                New workspace
              </MenubarItem>
              <MenubarItem onSelect={onOpenWorkspace} disabled={!apiAvailable}>
                <FolderOpen />
                Open workspace
              </MenubarItem>
              <MenubarItem onSelect={onSwitchWorkspace} disabled={!apiAvailable}>
                <FolderOpen />
                Switch workspace...
              </MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem onSelect={onRefresh} disabled={!apiAvailable}>
                <RefreshCw />
                Refresh
              </MenubarItem>
              <MenubarItem onSelect={onExport} disabled={!canExport}>
                <Upload />
                Export main.tex
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem onSelect={onSelectFocus} disabled={!canSelectFocus}>
                <GitBranch />
                Select focused section
              </MenubarItem>
              <MenubarItem onSelect={onClearSelection} disabled={!hasSelection}>
                <X />
                Clear selection
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className="llm-menu-trigger" title={llmStatus}>
            <span>LLM</span>
            <span className={`llm-status-dot ${llmConfigured ? 'configured' : 'missing'}`} aria-hidden="true" />
            {llmConfigured && llmModel ? <span className="llm-menu-model">{llmModel}</span> : null}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarLabel>
              <span className="llm-menu-summary">
                <span className={`llm-status-dot ${llmConfigured ? 'configured' : 'missing'}`} aria-hidden="true" />
                <span>
                  <span className="llm-menu-summary-title">
                    {llmConfigured ? 'Configured' : 'Not configured'}
                  </span>
                  <span className="llm-menu-summary-detail">
                    {llmConfigured && llmModel ? llmModel : 'Add an API key in Settings'}
                  </span>
                </span>
              </span>
            </MenubarLabel>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem onSelect={onGenerateFromFocus} disabled={!apiAvailable || !canSelectFocus}>
                <Bot />
                Generate for focused section
              </MenubarItem>
              <MenubarItem onSelect={onSettings} disabled={!apiAvailable}>
                <Settings />
                Settings
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </header>
  );
}
