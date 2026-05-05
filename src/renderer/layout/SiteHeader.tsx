
import {
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '../components/ui/item';
import { Separator } from '../components/ui/separator';
import { SidebarTrigger } from '../components/ui/sidebar';
import { StatusBadge } from '../components/StatusBadge';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
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
  onCheckpoint,
  onClearSelection,
  onSelectFocus,
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
  onCheckpoint: () => void;
  onClearSelection: () => void;
  onSelectFocus: () => void;
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
          <div className="truncate text-sm font-semibold">writellm</div>
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
                Export main.md
              </MenubarItem>
              <MenubarItem onSelect={onCheckpoint} disabled={!canExport}>
                <GitBranch />
                Create checkpoint
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
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <ToggleGroup
        type="single"
        value={activePage}
        variant="outline"
        size="sm"
        spacing={0}
        className="ml-auto"
        aria-label="Primary navigation"
        onValueChange={(page) => {
          if (page) {
            onPageChange(page as AppPage);
          }
        }}
      >
        <ToggleGroupItem value="workspace">Workspace</ToggleGroupItem>
        <ToggleGroupItem value="knowledge">Knowledge</ToggleGroupItem>
      </ToggleGroup>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!apiAvailable}
        title="Settings"
        aria-label="Settings"
        onClick={onSettings}
      >
        <Settings />
      </Button>
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
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="global-task-popover">
        <PopoverHeader>
          <PopoverTitle>Background tasks</PopoverTitle>
          <PopoverDescription>{summary}</PopoverDescription>
        </PopoverHeader>
        {sortedTasks.length > 0 ? (
          <ItemGroup className="global-task-list">
            {sortedTasks.map((task) => (
              <GlobalTaskRow
                key={task.id}
                task={task}
                onRetryTask={onRetryTask}
                onDeleteTask={onDeleteTask}
              />
            ))}
          </ItemGroup>
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
    <Item variant="outline" size="sm" className="global-task-row">
      <ItemMedia variant="icon">
        <StatusIcon className={status.spin ? 'animate-spin' : undefined} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{task.fileName}</ItemTitle>
        <ItemDescription>
          <StatusBadge status={task.status}>{status.label}</StatusBadge>
          <span>Knowledge import</span>
          <span>{formatTaskDateTime(task.updatedAt)}</span>
        </ItemDescription>
      {task.errorMessage ? <p>{task.errorMessage}</p> : null}
      {task.status === 'error' ? (
        <ItemActions className="global-task-actions">
          <Button variant="outline" size="sm" onClick={() => onRetryTask(task.id)}>
            <RefreshCw />
            Retry
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onDeleteTask(task.id)}>
            <Trash2 />
            Delete
          </Button>
        </ItemActions>
      ) : null}
      </ItemContent>
    </Item>
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
