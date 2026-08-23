import type {
  ManuscriptReferenceEntry,
  ManuscriptReferenceIndex,
  ManuscriptWorkspace,
  SectionStatus
} from '../../../shared/contracts/manuscript'
import {
  BookOpen,
  BookOpenText,
  BookMarked,
  CheckCircle2,
  Circle,
  CircleDot,
  FileText,
  LibraryBig,
  NotebookPen,
  ListChecks,
  Images,
  ClipboardList,
  ListTree,
  Pencil,
  Search,
  Settings2,
  X
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
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

export type WorkspaceKind =
  | 'manuscript'
  | 'preview'
  | 'knowledge'
  | 'notebook'
  | 'checks'
  | 'assets'
  | 'references'
  | 'find'
  | 'issues'
  | 'writing_rules'

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  projectName: string
  workspace: ManuscriptWorkspace | undefined
  references: ManuscriptReferenceIndex
  referencesLoading: boolean
  referencesError: boolean
  activeWorkspace: WorkspaceKind
  activeSectionId: string | null
  reviewCount?: number
  onSelectSection(sectionId: string): void
  onOpenBrief(): void
  onOpenOutlineEditor(): void
  onOpenPreview(): void
  onOpenKnowledge(): void
  onOpenNotebook?(): void
  onOpenChecks(): void
  onOpenAssets(): void
  onOpenReferences(): void
  onOpenIssues(): void
  onOpenWritingRules(): void
  onOpenFind(): void
  onCloseFind(): void
  onOpenReference(entry: ManuscriptReferenceEntry): void
  onOpenManuscript(): void
  onOpenSettings(): void
  findPanel: React.ReactNode
  issuesPanel: React.ReactNode
  writingRulesPanel: React.ReactNode
}

