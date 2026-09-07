import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil, GitBranch } from 'lucide-react'
import { AGENT_RUN_PROMPT_MAX_CHARACTERS } from '../../../../shared/contracts/agent'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function MessageCopyButton({ content }: { content: string }): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )
  const copy = async (): Promise<void> => {
    if (timer.current !== null) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(content)
      setStatus('copied')
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => setStatus('idle'), 2_000)
    } catch (err) {
      const original = err instanceof Error ? err : new Error(String(err))
      window.desktop.diagnostics.reportRendererError({
        event: 'renderer.error',
        source: 'agent.message.copy',
        message: original.message,
        stack: original.stack
      })
      setStatus('failed')
    }
  }
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-1'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='icon-xs'
            aria-label={status === 'copied' ? 'Copied' : 'Copy message'}
            onClick={() => void copy()}
          >
            {status === 'copied' ? <Check /> : <Copy />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{status === 'copied' ? 'Copied' : 'Copy message'}</TooltipContent>
      </Tooltip>
      <span role='status' className='text-xs text-muted-foreground'>
        {status === 'failed' ? 'Copy failed. Try again.' : status === 'copied' ? 'Copied' : ''}
      </span>
    </div>
  )
}

export function MessageEditButton(props: {
  reason: string | null
  onEdit(): void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon-xs'
          aria-label='Edit message'
          aria-disabled={props.reason !== null}
          onClick={() => {
            if (props.reason === null) props.onEdit()
          }}
        >
          <Pencil />
        </Button>
      </TooltipTrigger>
      <TooltipContent className='max-w-64'>{props.reason ?? 'Edit message'}</TooltipContent>
    </Tooltip>
  )
}

export function MessageEditor(props: {
  content: string
  busy: boolean
  reason: string | null
  onCancel(): void
  onSave(content: string): Promise<boolean>
}): React.JSX.Element {
  const [draft, setDraft] = useState(props.content)
  const [submitting, setSubmitting] = useState(false)
  const locked = props.busy || submitting
  const canSave =
    !locked &&
    props.reason === null &&
    draft.trim().length > 0 &&
    draft.length <= AGENT_RUN_PROMPT_MAX_CHARACTERS
  const save = async (): Promise<void> => {
    if (!canSave) return
    setSubmitting(true)
    try {
      await props.onSave(draft)
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <Textarea
        aria-label='Edit sent message'
        autoFocus
        value={draft}
        className='max-h-72 min-h-24 resize-none'
        disabled={locked}
        maxLength={AGENT_RUN_PROMPT_MAX_CHARACTERS}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape' && !locked) {
            event.preventDefault()
            props.onCancel()
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void save()
          }
        }}
      />
      <p className='text-xs text-muted-foreground'>
        {props.reason ?? 'This replaces the replies after this message and restarts the Agent.'}
      </p>
      <div className='flex flex-wrap justify-end gap-2'>
        <Button type='button' variant='ghost' size='sm' disabled={locked} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type='button' size='sm' disabled={!canSave} onClick={() => void save()}>
          {locked ? 'Restarting…' : 'Save and restart'}
        </Button>
      </div>
    </div>
  )
}

export function MessageForkButton(props: { busy: boolean; onFork(): void }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon-xs'
          aria-label='从这里分叉'
          disabled={props.busy}
          onClick={props.onFork}
        >
          <GitBranch />
        </Button>
      </TooltipTrigger>
      <TooltipContent>从这里分叉</TooltipContent>
    </Tooltip>
  )
}
