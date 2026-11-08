import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Shared geometry for the first row of every panel, sidebar, and content toolbar.
 * One fixed height keeps the header dividers aligned across adjacent docked columns.
 */
export const panelHeaderClassName =
  'flex h-14 shrink-0 flex-row items-center gap-2 border-b px-4 py-0'

/** Sticky variant for scrolling content toolbars. */
export const panelToolbarClassName = cn(panelHeaderClassName, 'sticky top-0 z-20 bg-background')

export function PanelTitle(props: {
  icon?: LucideIcon
  title: React.ReactNode
  titleAttribute?: string
  className?: string
  as?: 'h1' | 'h2' | 'div' | 'span'
}): React.JSX.Element {
  const Icon = props.icon
  const Heading = props.as ?? 'h2'
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2', props.className)}>
      {Icon ? <Icon className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' /> : null}
      <Heading className='truncate text-sm font-semibold' title={props.titleAttribute}>
        {props.title}
      </Heading>
    </div>
  )
}

/** Icon-only header action with a visible tooltip and an accessible name. */
export function PanelIconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='ghost' size='icon-sm' aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
