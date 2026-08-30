import type {
  AgentModelSelection,
  AgentProviderCatalog
} from '../../../../shared/contracts/providers'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentModelPicker } from './agent-model-picker'

export function AgentModelRecovery(props: {
  presets: AgentProviderCatalog['presets']
  selection: AgentModelSelection | null
  activeConversation: boolean
  disabled: boolean
  onSelect(selection: AgentModelSelection): void | Promise<void>
  onOpenSettings(): void
}): React.JSX.Element {
  if (props.presets.length === 0) {
    return (
      <Button variant='outline' className='w-full' onClick={props.onOpenSettings}>
        <Settings2 data-icon='inline-start' /> Set up an Agent model
      </Button>
    )
  }

  return (
    <div className='grid gap-2' data-testid='agent-model-recovery'>
      <p className='text-sm text-muted-foreground'>
        {props.activeConversation
          ? "This conversation's model is unavailable. Choose another model to continue."
          : 'Choose an Agent model to start this conversation.'}
      </p>
      <div className='flex min-w-0 items-center gap-2'>
        <AgentModelPicker
          presets={props.presets}
          selection={props.selection}
          disabled={props.disabled}
          onSelect={props.onSelect}
        />
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Open Agent model settings'
          onClick={props.onOpenSettings}
        >
          <Settings2 />
        </Button>
      </div>
    </div>
  )
}
