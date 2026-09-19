import {
  cloneElement,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type ReactElement
} from 'react'
import type { SectionEditor, SectionEditorHandle } from '../manuscript/section-editor'

type EditorElement = ReactElement<React.ComponentProps<typeof SectionEditor>>
/** Retain only visited sections. Hidden editors cannot consume keyboard/input events. */
export const RetainedEditors = forwardRef<
  SectionEditorHandle,
  {
    activeSectionId: string | null
    openSectionIds: string[]
    visible: boolean
    scrollContainer: React.RefObject<HTMLElement | null>
    children: EditorElement | null
  }
>(function RetainedEditors(
  { activeSectionId, openSectionIds, visible, scrollContainer, children },
  ref
) {
  const [saved, setSaved] = useState(new Map<string, EditorElement>())
  const handles = useRef(new Map<string, SectionEditorHandle>())
  const refs = useRef(new Map<string, (handle: SectionEditorHandle | null) => void>())
  const scrollPositions = useRef(new Map<string, number>())
  const scrollOwner = useRef<string | null>(null)
  useEffect(() => {
    const element = scrollContainer.current
    if (!element) return
    const remember = (): void => {
      if (scrollOwner.current) scrollPositions.current.set(scrollOwner.current, element.scrollTop)
    }
    element.addEventListener('scroll', remember)
    return () => element.removeEventListener('scroll', remember)
  }, [scrollContainer])
  useLayoutEffect(() => {
    scrollOwner.current = null
    if (!visible || !activeSectionId) return
    scrollContainer.current?.scrollTo({ top: scrollPositions.current.get(activeSectionId) ?? 0 })
    const frame = requestAnimationFrame(() => {
      scrollOwner.current = activeSectionId
    })
    return () => cancelAnimationFrame(frame)
  }, [activeSectionId, visible, scrollContainer])
  const currentId = useRef(activeSectionId)
  currentId.current = activeSectionId
  useImperativeHandle(ref, () => {
    const current = (): SectionEditorHandle => {
      const handle = currentId.current ? handles.current.get(currentId.current) : undefined
      if (!handle) throw new Error('The section editor is still loading. Try again.')
      return handle
    }
    return {
      hasActiveEditor: (sectionId) => {
        const id = sectionId ?? currentId.current
        return id !== null && handles.current.has(id)
      },
      focus: () => current().focus(),
      insertText: (text) => current().insertText(text),
      flush: async () => {
        for (const handle of handles.current.values()) await handle.flush()
      },
      finalFlush: (request) => {
        if (request.sectionId === undefined) return current().finalFlush(request)
        const handle = handles.current.get(request.sectionId)
        if (!handle) throw new Error('The requested section editor is not open.')
        return handle.finalFlush(request)
      },
      releaseMutationBarrier: () => {
        for (const handle of handles.current.values()) handle.releaseMutationBarrier()
      },
      exportNativeJson: () => current().exportNativeJson(),
      exportMarkdown: () => current().exportMarkdown(),
      revealSearchTarget: (target) => current().revealSearchTarget(target),
      revealBlock: (id) => current().revealBlock(id),
      clearSearchTarget: () => {
        if (currentId.current) handles.current.get(currentId.current)?.clearSearchTarget()
      },
      revealComment: (id) => current().revealComment(id),
      captureSelection: () => current().captureSelection()
    }
  }, [])
  const openKey = openSectionIds.join('|')
  useLayoutEffect(() => {
    if (!children || !activeSectionId) return
    setSaved((previous) => {
      const next = new Map([...previous].filter(([id]) => openKey.split('|').includes(id)))
      if (openKey.split('|').includes(activeSectionId)) next.set(activeSectionId, children)
      return next
    })
  }, [children, activeSectionId, openKey])
  const entries = new Map(saved)
  if (children && activeSectionId) entries.set(activeSectionId, children)
  const open = new Set(openSectionIds)
  return (
    <>
      {[...entries]
        .filter(([id]) => open.has(id))
        .map(([id, element]) => {
          const active = visible && id === activeSectionId
          if (!refs.current.has(id))
            refs.current.set(id, (handle) => {
              if (handle) handles.current.set(id, handle)
              else handles.current.delete(id)
            })
          return (
            <div
              key={id}
              hidden={!active}
              inert={!active}
              className={active ? 'min-w-0' : 'hidden'}
            >
              {cloneElement(element, {
                ref: refs.current.get(id),
                active,
                autoFocus: active && element.props.autoFocus,
                autocompleteEnabled: active && element.props.autocompleteEnabled,
                onSaveStateChange: (state) => {
                  if (id === currentId.current) element.props.onSaveStateChange?.(state)
                },
                onSelectionContextChange: (selection) => {
                  if (active && id === currentId.current)
                    element.props.onSelectionContextChange?.(selection)
                }
              })}
            </div>
          )
        })}
    </>
  )
})
