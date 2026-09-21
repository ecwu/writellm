import { useLayoutControls, type LayoutControls, type LayoutPage } from './layout-controls'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  cloneElement,
  type ReactNode,
  type ReactElement
} from 'react'
import {
  DockviewReact,
  DockviewDefaultTab,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type SerializedDockview
} from 'dockview-react'
import { MoreHorizontal, Plus, X } from 'lucide-react'
import { type AppSidebar, WorkspaceRail, type WorkspaceKind } from '@/components/app-sidebar'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import type { ManuscriptWorkspace } from '../../../../shared/contracts/manuscript'
import {
  workbenchGridSchema,
  type WorkbenchGridNode,
  type WorkbenchTool
} from '../../../../shared/contracts/workbench'
import {
  tabId,
  reportWorkbenchError,
  type ContentTab,
  type WorkbenchController
} from './use-workbench'
import { EmbeddedWorkspaceContext } from './embedded-workspace'

type SidebarElement = ReactElement<React.ComponentProps<typeof AppSidebar>>
interface Props {
  controller: WorkbenchController
  projectSessionId: string
  activeWorkspace: WorkspaceKind
  activeSectionId: string | null
  workspace: ManuscriptWorkspace | undefined
  sidebar: SidebarElement
  manuscript: ReactNode
  alternateWorkspace: ReactElement | null
  agent: ReactNode
  agentOpen: boolean
  onAgentOpenChange(open: boolean): void
  onWorkspace(kind: WorkspaceKind): void
  onError(message: string): void
}
const titles = {
  outline: 'Outline',
  agent: 'Agent',
  find: 'Find',
  references: 'References',
  writing_rules: 'Writing rules',
  comments: 'Comments',
  knowledge: 'Knowledge',
  preview: 'Preview',
  assets: 'Assets',
  checks: 'Checks'
}
const WorkbenchContext = createContext<Props | null>(null)
function useWorkbenchProps(): Props {
  const value = useContext(WorkbenchContext)
  if (!value) throw new Error('Workbench context is missing')
  return value
}
const emptyComponents = { empty: () => <></> }
const slotComponents = { slot: Slot }
function Slot(props: IDockviewPanelProps): React.JSX.Element {
  const owner = useWorkbenchProps()
  if (props.api.id === 'content') return <ContentArea />
  if (props.api.id === 'agent')
    return <div className='flex size-full min-h-0 min-w-0 overflow-hidden'>{owner.agent}</div>
  const tool = props.api.id as WorkbenchTool
  return (
    <div
      className='flex size-full min-h-0 min-w-0 overflow-hidden'
      data-testid={`workbench-tool-${tool}`}
    >
      {cloneElement(owner.sidebar, {
        toolOnly: true,
        activeWorkspace: tool === 'outline' ? 'manuscript' : (tool as WorkspaceKind),
        onCloseFind: () => {
          props.api.close()
          owner.sidebar.props.onCloseFind()
        }
      })}
    </div>
  )
}
function contentTitle(tab: ContentTab, workspace: ManuscriptWorkspace | undefined): string {
  if (tab.kind === 'section')
    return (
      workspace?.sections.find((item) => item.section.sectionId === tab.sectionId)?.section.title ??
      'Section'
    )
  if (tab.kind === 'notebook') return `Notebook ${tab.number}`
  return titles[tab.kind]
}
function ContentTabHeader(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const owner = useWorkbenchProps()
  const controller = owner.controller
  const tab = controller.tabs.find((item) => tabId(item) === props.api.id)
  const closeMany = async (right: boolean): Promise<void> => {
    const index = controller.tabs.findIndex((item) => tabId(item) === props.api.id)
    for (const candidate of right
      ? controller.tabs.slice(index + 1)
      : controller.tabs.filter((item) => tabId(item) !== props.api.id)) {
      await controller.close(candidate)
    }
  }
  return (
    <div className='flex h-full min-w-0 items-center' data-testid={`workspace-tab-${props.api.id}`}>
      <DockviewDefaultTab
        {...props}
        closeActionOverride={() => {
          if (tab) void controller.close(tab)
        }}
      />
      {tab?.kind === 'notebook' &&
      controller.notebookStatus[tab.notebookId] &&
      controller.notebookStatus[tab.notebookId] !== 'idle' ? (
        <span className='px-1 text-xs text-muted-foreground' role='status'>
          {controller.notebookStatus[tab.notebookId]}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon-sm' aria-label={`Tab actions ${props.api.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                if (tab) void controller.close(tab)
              }}
            >
              Close
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void closeMany(false)}>
              Close other tabs
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void closeMany(true)}>
              Close tabs to the right
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
function ToolTabHeader(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const owner = useWorkbenchProps()
  const { setOpen } = useSidebar()
  return (
    <div className='flex h-full min-w-0 items-center'>
      <DockviewDefaultTab {...props} hideClose />
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={props.api.id === 'agent' ? 'Close writing agent' : `Close ${props.api.title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          props.api.close()
          if (props.api.id === 'agent') owner.onAgentOpenChange(false)
          if (props.api.id === 'outline') setOpen(false)
          if (props.api.id === 'find') owner.sidebar.props.onCloseFind()
        }}
      >
        <X />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon-sm' aria-label={`Move ${props.api.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => props.api.group.api.setSize({ width: props.api.width + 40 })}
            >
              Increase panel width
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                props.api.group.api.setSize({ width: Math.max(180, props.api.width - 40) })
              }
            >
              Decrease panel width
            </DropdownMenuItem>
            {(['left', 'right', 'bottom'] as const).map((position) => (
              <DropdownMenuItem
                key={position}
                onSelect={() => {
                  const content = props.containerApi.getPanel('content')
                  if (content) props.api.moveTo({ group: content.group, position })
                }}
              >
                Move to {position}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
function ContentArea(): React.JSX.Element {
  const owner = useWorkbenchProps()
  const { controller } = owner
  const current = useRef(owner)
  current.current = owner
  const [api, setApi] = useState<DockviewApi | null>(null)
  const syncing = useRef(false)
  const [pages, setPages] = useState(new Map<string, ReactElement>())
  const active = controller.tabs.find((tab) => tabId(tab) === controller.activeId)
  useLayoutEffect(() => {
    setPages((previous) => {
      const next = new Map(
        [...previous].filter(([id]) => controller.tabs.some((tab) => tabId(tab) === id))
      )
      if (owner.alternateWorkspace && active && active.kind !== 'section')
        next.set(tabId(active), owner.alternateWorkspace)
      return next
    })
  }, [owner.alternateWorkspace, active, controller.tabs])
  const nodes = new Map(pages)
  if (active && active.kind !== 'section' && owner.alternateWorkspace)
    nodes.set(tabId(active), owner.alternateWorkspace)
  useEffect(() => {
    if (!api) return
    syncing.current = true
    const ids = new Set(controller.tabs.map(tabId))
    for (const panel of api.panels) if (!ids.has(panel.id)) api.removePanel(panel)
    for (const tab of controller.tabs) {
      const id = tabId(tab)
      const existing = api.getPanel(id)
      if (existing) existing.api.setTitle(contentTitle(tab, owner.workspace))
      else
        api.addPanel({
          id,
          component: 'empty',
          title: contentTitle(tab, owner.workspace),
          position: api.panels[0]
            ? { referencePanel: api.panels[0].id, direction: 'within' }
            : undefined,
          inactive: true
        })
    }
    if (controller.activeId) api.getPanel(controller.activeId)?.api.setActive()
    syncing.current = false
  }, [api, controller.tabs, controller.activeId, owner.workspace])
  const ready = (event: DockviewReadyEvent): void => {
    const dock = event.api
    setApi(dock)
    dock.onWillShowOverlay((drop) => {
      if (
        drop.getData()?.viewId !== dock.id ||
        (!['tab', 'header_space'].includes(drop.kind) && drop.position !== 'center')
      )
        drop.preventDefault()
    })
    dock.onWillDrop((drop) => {
      if (
        drop.getData()?.viewId !== dock.id ||
        (!['tab', 'header_space'].includes(drop.kind) && drop.position !== 'center')
      )
        drop.preventDefault()
    })
    dock.onWillDragGroup((drag) => drag.nativeEvent.preventDefault())
    dock.onDidActivePanelChange(({ panel }) => {
      if (syncing.current || !panel) return
      const owner = current.current
      const tab = owner.controller.tabs.find((item) => tabId(item) === panel.id)
      if (!tab || owner.controller.activeId === panel.id) return
      syncing.current = true
      if (owner.controller.activeId) dock.getPanel(owner.controller.activeId)?.api.setActive()
      syncing.current = false
      void owner.controller.open(tab)
    })
    dock.onDidLayoutChange(() => {
      if (syncing.current) return
      const ids = dock.groups.flatMap((group) => group.panels.map((panel) => panel.id))
      if (
        ids.length === current.current.controller.tabs.length &&
        ids.join('|') !== current.current.controller.tabs.map(tabId).join('|')
      )
        current.current.controller.reorder(ids)
    })
  }
  return (
    <div className='flex size-full min-h-0 min-w-0 flex-col'>
      <div className='flex h-9 shrink-0 border-b'>
        <div className='min-w-0 flex-1'>
          <DockviewReact
            className='workbench-theme size-full'
            components={emptyComponents}
            defaultTabComponent={ContentTabHeader}
            disableFloatingGroups
            onReady={ready}
          />
        </div>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='New Notebook'
          onClick={() => void controller.newNotebook()}
        >
          <Plus />
        </Button>
      </div>
      <div className='relative flex min-h-0 min-w-0 flex-1 overflow-hidden'>
        <div
          className={active?.kind === 'section' ? 'flex size-full min-h-0 min-w-0' : 'hidden'}
          inert={active?.kind !== 'section'}
        >
          {owner.manuscript}
        </div>
        <EmbeddedWorkspaceContext.Provider value>
          {[...nodes]
            .filter(([id]) => controller.tabs.some((tab) => tabId(tab) === id))
            .map(([id, node]) => (
              <div
                key={id}
                className={id === controller.activeId ? 'flex size-full min-h-0 min-w-0' : 'hidden'}
                inert={id !== controller.activeId}
              >
                {node}
              </div>
            ))}
        </EmbeddedWorkspaceContext.Provider>
        {!active ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No open tabs</EmptyTitle>
              <EmptyDescription>
                Open a section or choose a workspace from the activity bar.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
    </div>
  )
}
function sanitizeNode(node: SerializedDockview['grid']['root']): WorkbenchGridNode {
  const size = node.size === undefined ? {} : { size: node.size }
  if (node.type === 'branch' && Array.isArray(node.data))
    return { type: 'branch', ...size, data: node.data.map(sanitizeNode) }
  const data = node.data as { id: string; views: string[]; activeView?: string }
  return {
    type: 'leaf',
    ...size,
    data: {
      id: data.id,
      views: data.views,
      ...(data.activeView ? { activeView: data.activeView } : {})
    }
  }
}
function addTool(dock: DockviewApi, tool: WorkbenchTool): void {
  const existing = dock.getPanel(tool)
  if (existing) {
    existing.api.setActive()
    return
  }
  dock.addPanel({
    id: tool,
    component: 'slot',
    title: titles[tool],
    renderer: 'always',
    minimumWidth: tool === 'agent' ? 320 : 180,
    initialWidth:
      tool === 'agent'
        ? Math.max(320, Math.min(420, dock.width * 0.32))
        : Math.max(180, Math.min(240, dock.width * 0.2)),
    position: { referencePanel: 'content', direction: tool === 'agent' ? 'right' : 'left' }
  })
}

export function DockingWorkbench(props: Props): React.JSX.Element {
  const [api, setApi] = useState<DockviewApi | null>(null)
  const { setControls } = useLayoutControls()
  const [panelIds, setPanelIds] = useState('')
  const { open: outlineOpen, setOpen: setOutlineOpen } = useSidebar()
  const initialVisibility = useRef<{ agent: boolean; outline: boolean } | null>(null)
  const current = useRef(props)
  current.current = props
  const ready = ({ api: dock }: DockviewReadyEvent): void => {
    const layout = current.current.controller.initialLayout?.tools
    try {
      if (layout) {
        const grid = workbenchGridSchema.parse(layout)
        const ids: string[] = []
        const collect = (node: WorkbenchGridNode): void => {
          if (node.type === 'branch') node.data.forEach(collect)
          else ids.push(...node.data.views)
        }
        collect(grid.root)
        const panels = Object.fromEntries(
          ids.map((id) => [
            id,
            {
              id,
              contentComponent: 'slot',
              title: id === 'content' ? 'Workspace' : titles[id as WorkbenchTool],
              renderer: 'always' as const
            }
          ])
        )
        dock.fromJSON({ grid: grid as SerializedDockview['grid'], panels })
        initialVisibility.current = {
          agent: ids.includes('agent'),
          outline: ids.includes('outline')
        }
      } else {
        dock.addPanel({ id: 'content', component: 'slot', renderer: 'always', minimumWidth: 240 })
        addTool(dock, 'outline')
        addTool(dock, 'agent')
        initialVisibility.current = { agent: true, outline: true }
      }
    } catch (err) {
      reportWorkbenchError(err, 'workbench.dock.restore')
      dock.clear()
      dock.addPanel({ id: 'content', component: 'slot', renderer: 'always', minimumWidth: 240 })
      addTool(dock, 'outline')
      current.current.onError('The saved layout was invalid. The default layout has been restored.')
    }
    const content = dock.getPanel('content')
    if (!content) throw new Error('Content group is missing')
    for (const panel of dock.panels)
      panel.api.setConstraints({
        minimumWidth: panel.id === 'agent' ? 320 : panel.id === 'content' ? 240 : 180
      })
    content.group.header.hidden = true
    dock.onWillDragPanel((event) => {
      if (event.panel.id === 'content') event.nativeEvent.preventDefault()
    })
    dock.onWillDragGroup((event) => {
      if (event.group.panels.some((panel) => panel.id === 'content'))
        event.nativeEvent.preventDefault()
    })
    dock.onWillShowOverlay((drop) => {
      if (
        drop.getData()?.viewId !== dock.id ||
        (drop.group?.panels.some((panel) => panel.id === 'content') &&
          ['center', 'top'].includes(drop.position))
      )
        drop.preventDefault()
    })
    dock.onWillDrop((drop) => {
      if (
        drop.getData()?.viewId !== dock.id ||
        (drop.group?.panels.some((panel) => panel.id === 'content') &&
          ['center', 'top'].includes(drop.position))
      )
        drop.preventDefault()
    })
    setPanelIds(
      dock.panels
        .map((panel) => panel.id)
        .sort()
        .join('|')
    )
    dock.onDidLayoutChange(() => {
      setPanelIds(
        dock.panels
          .map((panel) => panel.id)
          .sort()
          .join('|')
      )
      const json = dock.toJSON()
      const result = workbenchGridSchema.safeParse({
        ...json.grid,
        root: sanitizeNode(json.grid.root)
      })
      if (result.success) current.current.controller.setTools(result.data)
    })
    if (initialVisibility.current) {
      current.current.onAgentOpenChange(initialVisibility.current.agent)
      setOutlineOpen(initialVisibility.current.outline)
    }
    setApi(dock)
  }
  useEffect(() => {
    if (!api) return
    if (initialVisibility.current && props.agentOpen !== initialVisibility.current.agent) return
    initialVisibility.current = null
    if (props.agentOpen) addTool(api, 'agent')
    else {
      const panel = api.getPanel('agent')
      if (panel) api.removePanel(panel)
    }
  }, [api, props.agentOpen])
  useEffect(() => {
    const request = props.controller.toolRequest
    if (!api || !request) return
    if (request.open) addTool(api, request.kind)
    else {
      const panel = api.getPanel(request.kind)
      if (panel) api.removePanel(panel)
    }
  }, [api, props.controller.toolRequest])
  useEffect(() => {
    if (!api || initialVisibility.current) return
    if (outlineOpen) addTool(api, 'outline')
    else {
      const panel = api.getPanel('outline')
      if (panel) api.removePanel(panel)
    }
  }, [api, outlineOpen])
  const reset = (): void => {
    if (!api) return
    for (const panel of [...api.panels])
      if (!['content', 'outline', 'agent'].includes(panel.id)) api.removePanel(panel)
    setOutlineOpen(true)
    props.onAgentOpenChange(true)
    addTool(api, 'outline')
    const content = api.getPanel('content')
    if (!content) return
    api.getPanel('outline')?.api.moveTo({ group: content.group, position: 'left' })
    api
      .getPanel('outline')
      ?.group.api.setSize({ width: Math.max(180, Math.min(240, api.width * 0.2)) })
    addTool(api, 'agent')
    api.getPanel('agent')?.api.moveTo({ group: content.group, position: 'right' })
    api
      .getPanel('agent')
      ?.group.api.setSize({ width: Math.max(320, Math.min(420, api.width * 0.32)) })
  }
  const resetRef = useRef(reset)
  resetRef.current = reset
  useEffect(() => {
    if (!api) return
    let live = true
    const tabs = props.controller.tabs
    const controls: LayoutControls = {
      projectSessionId: current.current.projectSessionId,
      tools: panelIds.split('|').filter((id) => id && id !== 'content') as WorkbenchTool[],
      pages: tabs.flatMap((tab) =>
        tab.kind !== 'section' && tab.kind !== 'notebook' ? [tab.kind as LayoutPage] : []
      ),
      canCreateNotebook: tabs.filter((tab) => tab.kind === 'notebook').length < 10,
      setTool(tool, open) {
        if (!live) return
        if (tool === 'agent') current.current.onAgentOpenChange(open)
        if (tool === 'outline') setOutlineOpen(open)
        if (open) addTool(api, tool)
        else {
          const panel = api.getPanel(tool)
          if (panel) api.removePanel(panel)
          if (tool === 'find') current.current.sidebar.props.onCloseFind()
        }
      },
      setPage(kind, open) {
        if (!live) return
        const workbench = current.current.controller
        if (open) void workbench.open({ kind })
        else {
          const tab = workbench.tabs.find((item) => item.kind === kind)
          if (tab) void workbench.close(tab)
        }
      },
      newNotebook() {
        if (live) void current.current.controller.newNotebook()
      },
      reset() {
        if (live) resetRef.current()
      }
    }
    setControls(controls)
    return () => {
      live = false
      setControls((previous) => (previous === controls ? null : previous))
    }
  }, [api, panelIds, props.controller.tabs, setControls, setOutlineOpen])
  return (
    <WorkbenchContext.Provider value={props}>
      <div
        className='workbench-root isolate flex size-full min-h-0 min-w-0'
        data-testid='tabbed-workbench'
      >
        <WorkspaceRail
          {...props.sidebar.props}
          agentOpen={props.agentOpen}
          onToggleAgent={
            window.desktop.menu.native ? () => props.onAgentOpenChange(!props.agentOpen) : undefined
          }
          onOpenComments={() => {
            if (api) addTool(api, 'comments')
            props.onWorkspace('comments')
          }}
          onOpenFind={() => {
            if (api) addTool(api, 'find')
            props.onWorkspace('find')
          }}
          onOpenReferences={() => {
            if (api) addTool(api, 'references')
            props.onWorkspace('references')
          }}
          onOpenWritingRules={() => {
            if (api) addTool(api, 'writing_rules')
            props.onWorkspace('writing_rules')
          }}
          onOpenManuscript={() => {
            setOutlineOpen(true)
            if (api) addTool(api, 'outline')
            void props.controller.openRecentSection()
          }}
        />
        <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
          <div className='min-h-0 min-w-0 flex-1'>
            {props.controller.ready ? (
              <DockviewReact
                className='workbench-theme size-full'
                components={slotComponents}
                defaultTabComponent={ToolTabHeader}
                disableFloatingGroups
                onReady={ready}
              />
            ) : null}
          </div>
        </div>
      </div>
      <AlertDialog
        open={props.controller.closeRequest !== null}
        onOpenChange={(open) => {
          if (!open) props.controller.confirmClose(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Notebook?</AlertDialogTitle>
            <AlertDialogDescription>
              This temporary conversation and draft will be discarded. Any running answer will stop.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep open</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                props.controller.confirmClose(true)
              }}
            >
              Close Notebook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkbenchContext.Provider>
  )
}
