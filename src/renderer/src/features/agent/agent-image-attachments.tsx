import { useEffect, useState } from 'react'
import { ImageIcon, X } from 'lucide-react'
import type { AgentAttachment } from '../../../../shared/contracts/agent-attachments'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTrigger
} from '@/components/ui/attachment'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { errorMessage } from './agent-panel-logic'

export interface AgentImageDraft {
  id: string
  name: string
  state: 'processing' | 'error' | 'done'
  image?: AgentAttachment
  error?: string
}

export function reportAgentImageError(err: unknown, source: string): void {
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.error',
    source,
    message: errorMessage(err).slice(0, 4096),
    ...(err instanceof Error && err.stack ? { stack: err.stack.slice(0, 32768) } : {})
  })
}

export function AgentImageAttachments(props: {
  items: AgentImageDraft[]
  onRemove?(id: string): void
  variant?: 'composer' | 'message' | 'queue'
}): React.JSX.Element | null {
  if (props.items.length === 0) return null
  const variant = props.variant ?? 'composer'
  const size = variant === 'message' ? 160 : variant === 'queue' ? 64 : 80
  return (
    <AttachmentGroup
      aria-label='Image attachments'
      tabIndex={0}
      className={cn(
        'mask-none! gap-2 px-1',
        variant === 'message' && 'flex-wrap justify-end overflow-x-visible'
      )}
    >
      {props.items.map((item) => {
        const image = item.image
        const dimensions = image ? `${image.width} × ${image.height}` : 'Processing…'
        const ratio = variant === 'message' && image ? image.width / image.height : 1
        return (
          <Dialog key={item.id}>
            <Attachment
              state={item.state}
              orientation='vertical'
              className='border-border gap-0 p-0!'
              style={{ width: size * Math.min(ratio, 1), height: size / Math.max(ratio, 1) }}
            >
              <AttachmentMedia
                variant={image ? 'image' : 'icon'}
                className='size-full aspect-auto rounded-[inherit]'
              >
                {image ? (
                  <img
                    src={image.previewUrl}
                    alt={item.name}
                    width={image.width}
                    height={image.height}
                    className={cn(
                      'size-full aspect-auto!',
                      variant === 'message' && 'object-contain!'
                    )}
                  />
                ) : item.state === 'processing' ? (
                  <Spinner aria-label={`Processing ${item.name}`} />
                ) : (
                  <ImageIcon aria-label={item.error ?? `Could not load ${item.name}`} />
                )}
              </AttachmentMedia>
              {props.onRemove ? (
                <AttachmentActions className='top-1! right-1! opacity-0 transition-opacity group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100'>
                  <AttachmentAction
                    variant='outline'
                    aria-label={`Remove ${item.name}`}
                    onClick={() => props.onRemove?.(item.id)}
                  >
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  {image ? (
                    <DialogTrigger asChild>
                      <AttachmentTrigger aria-label={`Preview ${item.name}`} />
                    </DialogTrigger>
                  ) : (
                    <AttachmentTrigger aria-label={`${item.name}: ${item.error ?? dimensions}`} />
                  )}
                </TooltipTrigger>
                <TooltipContent className='max-w-64'>
                  <p className='break-words'>{item.name}</p>
                  <p>{item.error ?? dimensions}</p>
                </TooltipContent>
              </Tooltip>
            </Attachment>
            {image ? (
              <DialogContent className='max-w-4xl!'>
                <DialogHeader>
                  <DialogTitle className='break-words'>{item.name}</DialogTitle>
                  <DialogDescription>{dimensions}</DialogDescription>
                </DialogHeader>
                <img
                  src={image.previewUrl}
                  alt={item.name}
                  className='max-h-[70vh] w-full object-contain'
                />
              </DialogContent>
            ) : null}
          </Dialog>
        )
      })}
    </AttachmentGroup>
  )
}

export function AgentHistoryImages(props: {
  projectSessionId: string
  agentSessionId: string
  ids: string[]
  variant?: 'message' | 'queue'
}): React.JSX.Element | null {
  const [items, setItems] = useState<AgentImageDraft[]>([])
  const key = props.ids.join(',')
  useEffect(() => {
    let disposed = false
    const ids = key ? key.split(',') : []
    setItems(ids.map((id) => ({ id, name: 'Image', state: 'processing' })))
    for (const id of ids) {
      window.desktop.agent
        .getImage({
          projectSessionId: props.projectSessionId,
          agentSessionId: props.agentSessionId,
          attachmentId: id
        })
        .then((image) => {
          if (!disposed)
            setItems((current) =>
              current.map((item) =>
                item.id === id ? { id, name: image.name, state: 'done', image } : item
              )
            )
        })
        .catch((err) => {
          reportAgentImageError(err, 'agent.image.preview')
          if (!disposed)
            setItems((current) =>
              current.map((item) =>
                item.id === id ? { ...item, state: 'error', error: errorMessage(err) } : item
              )
            )
        })
    }
    return () => {
      disposed = true
    }
  }, [key, props.projectSessionId, props.agentSessionId])
  return <AgentImageAttachments items={items} variant={props.variant ?? 'message'} />
}
