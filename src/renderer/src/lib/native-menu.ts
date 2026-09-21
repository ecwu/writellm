import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  menuCommandEnabled,
  type MenuCommand,
  type MenuState
} from '../../../shared/contracts/application-menu'

export const hasOpenModal = (): boolean =>
  !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"]'
  )

export function useNativeMenu(state: MenuState, execute: (command: MenuCommand) => void): void {
  const native = window.desktop.menu.native
  const current = useRef({ state, execute })
  useLayoutEffect(() => {
    current.current = { state, execute }
  })
  const [modal, setModal] = useState(false)
  useEffect(() => {
    if (!native) return
    const check = () => setModal(hasOpenModal())
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'aria-modal', 'role']
    })
    check()
    return () => observer.disconnect()
  }, [native])
  useEffect(() => {
    if (!native) return
    return window.desktop.menu.subscribe((event) => {
      const { state: latest, execute: run } = current.current
      if (
        event.projectSessionId !== latest.projectSessionId ||
        !menuCommandEnabled(event.command, { ...latest, modal: hasOpenModal() })
      )
        return
      run(event.command)
    })
  }, [native])
  const serialized = JSON.stringify({ ...state, modal })
  useEffect(() => {
    if (!native) return
    // Main logs the original IPC failure before returning its sanitized error.
    void window.desktop.menu.update(JSON.parse(serialized)).catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error))
      window.desktop.diagnostics.reportRendererError({
        event: 'renderer.error',
        message: err.message,
        stack: err.stack
      })
    })
  }, [native, serialized])
}
