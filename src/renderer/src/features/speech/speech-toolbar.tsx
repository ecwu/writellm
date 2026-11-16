import { Check, CircleStop, X } from 'lucide-react'
import { InputGroupButton } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { ComposerAction } from '../agent/agent-panel-controls'
import type { useSpeechDraft } from './use-speech-draft'

const meterPositions = Array.from({ length: 24 }, (_, index) => ({
  id: `meter-${index}`,
  x: index * 4 + 2
}))

export function SpeechToolbar({
  speech,
  running,
  stopAgent
}: {
  speech: ReturnType<typeof useSpeechDraft>
  running: boolean
  stopAgent: () => Promise<void>
}): React.JSX.Element {
  const seconds = Math.floor(speech.elapsed / 1000)
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <>
      <ComposerAction size='icon-sm' label='Cancel dictation' onClick={speech.cancel}>
        <X />
      </ComposerAction>
      <div className='flex min-w-0 flex-1 items-center gap-2' aria-hidden='true'>
        {speech.phase === 'recording' ? (
          <>
            <svg
              viewBox='0 0 96 24'
              className='h-6 min-w-0 max-w-24 flex-1 text-muted-foreground'
              aria-hidden='true'
            >
              {meterPositions.map(({ id, x }, index) => (
                <line
                  key={id}
                  x1={x}
                  x2={x}
                  y1={12 - Math.max(0.5, (speech.levels[index] ?? 0) * 11)}
                  y2={12 + Math.max(0.5, (speech.levels[index] ?? 0) * 11)}
                  stroke='currentColor'
                  strokeWidth='2'
                />
              ))}
            </svg>
            <span className='text-xs tabular-nums text-muted-foreground'>{timer}</span>
          </>
        ) : speech.phase === 'error' ? null : (
          <>
            <Spinner />
            <span className='truncate text-xs text-muted-foreground'>
              {speech.phase === 'preparing' ? 'Preparing…' : 'Transcribing…'}
            </span>
          </>
        )}
      </div>
      {running ? (
        <ComposerAction size='sm' label='Stop Agent' onClick={() => void stopAgent()}>
          <CircleStop />
          Stop Agent
        </ComposerAction>
      ) : null}
      {speech.phase === 'error' && speech.hasPartial ? (
        <InputGroupButton size='sm' onClick={speech.keep}>
          Keep text
        </InputGroupButton>
      ) : (
        <ComposerAction
          size='icon-sm'
          variant='default'
          label='Finish recording'
          disabled={speech.phase !== 'recording'}
          onClick={() => void speech.finish()}
        >
          {speech.phase === 'finalizing' ? <Spinner /> : <Check />}
        </ComposerAction>
      )}
    </>
  )
}
