import { useEffect, useRef, useState } from 'react'
import type {
  AutocompleteSession,
  AutocompleteChange,
  AutocompleteStyle
} from '../../../../shared/contracts/autocomplete'
import { openAutocompleteSettings, reportAutocompleteError } from './autocomplete-errors'

export function useAutocompleteSession(projectSessionId: string) {
  const [session, setSession] = useState<AutocompleteSession>({
    style: 'word',
    defaultEnabled: false,
    overrides: { enabled: false, style: false },
    enabled: false,
    available: false,
    selection: null
  })
  const [change, setChange] = useState<{
    version: number
    reason: AutocompleteChange['reason'] | 'toggle'
  }>({ version: 0, reason: 'toggle' })
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  const mutation = useRef(0)
  const reload = useRef<(() => void) | null>(null)
  const activeId = useRef(projectSessionId)
  activeId.current = projectSessionId
  useEffect(() => {
    let current = true
    const load = () => {
      const request = ++sequence.current
      void window.desktop.autocomplete
        .session({ projectSessionId })
        .then((next) => {
          if (current && request === sequence.current) setSession(next)
        })
        .catch(reportAutocompleteError)
    }
    reload.current = load
    setBusy(false)
    load()
    const unsubscribe = window.desktop.autocomplete.subscribeChanges((event) => {
      setChange((previous) => ({ version: previous.version + 1, reason: event.reason }))
      setSession((previous) => ({ ...previous, available: false }))
      load()
    })
    return () => {
      current = false
      sequence.current++
      mutation.current++
      reload.current = null
      unsubscribe()
    }
  }, [projectSessionId])
  const update = async (
    action: () => Promise<AutocompleteSession>,
    reason: 'toggle' | 'style',
    enabling = false
  ): Promise<void> => {
    const request = ++mutation.current
    const isCurrent = () => request === mutation.current && activeId.current === projectSessionId
    setBusy(true)
    try {
      await action()
      // Change notifications can race the mutation reply; read current Main authority again.
      const next = await window.desktop.autocomplete.session({ projectSessionId })
      if (!isCurrent()) return
      reload.current?.()
      setChange((previous) => ({ version: previous.version + 1, reason }))
      if (enabling && !next.available) openAutocompleteSettings()
    } catch (err) {
      reportAutocompleteError(err)
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }
  const toggle = (enabled: boolean) =>
    update(
      () => window.desktop.autocomplete.toggle({ projectSessionId, enabled }),
      'toggle',
      enabled
    )
  const setStyle = (style: AutocompleteStyle) =>
    update(() => window.desktop.autocomplete.setSessionStyle({ projectSessionId, style }), 'style')
  const resetOverrides = () =>
    update(() => window.desktop.autocomplete.resetOverrides({ projectSessionId }), 'toggle')
  return { session, change, busy, toggle, setStyle, resetOverrides }
}
