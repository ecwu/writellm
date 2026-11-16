import { speechErrorMessage } from '../../../../shared/speech-errors'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { reportRendererOperationError } from '../../diagnostics'
import { SpeechCapture, SpeechCapturePreparationError } from './speech-capture'

export function replaceSpeechSelection(
  draft: string,
  start: number,
  end: number,
  text: string
): string {
  return draft.slice(0, start) + text + draft.slice(end)
}

type Phase = 'idle' | 'preparing' | 'recording' | 'finalizing' | 'error'
interface DraftCapture {
  key: string
  draft: string
  start: number
  end: number
  generation: number
  recognitionId: string | null
  sequence: number
  eventSequence: number
  capture: SpeechCapture | null
  text: string
  failed: boolean
}

export function useSpeechDraft(input: {
  projectSessionId: string
  draftKey: string
  prompt: string
  setPrompt: (value: string) => void
  textarea: RefObject<HTMLTextAreaElement | null>
  enabled: boolean
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [levels, setLevels] = useState<number[]>(Array.from({ length: 24 }, () => 0))
  const [elapsed, setElapsed] = useState(0)
  const current = useRef(input)
  current.current = input
  const active = useRef<DraftCapture | null>(null)
  const generation = useRef(0)
  const submitAfter = useRef(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const reducedMotion = useRef<MediaQueryList | null>(null)
  const lastPreview = useRef(0)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentKey = `${input.projectSessionId}:${input.draftKey}`

  const matches = (session: DraftCapture): boolean =>
    active.current === session &&
    session.generation === generation.current &&
    session.key === `${current.current.projectSessionId}:${current.current.draftKey}` &&
    session.draft === current.current.prompt &&
    current.current.enabled
  const clearTimers = (): void => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = null
  }
  const release = (session: DraftCapture): void => {
    session.capture?.dispose()
    if (session.recognitionId)
      void window.desktop.speech
        .cancel({
          projectSessionId: session.key.slice(0, session.key.indexOf(':')),
          recognitionId: session.recognitionId
        })
        .catch((err: unknown) => reportRendererOperationError(err, 'speech.cancel'))
  }
  const focus = (start: number, end = start): void => {
    const key = `${current.current.projectSessionId}:${current.current.draftKey}`
    requestAnimationFrame(() => {
      if (key !== `${current.current.projectSessionId}:${current.current.draftKey}`) return
      const textarea = current.current.textarea.current
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start, end)
    })
  }
  const cancel = (restoreFocus = true): void => {
    const session = active.current
    if (!session) return
    const same = matches(session)
    active.current = null
    generation.current++
    clearTimers()
    release(session)
    setPreview(null)
    setPhase('idle')
    phaseRef.current = 'idle'
    setError(null)
    setNotice('Dictation cancelled.')
    submitAfter.current = Date.now() + 400
    if (same && restoreFocus) focus(session.start, session.end)
  }
  const fail = (session: DraftCapture, err: unknown, message?: string): void => {
    reportRendererOperationError(
      err,
      err instanceof SpeechCapturePreparationError
        ? `speech.capture.${err.stage}`
        : 'speech.capture'
    )
    if (!matches(session)) return
    session.failed = true
    clearTimers()
    release(session)
    setPhase('error')
    phaseRef.current = 'error'
    const captureCause = err instanceof SpeechCapturePreparationError ? err.cause : err
    const name = captureCause instanceof Error ? captureCause.name : ''
    setError(
      message ??
        (name === 'NotAllowedError'
          ? 'Microphone access denied. Allow it in system settings.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : speechErrorMessage(err))
    )
  }
  const apply = (session: DraftCapture, text: string): void => {
    if (!matches(session)) return
    const merged =
      text.length === 0
        ? session.draft
        : replaceSpeechSelection(session.draft, session.start, session.end, text)
    if (new TextEncoder().encode(merged).byteLength > 64 * 1024) {
      fail(
        session,
        new Error('speech_draft_too_large'),
        'The combined draft is too long. Shorten the draft before dictating.'
      )
      return
    }
    active.current = null
    generation.current++
    session.capture?.dispose()
    clearTimers()
    current.current.setPrompt(merged)
    setPreview(null)
    setPhase('idle')
    phaseRef.current = 'idle'
    setError(null)
    setNotice('Dictation complete.')
    submitAfter.current = Date.now() + 400
    focus(session.start + text.length)
  }
  const finish = async (): Promise<void> => {
    const session = active.current
    if (!session || phaseRef.current !== 'recording') return
    phaseRef.current = 'finalizing'
    setPhase('finalizing')
    try {
      await session.capture?.finish()
      if (!matches(session) || !session.recognitionId || phaseRef.current !== 'finalizing') return
      await window.desktop.speech.finish({
        projectSessionId: current.current.projectSessionId,
        recognitionId: session.recognitionId
      })
    } catch (err) {
      fail(session, err)
    }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  const start = async (): Promise<void> => {
    if (active.current || !current.current.enabled || Date.now() < submitAfter.current) return
    const value = current.current
    reducedMotion.current ??= window.matchMedia('(prefers-reduced-motion: reduce)')
    const textarea = value.textarea.current
    const session: DraftCapture = {
      key: `${value.projectSessionId}:${value.draftKey}`,
      draft: value.prompt,
      start: textarea?.selectionStart ?? value.prompt.length,
      end: textarea?.selectionEnd ?? value.prompt.length,
      generation: ++generation.current,
      recognitionId: null,
      sequence: 0,
      eventSequence: -1,
      capture: null,
      text: '',
      failed: false
    }
    active.current = session
    setPhase('preparing')
    phaseRef.current = 'preparing'
    setError(null)
    setNotice('')
    setElapsed(0)
    setLevels(Array.from({ length: 24 }, () => 0))
    try {
      const result = await window.desktop.speech.start({ projectSessionId: value.projectSessionId })
      session.recognitionId = result.recognitionId
      if (!matches(session) || session.failed) {
        release(session)
        return
      }
      const capture = new SpeechCapture(
        async (pcm) => {
          if (!matches(session) || !session.recognitionId) return
          await window.desktop.speech.pushAudio({
            projectSessionId: value.projectSessionId,
            recognitionId: session.recognitionId,
            sequence: session.sequence++,
            pcm
          })
        },
        (level) => {
          if (matches(session))
            setLevels((previous) =>
              reducedMotion.current?.matches
                ? Array.from({ length: 24 }, () => level)
                : [...previous.slice(1), level]
            )
        },
        (err) => fail(session, err)
      )
      session.capture = capture
      await capture.start()
      if (!matches(session) || session.failed) {
        capture.dispose()
        return
      }
      setPhase('recording')
      phaseRef.current = 'recording'
      const started = Date.now()
      const tick = (): void => {
        if (!matches(session) || phaseRef.current !== 'recording') return
        setElapsed(Date.now() - started)
        timers.current.push(setTimeout(tick, 1000))
      }
      tick()
      timers.current.push(setTimeout(() => void finishRef.current(), result.maxDurationMs))
    } catch (err) {
      fail(session, err)
    }
  }

  const callbacks = useRef({ cancel, apply, fail, matches })
  callbacks.current = { cancel, apply, fail, matches }
  useEffect(() => {
    const unsubscribe = window.desktop.speech.subscribe((event) => {
      const session = active.current
      if (
        !session ||
        !callbacks.current.matches(session) ||
        event.recognitionId !== session.recognitionId ||
        event.projectSessionId !== current.current.projectSessionId ||
        event.sequence <= session.eventSequence
      )
        return
      session.eventSequence = event.sequence
      if (session.failed) return
      if (event.state === 'error') {
        callbacks.current.fail(session, new Error('speech_recognition_failed'), event.error)
      } else if (event.state === 'final') callbacks.current.apply(session, event.text ?? '')
      else if (event.state === 'partial') {
        session.text = event.text ?? ''
        const publish = (): void => {
          if (!callbacks.current.matches(session)) return
          lastPreview.current = Date.now()
          setPreview(
            replaceSpeechSelection(session.draft, session.start, session.end, session.text)
          )
        }
        const delay = Math.max(0, 100 - (Date.now() - lastPreview.current))
        if (delay === 0) publish()
        else if (previewTimer.current === null)
          previewTimer.current = setTimeout(() => {
            previewTimer.current = null
            publish()
          }, delay)
      }
    })
    return () => {
      unsubscribe()
      callbacks.current.cancel(false)
    }
  }, [])
  useEffect(() => {
    if (
      active.current &&
      (!input.enabled || active.current.key !== currentKey || active.current.draft !== input.prompt)
    )
      callbacks.current.cancel(false)
  }, [currentKey, input.enabled, input.prompt])
  useEffect(() => {
    const onEscape = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.key !== 'Escape' ||
        !active.current
      )
        return
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return
      event.preventDefault()
      callbacks.current.cancel()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])
  return {
    phase,
    active: phase !== 'idle',
    preview,
    error,
    notice,
    levels,
    elapsed,
    start,
    finish,
    cancel: () => cancel(),
    keep: () => {
      const session = active.current
      if (session) apply(session, session.text)
    },
    hasPartial: (active.current?.text.length ?? 0) > 0,
    blocksSubmit: () => active.current !== null || Date.now() < submitAfter.current
  }
}