export function AppSidebar({
  projectName,
  workspace,
  references,
  referencesLoading,
  referencesError,
  activeWorkspace,
  activeSectionId,
  reviewCount,
  onSelectSection,
  onOpenBrief,
  onOpenOutlineEditor,
  onOpenPreview,
  onOpenKnowledge,
  onOpenNotebook,
  onOpenChecks,
  onOpenAssets,
  onOpenReferences,
  onOpenIssues,
  onOpenWritingRules,
  onOpenFind,
  onCloseFind,
  onOpenReference,
  onOpenManuscript,
  onOpenSettings,
  findPanel,
  issuesPanel,
  writingRulesPanel,
  ...props
}: AppSidebarProps): React.JSX.Element {
  const { isMobile, openMobile, setOpen, setOpenMobile } = useSidebar()
  const findWasOpenOnMobileRef = useRef(false)

  useEffect(() => {
    if (!['find', 'issues', 'writing_rules', 'references'].includes(activeWorkspace)) return
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }, [activeWorkspace, isMobile, setOpen, setOpenMobile])

  useEffect(() => {
    if (!isMobile || activeWorkspace !== 'find') {
      findWasOpenOnMobileRef.current = false
      return
    }
    if (openMobile) {
      findWasOpenOnMobileRef.current = true
    } else if (findWasOpenOnMobileRef.current) {
      findWasOpenOnMobileRef.current = false
      onCloseFind()
    }
  }, [activeWorkspace, isMobile, onCloseFind, openMobile])

  return (
    <Sidebar collapsible='icon' className='top-10 bottom-0 h-auto overflow-hidden' {...props}>
      <div className='flex min-h-0 flex-1'>
        <WorkspaceRail
          activeWorkspace={activeWorkspace}
          onOpenPreview={onOpenPreview}
          onOpenKnowledge={onOpenKnowledge}
          onOpenNotebook={onOpenNotebook}
          onOpenChecks={onOpenChecks}
          onOpenAssets={onOpenAssets}
          onOpenReferences={() => {
            setOpen(true)
            onOpenReferences()
          }}
          onOpenIssues={() => {
            setOpen(true)
            onOpenIssues()
          }}
          reviewCount={reviewCount}
          onOpenWritingRules={() => {
            setOpen(true)
            onOpenWritingRules()
          }}
          onOpenFind={() => {
            setOpen(true)
            onOpenFind()
          }}
          onOpenManuscript={() => {
            setOpen(true)
            onOpenManuscript()
          }}
          onOpenSettings={onOpenSettings}
        />

        <Sidebar collapsible='none' className='min-w-0 flex-1 overflow-hidden'>
          <SidebarHeader className='min-w-0 gap-3.5 overflow-hidden border-b p-4'>
            <div className='flex w-full min-w-0 items-center gap-2 overflow-hidden'>
              <div className='min-w-0 flex-1 truncate text-base font-medium text-foreground'>
                {projectName}
              </div>
              <Badge className='shrink-0 max-md:hidden' variant='success'>
                Active
              </Badge>
              {activeWorkspace === 'find' ? (
                <Button
                  aria-label='Close Find'
                  className='shrink-0'
                  size='icon-sm'
                  variant='ghost'
                  onClick={() => {
                    setOpenMobile(false)
                    onCloseFind()
                  }}
                >
                  <X />
                </Button>
              ) : null}
            </div>
            {activeWorkspace === 'manuscript' || activeWorkspace === 'references' ? (
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
            ) : null}
          </SidebarHeader>
          <SidebarContent className={activeWorkspace === 'find' ? 'overflow-hidden' : undefined}>
            {activeWorkspace === 'find' ? (
              findPanel
            ) : activeWorkspace === 'issues' ? (
              issuesPanel
            ) : activeWorkspace === 'writing_rules' ? (
              writingRulesPanel
            ) : (
              <SidebarGroup>
                <SidebarGroupLabel>
                  {activeWorkspace === 'references' ? 'References' : 'Outline'}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  {activeWorkspace === 'references' ? (
                    <ReferenceList
                      references={references}
                      loading={referencesLoading}
                      error={referencesError}
                      onOpenReference={onOpenReference}
                    />
                  ) : (
                    <SidebarMenu>
                      {workspace?.sections.map(({ section, revision }) => (
                        <SidebarMenuItem
                          key={section.sectionId}
                          style={{
                            paddingLeft: `${Math.min(5, Math.max(0, section.level - 1)) * 12}px`
                          }}
                        >
                          <SidebarMenuButton
                            isActive={section.sectionId === activeSectionId}
                            className='min-w-0'
                            data-testid={`outline-section-${section.sectionId}`}
                            onClick={() => onSelectSection(section.sectionId)}
                          >
                            <SidebarStatusIcon status={section.status} />
                            <span className='min-w-0 flex-1 truncate'>{section.title}</span>
                            <span
                              className='shrink-0 text-[10px] text-muted-foreground tabular-nums'
                              data-testid={`outline-word-count-${section.sectionId}`}
                            >
                              {revision.wordCount}
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  )}
                  {activeWorkspace !== 'references' && !workspace?.sections.length ? (
                    <Empty className='gap-2 border-0 p-4'>
                      <EmptyHeader>
                        <EmptyMedia variant='icon'>
                          <FileText />
                        </EmptyMedia>
                        <EmptyTitle className='text-sm'>No sections yet</EmptyTitle>
                        <EmptyDescription>Create a section to start the outline.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : null}
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
          <SidebarFooter className='shrink-0 border-t p-4'>
            <section
              className='flex flex-col gap-1 text-xs text-muted-foreground'
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
      </div>
    </Sidebar>
  )
}

function ReferenceList(props: {
  references: ManuscriptReferenceIndex
  loading: boolean
  error: boolean
  onOpenReference(entry: ManuscriptReferenceEntry): void
}): React.JSX.Element {
  if (props.loading) {
    return (
      <p className='px-2 py-4 text-sm text-muted-foreground' role='status'>
        Loading references…
      </p>
    )
  }
  if (props.error) {
    return (
      <p className='px-2 py-4 text-sm text-destructive' role='alert'>
        References could not be loaded. Retry by reopening this panel.
      </p>
    )
  }
  if (props.references.entries.length === 0) {
    return (
      <Empty className='gap-2 border-0 p-4'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <BookOpenText />
          </EmptyMedia>
          <EmptyTitle className='text-sm'>No references yet</EmptyTitle>
          <EmptyDescription>
            Canonical citations in the manuscript will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <SidebarMenu aria-label='Manuscript references'>
      {props.references.entries.map((entry) => (
        <SidebarMenuItem key={entry.title}>
          <SidebarMenuButton
            className='h-auto min-w-0 items-start gap-2 py-2'
            tooltip={{ children: `Open source preview for ${entry.title}`, hidden: false }}
            onClick={() => props.onOpenReference(entry)}
          >
            <span className='shrink-0 font-medium tabular-nums'>[{entry.number}]</span>
            <span className='min-w-0 flex-1'>
              <span className='line-clamp-2 block leading-5'>{entry.title}</span>
              <span className='block text-[11px] text-muted-foreground'>
                {entry.count} {entry.count === 1 ? 'citation' : 'citations'}
              </span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

function SidebarStatusIcon({ status }: { status: SectionStatus }): React.JSX.Element {
  const label =
    status === 'completed' ? 'Completed' : status === 'drafting' ? 'Drafting' : 'Planned'
  return (
    <>
      {status === 'completed' ? (
        <CheckCircle2 className='text-success' aria-hidden='true' />
      ) : status === 'drafting' ? (
        <CircleDot aria-hidden='true' />
      ) : (
        <Circle aria-hidden='true' />
      )}
      <span className='sr-only'>{label}</span>
    </>
  )
}

export function WorkspaceRail(props: {
  activeWorkspace: WorkspaceKind
  onOpenPreview(): void
  onOpenKnowledge(): void
  onOpenNotebook?(): void
  onOpenChecks(): void
  onOpenAssets(): void
  onOpenManuscript(): void
  onOpenReferences(): void
  onOpenIssues(): void
  onOpenWritingRules(): void
  onOpenFind(): void
  onOpenSettings(): void
  reviewCount?: number
}): React.JSX.Element {
  return (
    <Sidebar
      collapsible='none'
      className='w-[calc(var(--sidebar-width-icon)+1px)]! min-w-[calc(var(--sidebar-width-icon)+1px)]! max-w-[calc(var(--sidebar-width-icon)+1px)]! overflow-hidden border-r [&_[data-slot=sidebar-menu-button]>span]:hidden'
    >
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
                  aria-label='Manuscript'
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
                  aria-label='Preview'
                  tooltip={{ children: 'Preview', hidden: false }}
                  isActive={props.activeWorkspace === 'preview'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenPreview}
                >
                  <FileText />
                  <span>Preview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label='Find'
                  tooltip={{ children: 'Find', hidden: false }}
                  isActive={props.activeWorkspace === 'find'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenFind}
                >
                  <Search />
                  <span>Find</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label='References'
                  tooltip={{ children: 'References', hidden: false }}
                  isActive={props.activeWorkspace === 'references'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenReferences}
                >
                  <BookOpenText />
                  <span>References</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label='Knowledge'
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
                  aria-label='Notebook'
                  tooltip={{ children: 'Notebook', hidden: false }}
                  isActive={props.activeWorkspace === 'notebook'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenNotebook}
                >
                  <NotebookPen />
                  <span>Notebook</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label='Checks'
                  tooltip={{ children: 'Checks', hidden: false }}
                  isActive={props.activeWorkspace === 'checks'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenChecks}
                >
                  <ListChecks />
                  <span>Checks</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label='Writing rules'
                  tooltip={{ children: 'Writing rules', hidden: false }}
                  isActive={props.activeWorkspace === 'writing_rules'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenWritingRules}
                >
                  <BookMarked />
                  <span>Writing rules</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label={`Review Center, ${props.reviewCount ?? 0} open annotations`}
                  tooltip={{ children: 'Review Center', hidden: false }}
                  isActive={props.activeWorkspace === 'issues'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenIssues}
                >
                  <ClipboardList />
                  {(props.reviewCount ?? 0) > 0 ? (
                    <sup className='absolute top-0.5 right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] leading-4 text-primary-foreground'>
                      {(props.reviewCount ?? 0) > 99 ? '99+' : props.reviewCount}
                    </sup>
                  ) : null}
                  <span>Review Center</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label='Images'
                  tooltip={{ children: 'Images', hidden: false }}
                  isActive={props.activeWorkspace === 'assets'}
                  className='px-2.5 md:px-2'
                  onClick={props.onOpenAssets}
                >
                  <Images />
                  <span>Images</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label='Settings'
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
