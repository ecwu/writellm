
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FolderOpen,
  GitBranch,
  Library,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  X
} from 'lucide-react';
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '../components/ui/popover';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { SidebarTrigger } from '../components/ui/sidebar';
import type { KnowledgeIngestJobRecord, KnowledgeIngestStatus, PublicLlmSettings } from '../../shared/types';
import type { AppPage } from '../app/types';

export function SiteHeader({
  apiAvailable,
  llmSettings,
  workspaceTitle,
  activePage,
  onPageChange,
  onCreateWorkspace,
  onOpenWorkspace,
  onSwitchWorkspace,
  onRefresh,
  onExport,
  onClearSelection,
  onSelectFocus,
  onGenerateFromFocus,
  onSettings,
  onRetryTask,
  onDeleteTask,
  canExport,
  canSelectFocus,
  hasSelection,
  tasks
}: {
  apiAvailable: boolean;
  llmSettings: PublicLlmSettings | null;
  workspaceTitle: string;
  activePage: AppPage;
  onPageChange: (page: AppPage) => void;
  onCreateWorkspace: () => void;
  onOpenWorkspace: () => void;
  onSwitchWorkspace: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onClearSelection: () => void;
  onSelectFocus: () => void;
  onGenerateFromFocus: () => void;
  onSettings: () => void;
  onRetryTask: (jobId: string) => void;
  onDeleteTask: (jobId: string) => void;
  canExport: boolean;
  canSelectFocus: boolean;
  hasSelection: boolean;
  tasks: KnowledgeIngestJobRecord[];
}) {
  const llmConfigured = Boolean(llmSettings?.chat.hasApiKey && llmSettings.embedding.hasApiKey);
  const llmModel = llmSettings?.chat.model.trim() ?? '';
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
      <div className="app-page-switcher ml-auto" aria-label="Primary navigation">
        <button
          type="button"
          className={activePage === 'workspace' ? 'active' : undefined}
          onClick={() => onPageChange('workspace')}
        >
          Workspace
        </button>
        <button
          type="button"
          className={activePage === 'knowledge' ? 'active' : undefined}
          onClick={() => onPageChange('knowledge')}
        >
          Knowledge
        </button>
      </div>
      <GlobalTaskQueuePopover
        tasks={tasks}
        disabled={!apiAvailable}
        onRetryTask={onRetryTask}
        onDeleteTask={onDeleteTask}
      />
    </header>
  );
}

function GlobalTaskQueuePopover({
  tasks,
  disabled,
  onRetryTask,
  onDeleteTask
}: {
  tasks: KnowledgeIngestJobRecord[];
  disabled: boolean;
  onRetryTask: (jobId: string) => void;
  onDeleteTask: (jobId: string) => void;
}) {
  const activeCount = tasks.filter((task) => isActiveTaskStatus(task.status)).length;
  const failedCount = tasks.filter((task) => task.status === 'error').length;
  const completedCount = tasks.filter((task) => task.status === 'indexed').length;
  const summary = failedCount > 0
    ? `${failedCount} failed task${failedCount === 1 ? '' : 's'}`
    : activeCount > 0
      ? `${activeCount} active task${activeCount === 1 ? '' : 's'}`
      : completedCount > 0
        ? `${completedCount} completed task${completedCount === 1 ? '' : 's'}`
        : 'No background tasks';
  const badgeCount = failedCount || activeCount;
  const sortedTasks = [...tasks].sort((left, right) =>
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`global-task-trigger ${failedCount > 0 ? 'error' : activeCount > 0 ? 'active' : ''}`}
          disabled={disabled}
          title={summary}
          aria-label={`Background tasks: ${summary}`}
        >
          <ListChecks />
          {badgeCount > 0 ? <span>{badgeCount > 99 ? '99+' : badgeCount}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="global-task-popover">
        <PopoverHeader>
          <PopoverTitle>Background tasks</PopoverTitle>
          <PopoverDescription>{summary}</PopoverDescription>
        </PopoverHeader>
        {sortedTasks.length > 0 ? (
          <div className="global-task-list">
            {sortedTasks.map((task) => (
              <GlobalTaskRow
                key={task.id}
                task={task}
                onRetryTask={onRetryTask}
                onDeleteTask={onDeleteTask}
              />
            ))}
          </div>
        ) : (
          <p className="global-task-empty">No queued, running, or archived tasks.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function GlobalTaskRow({
  task,
  onRetryTask,
  onDeleteTask
}: {
  task: KnowledgeIngestJobRecord;
  onRetryTask: (jobId: string) => void;
  onDeleteTask: (jobId: string) => void;
}) {
  const status = getTaskStatusView(task.status);
  const StatusIcon = status.icon;
  return (
    <article className={`global-task-row ${task.status}`}>
      <div className="global-task-row-main">
        <StatusIcon className={status.spin ? 'animate-spin' : undefined} />
        <div>
          <strong>{task.fileName}</strong>
          <span>{status.label} · Knowledge import · {formatTaskDateTime(task.updatedAt)}</span>
        </div>
      </div>
      {task.errorMessage ? <p>{task.errorMessage}</p> : null}
      {task.status === 'error' ? (
        <div className="global-task-actions">
          <Button variant="outline" size="sm" onClick={() => onRetryTask(task.id)}>
            <RefreshCw />
            Retry
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onDeleteTask(task.id)}>
            <Trash2 />
            Delete
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function isActiveTaskStatus(status: KnowledgeIngestStatus): boolean {
  return status === 'queued' ||
    status === 'uploading' ||
    status === 'extracting' ||
    status === 'downloading' ||
    status === 'indexing';
}

function getTaskStatusView(status: KnowledgeIngestStatus) {
  switch (status) {
    case 'queued':
      return { label: 'Queued', icon: Clock3, spin: false };
    case 'uploading':
      return { label: 'Uploading', icon: LoaderCircle, spin: true };
    case 'extracting':
      return { label: 'Extracting', icon: LoaderCircle, spin: true };
    case 'downloading':
      return { label: 'Downloading', icon: LoaderCircle, spin: true };
    case 'indexing':
      return { label: 'Indexing', icon: LoaderCircle, spin: true };
    case 'indexed':
      return { label: 'Indexed', icon: CheckCircle2, spin: false };
    case 'error':
      return { label: 'Error', icon: CircleAlert, spin: false };
  }
}

function formatTaskDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}
