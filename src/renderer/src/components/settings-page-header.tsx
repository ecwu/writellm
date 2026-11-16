import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'

/** Shared title row for Settings pages: icon, title, optional description, actions, close. */
export function SettingsPageHeader(props: {
  icon: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  closeAction?: React.ReactNode
}): React.JSX.Element {
  const Icon = props.icon
  return (
    <header className='flex items-start gap-3'>
      <div className='flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground'>
        <Icon className='size-4' aria-hidden='true' />
      </div>
      <div className='flex min-h-9 min-w-0 flex-1 flex-col justify-center gap-0.5'>
        <h2 className='truncate text-xl leading-7 font-semibold'>{props.title}</h2>
        {props.description ? (
          <p className='max-w-[72ch] text-sm text-muted-foreground'>{props.description}</p>
        ) : null}
      </div>
      {props.actions || props.closeAction ? (
        <div className='flex min-h-9 shrink-0 items-center gap-2'>
          {props.actions}
          {props.closeAction}
        </div>
      ) : null}
    </header>
  )
}
