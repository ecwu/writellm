import { useLayoutControls } from './layout-controls'
import type { ReactNode } from 'react'
import { Bot, Database, AlertCircle, PanelLeft, PanelRight, PanelTop } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { ManuscriptWorkspace } from '../../../../shared/contracts/manuscript'
import { tabId, type WorkbenchController } from './use-workbench'
import { indexLabel, taskLabel, workbenchTasks, type WorkbenchTask } from './status-model'
import { useWorkbenchStatus } from './use-workbench-status'

export function WorkbenchStatusBar(props: {
  projectSessionId: string
  workspace: ManuscriptWorkspace | undefined
  workbench: WorkbenchController
  editorActions: ReactNode
  autocomplete: ReactNode
  onKnowledge(): void
  onAgent(sessionId: string | null): void
}) {
  const { controls } = useLayoutControls()
  const state = useWorkbenchStatus(props.projectSessionId)
  const tasks = workbenchTasks(state.activity, props.workbench.tabs, props.workbench.notebookStatus)
  const index = indexLabel(state.index, state.jobs, state.indexUnavailable)
  const ai = taskLabel(tasks, state.agentState)
  const activeTab = props.workbench.tabs.find((tab) => props.workbench.activeId === tabId(tab))
  const section =
    activeTab?.kind === 'section'
      ? props.workspace?.sections.find((item) => item.section.sectionId === activeTab.sectionId)
      : undefined
  const openTask = (task: WorkbenchTask) => {
    if (task.kind === 'agent') props.onAgent(task.id)
    else {
      const tab = props.workbench.tabs.find(
        (item) => item.kind === 'notebook' && item.notebookId === task.id
      )
      if (tab) void props.workbench.open(tab)
    }
  }
  return (
    <footer
      role='contentinfo'
      aria-label='Workspace status'
      data-testid='workbench-status-bar'
      className='grid h-7 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t bg-background px-2 text-xs text-muted-foreground'
    >
      <div className='flex min-w-0 items-center gap-2'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size='xs'
              variant='ghost'
              onClick={props.onKnowledge}
              aria-label={`Index: ${index}`}
            >
              {['Processing', 'Preparing'].includes(index) ? (
                <Spinner data-icon='inline-start' />
              ) : index === 'Unavailable' ? (
                <AlertCircle data-icon='inline-start' />
              ) : (
                <Database data-icon='inline-start' />
              )}
              Index: {index}
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top'>Open Knowledge to inspect sources and indexing</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size='xs' variant='ghost' aria-label={`AI tasks: ${ai}`}>
              {tasks.some((task) => task.attention) || state.agentState === 'unavailable' ? (
                <AlertCircle data-icon='inline-start' />
              ) : tasks.some((task) => task.active) ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <Bot data-icon='inline-start' />
              )}
              AI: {ai}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='top' align='start'>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Agent and Notebooks</DropdownMenuLabel>
              {state.agentState !== 'ready' ? (
                <DropdownMenuItem disabled>Agent status {state.agentState}</DropdownMenuItem>
              ) : null}
              {tasks.map((task) => (
                <DropdownMenuItem key={`${task.kind}:${task.id}`} onSelect={() => openTask(task)}>
                  {task.label} · {task.status}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => props.onAgent(null)}>Open Agent</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className='flex shrink-0 items-center'>
        <Button
          size='icon-xs'
          variant='ghost'
          aria-label='Toggle Outline'
          title='Toggle Outline'
          aria-pressed={controls?.tools.includes('outline') ?? false}
          disabled={!controls}
          onClick={() => controls?.toggleTool('outline')}
        >
          <PanelLeft />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size='icon-xs'
              variant='ghost'
              aria-label='Switch section'
              title='Switch section'
            >
              <PanelTop />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='top' align='start' className='max-h-80 overflow-y-auto'>
            <DropdownMenuGroup>
              {props.workspace?.sections.map((item) => (
                <DropdownMenuItem
                  key={item.section.sectionId}
                  onSelect={() =>
                    void props.workbench.open({
                      kind: 'section',
                      sectionId: item.section.sectionId
                    })
                  }
                >
                  {item.section.title}
                </DropdownMenuItem>
              ))}
              {!props.workspace?.sections.length ? (
                <DropdownMenuItem disabled>No sections</DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size='icon-xs'
          variant='ghost'
          aria-label='Toggle Agent'
          title='Toggle Agent'
          aria-pressed={controls?.tools.includes('agent') ?? false}
          disabled={!controls}
          onClick={() => controls?.toggleTool('agent')}
        >
          <PanelRight />
        </Button>
      </div>
      <div className='flex min-w-0 items-center justify-end gap-3 overflow-hidden'>
        {props.workspace ? (
          <span className='truncate tabular-nums' data-testid='workbench-section-progress'>
            {props.workspace.sections.filter((item) => item.section.status === 'completed').length}/
            {props.workspace.sections.length} sections completed
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger data-testid='workbench-word-count' className='truncate tabular-nums'>
            {props.workspace ? (
              <>
                {section ? `Section ${section.revision.wordCount.toLocaleString()} / ` : ''}
                Manuscript {props.workspace.wordCount.toLocaleString()} words
              </>
            ) : (
              'Word count unavailable'
            )}
          </TooltipTrigger>
          <TooltipContent side='top'>
            {section
              ? `Section: ${section.revision.characterCount.toLocaleString()} characters. `
              : ''}
            {props.workspace
              ? `Manuscript: ${props.workspace.characterCount.toLocaleString()} characters. Counts reflect saved text.`
              : 'Waiting for manuscript statistics.'}
          </TooltipContent>
        </Tooltip>
        {props.editorActions}
        {props.autocomplete}
      </div>
    </footer>
  )
}
