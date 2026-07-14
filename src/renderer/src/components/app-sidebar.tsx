import { Bot, BookOpen, FileText, LibraryBig, PenLine, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar'

const workspaceAreas = [
  { title: 'Manuscript', icon: PenLine },
  { title: 'Knowledge', icon: LibraryBig },
  { title: 'Agent', icon: Bot }
]

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  projectName: string
}

export function AppSidebar({ projectName, ...props }: AppSidebarProps): React.JSX.Element {
  const { setOpen } = useSidebar()

  return (
    <Sidebar
      collapsible='icon'
      className='top-10 bottom-0 h-auto overflow-hidden *:data-[sidebar=sidebar]:flex-row'
      {...props}
    >
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
                {workspaceAreas.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={{ children: item.title, hidden: false }}
                      isActive={item.title === 'Manuscript'}
                      disabled={item.title !== 'Manuscript'}
                      className='px-2.5 md:px-2'
                      onClick={() => setOpen(true)}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <Sidebar collapsible='none' className='hidden flex-1 md:flex'>
        <SidebarHeader className='gap-3.5 border-b p-4'>
          <div className='flex w-full items-center justify-between gap-2'>
            <div className='truncate text-base font-medium text-foreground'>{projectName}</div>
            <Badge variant='secondary'>Active</Badge>
          </div>
          <SidebarInput placeholder='Search manuscript…' disabled />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Manuscript</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <FileText /> Untitled section
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <Search /> Search manuscript
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}
