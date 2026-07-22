import type { ManuscriptWorkspace, Section } from '../../../shared/contracts/manuscript'
import {
  BookOpen,
  CheckCircle2,
  Circle,
  FileText,
  LibraryBig,
  ListTree,
  Pencil,
  Plus,
  Settings2,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar'

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  projectName: string
  workspace: ManuscriptWorkspace | undefined
  activeWorkspace: 'manuscript' | 'knowledge'
  activeSectionId: string | null
  onSelectSection(sectionId: string): void
  onCreateSection(parentSectionId: string | null): void
  onDeleteSection(sectionId: string): void
  onMoveSection(sectionId: string, parentSectionId: string | null, position: number): void
  onOpenBrief(): void
  onOpenOutlineEditor(): void
  onOpenKnowledge(): void
  onOpenManuscript(): void
  onOpenSettings(): void
}

export function AppSidebar({
  projectName,
  workspace,
  activeWorkspace,
  activeSectionId,
  onSelectSection,
  onCreateSection,
  onDeleteSection,
  onMoveSection,
  onOpenBrief,
  onOpenOutlineEditor,
  onOpenKnowledge,
  onOpenManuscript,
  onOpenSettings,
  ...props
}: AppSidebarProps): React.JSX.Element {
  const { setOpen } = useSidebar()
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null)

  const dropBefore = (target: Section): void => {
    if (draggedSectionId === null || draggedSectionId === target.sectionId || !workspace) return
    const dragged = workspace.sections.find(
      (item) => item.section.sectionId === draggedSectionId
    )?.section
    if (!dragged || dragged.parentSectionId !== target.parentSectionId) return
    const destination = workspace.sections
      .map((item) => item.section)
      .filter(
        (section) =>
          section.parentSectionId === target.parentSectionId &&
          section.sectionId !== draggedSectionId
      )
    const position = destination.findIndex((section) => section.sectionId === target.sectionId)
    if (position >= 0) onMoveSection(draggedSectionId, target.parentSectionId, position)
  }

  return (
    <Sidebar
      collapsible='icon'
      className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      {...props}
    >
      <WorkspaceRail
        activeWorkspace={activeWorkspace}
        onOpenKnowledge={onOpenKnowledge}
        onOpenManuscript={() => {
          setOpen(true)
          onOpenManuscript()
        }}
        onOpenSettings={onOpenSettings}
      />

      <Sidebar collapsible='none' className='hidden min-w-0 flex-1 overflow-hidden md:flex'>
        <SidebarHeader className='min-w-0 gap-3.5 overflow-hidden border-b p-4'>
          <div className='flex w-full min-w-0 items-center gap-2 overflow-hidden'>
            <div className='min-w-0 flex-1 truncate text-base font-medium text-foreground'>
              {projectName}
            </div>
            <Badge className='shrink-0' variant='secondary'>
              Active
            </Badge>
          </div>
          <div className='grid min-w-0 grid-cols-2 gap-2 overflow-hidden'>
            <Button
              className='w-full min-w-0 overflow-hidden px-2'
              variant='outline'
              size='sm'
              onClick={onOpenBrief}
            >
              <span className='truncate'>Brief</span>
            </Button>
            <Button
              className='w-full min-w-0 overflow-hidden px-2'
              variant='outline'
              size='sm'
              onClick={onOpenOutlineEditor}
            >
              <Pencil /> <span className='truncate'>Edit outline</span>
            </Button>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className='flex items-center justify-between'>
              <span>Outline</span>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Create top-level section'
                onClick={() => onCreateSection(null)}
              >
                <Plus />
              </Button>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workspace?.sections.map(({ section, revision }) => (
                  <SidebarMenuItem
                    key={section.sectionId}
                    draggable
                    onDragStart={() => setDraggedSectionId(section.sectionId)}
                    onDragEnd={() => setDraggedSectionId(null)}
                    onDragOver={(event) => {
                      if (draggedSectionId !== null) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      dropBefore(section)
                      setDraggedSectionId(null)
                    }}
                    className='group/outline'
                    style={{ paddingLeft: `${Math.min(5, Math.max(0, section.level - 1)) * 12}px` }}
                  >
                    <div className='flex w-full min-w-0 items-center gap-1 overflow-hidden'>
                      <SidebarMenuButton
                        isActive={section.sectionId === activeSectionId}
                        className='w-auto min-w-0 flex-1'
                        data-testid={`outline-section-${section.sectionId}`}
                        onClick={() => onSelectSection(section.sectionId)}
                      >
                        {section.status === 'completed' ? (
                          <CheckCircle2 className='text-emerald-600' />
                        ) : (
                          <Circle />
                        )}
                        <span className='min-w-0 flex-1 truncate'>{section.title}</span>
                        <span className='shrink-0 text-[10px] text-muted-foreground tabular-nums'>
                          {revision.wordCount}
                        </span>
                      </SidebarMenuButton>
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        className='opacity-0 focus:opacity-100 group-hover/outline:opacity-100'
                        aria-label={`Add subsection to ${section.title}`}
                        onClick={() => onCreateSection(section.sectionId)}
                      >
                        <Plus />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        className='opacity-0 focus:opacity-100 group-hover/outline:opacity-100'
                        aria-label={`Delete ${section.title}`}
                        onClick={() => onDeleteSection(section.sectionId)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {!workspace?.sections.length ? (
                <div className='p-4 text-center text-sm text-muted-foreground'>
                  <FileText className='mx-auto mb-2 size-5' /> No sections yet
                </div>
              ) : null}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className='shrink-0 border-t p-4'>
          <section
            className='space-y-1 text-xs text-muted-foreground'
            aria-label='Manuscript statistics'
          >
            <p>
              {workspace?.wordCount.toLocaleString() ?? 0} words ·{' '}
              {workspace?.characterCount.toLocaleString() ?? 0} characters
            </p>
            <p>
              {workspace?.sections.filter((item) => item.section.status === 'completed').length ??
                0}
              /{workspace?.sections.length ?? 0} sections completed
            </p>
          </section>
        </SidebarFooter>
      </Sidebar>
    </Sidebar>
  )
}

export function WorkspaceRail(props: {
  activeWorkspace: 'manuscript' | 'knowledge'
  onOpenKnowledge(): void
  onOpenManuscript(): void
  onOpenSettings(): void
}): React.JSX.Element {
  return (
    <Sidebar collapsible='none' className='w-[calc(var(--sidebar-width-icon)+1px)]! border-r'>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size='lg' tooltip='WriteLLM' className='md:h-8 md:p-0'>
              <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                <BookOpen className='size-4' />
              </div>
              <span className='font-medium'>WriteLLM</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className='px-1.5 md:px-0'>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={{ children: 'Manuscript', hidden: false }}
                  isActive={props.activeWorkspace === 'manuscript'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenManuscript}
                >
                  <ListTree />
                  <span>Manuscript</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={{ children: 'Knowledge', hidden: false }}
                  isActive={props.activeWorkspace === 'knowledge'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenKnowledge}
                >
                  <LibraryBig />
                  <span>Knowledge</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={{ children: 'Settings', hidden: false }}
                  onClick={props.onOpenSettings}
                >
                  <Settings2 />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
