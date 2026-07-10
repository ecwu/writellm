
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
  const modelStatuses = modelStatusItems(llmSettings);
  const llmModel = llmSettings?.chat.model.trim() ?? '';
  const llmConfigured = Boolean(llmSettings?.chat.hasApiKey && llmModel);
  const configuredModelCount = modelStatuses.filter((model) => model.status === 'configured').length;
  const activeModelCount = modelStatuses.filter((model) => model.status !== 'disabled').length;
  const modelsConfigured = activeModelCount > 0 && modelStatuses.every((model) =>
    model.status === 'configured' || model.status === 'disabled'
  );
  const modelStatus = modelsConfigured
    ? `${configuredModelCount}/${modelStatuses.length} configured`
    : `${configuredModelCount}/${modelStatuses.length} configured`;

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
          <MenubarTrigger className="llm-menu-trigger" title={modelStatus}>
            <span>Model</span>
            <span className={`llm-status-dot ${llmConfigured ? 'configured' : 'missing'}`} aria-hidden="true" />
            {llmModel ? <span className="llm-menu-model">{llmModel}</span> : null}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarLabel>
              <span className="llm-menu-summary">
                <span className={`llm-status-dot ${modelsConfigured ? 'configured' : 'missing'}`} aria-hidden="true" />
                <span>
                  <span className="llm-menu-summary-title">Model status</span>
                  <span className="llm-menu-summary-detail">{modelStatus}</span>
                </span>
              </span>
            </MenubarLabel>
            <MenubarSeparator />
            <MenubarGroup>
              {modelStatuses.map((model) => (
                <MenubarLabel key={model.id} className="llm-menu-model-row">
                  <span className={`llm-status-dot ${model.status}`} aria-hidden="true" />
                  <span className="llm-menu-model-row-copy">
                    <span className="llm-menu-model-row-title">{model.label}</span>
                    <span className="llm-menu-model-row-detail">{model.detail}</span>
                  </span>
                </MenubarLabel>
              ))}
            </MenubarGroup>
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
        <ToggleGroupItem value="project">Project Brief</ToggleGroupItem>
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

type HeaderModelStatus = {
  id: string;
  label: string;
  detail: string;
  status: 'configured' | 'missing' | 'disabled';
};

function modelStatusItems(settings: PublicLlmSettings | null): HeaderModelStatus[] {
  return [
    modelStatusItem('llm', 'Assistant', settings?.chat.model, settings?.chat.hasApiKey),
    modelStatusItem('embedding', 'Embedding', settings?.embedding.model, settings?.embedding.hasApiKey),
    modelStatusItem(
      'rerank',
      'Rerank',
      settings?.rerank.model,
      settings?.rerank.hasApiKey,
      settings?.rerank.enabled === false
    ),
    modelStatusItem('vision', 'Vision', settings?.vision.model, settings?.vision.hasApiKey)
  ];
}

function modelStatusItem(
  id: string,
  label: string,
  model: string | undefined,
  hasApiKey: boolean | undefined,
  disabled = false
): HeaderModelStatus {
  if (disabled) {
    return { id, label, detail: 'Disabled', status: 'disabled' };
  }
  const normalizedModel = model?.trim();
  if (hasApiKey && normalizedModel) {
    return { id, label, detail: normalizedModel, status: 'configured' };
  }
  return { id, label, detail: normalizedModel ? 'API key missing' : 'Not configured', status: 'missing' };
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
  const taskWindow = getTaskWindow(tasks);
  const activeCount = taskWindow.current.length;
  const queuedCount = tasks.filter((task) => task.status === 'queued').length;
  const failedCount = tasks.filter((task) => task.status === 'error').length;
  const summary = failedCount > 0
    ? `${failedCount} failed task${failedCount === 1 ? '' : 's'}`
    : activeCount > 0
      ? `${activeCount} importing · ${queuedCount} remaining`
      : queuedCount > 0
        ? `${queuedCount} import task${queuedCount === 1 ? '' : 's'} waiting`
        : 'No active imports';

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
          <PopoverTitle>Import queue</PopoverTitle>
          <PopoverDescription>{summary}</PopoverDescription>
        </PopoverHeader>
        {taskWindow.recent.length + taskWindow.current.length + taskWindow.upNext.length > 0 ? (
          <ItemGroup className="global-task-list">
            <TaskQueueGroup title="Just finished" tasks={taskWindow.recent} onRetryTask={onRetryTask} onDeleteTask={onDeleteTask} />
            <TaskQueueGroup title="In progress" tasks={taskWindow.current} onRetryTask={onRetryTask} onDeleteTask={onDeleteTask} />
            <TaskQueueGroup title={queuedCount > taskWindow.upNext.length ? `Up next · ${queuedCount} waiting` : 'Up next'} tasks={taskWindow.upNext} onRetryTask={onRetryTask} onDeleteTask={onDeleteTask} />
          </ItemGroup>
        ) : (
          <p className="global-task-empty">No import tasks.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TaskQueueGroup({
  title,
  tasks,
  onRetryTask,
  onDeleteTask
}: {
  title: string;
  tasks: KnowledgeIngestJobRecord[];
  onRetryTask: (jobId: string) => void;
  onDeleteTask: (jobId: string) => void;
}) {
  if (tasks.length === 0) {
    return null;
  }
  return (
    <section className="global-task-group">
      <p>{title}</p>
      {tasks.map((task) => (
        <GlobalTaskRow key={task.id} task={task} onRetryTask={onRetryTask} onDeleteTask={onDeleteTask} />
      ))}
    </section>
  );
}

function getTaskWindow(tasks: KnowledgeIngestJobRecord[]) {
  const byNewest = [...tasks].sort((left, right) =>
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
  const current = byNewest.filter((task) => isActiveTaskStatus(task.status) && task.status !== 'queued').slice(0, 1);
  const currentIds = new Set(current.map((task) => task.id));
  return {
    recent: byNewest.filter((task) => task.status === 'indexed' || task.status === 'error').slice(0, 1),
    current,
    upNext: [...tasks]
      .filter((task) => task.status === 'queued' && !currentIds.has(task.id))
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .slice(0, 2)
  };
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
