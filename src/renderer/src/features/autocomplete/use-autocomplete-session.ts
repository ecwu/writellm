import { useEffect, useState } from 'react'
import type {
  AutocompleteSession,
  AutocompleteChange,
  AutocompleteStyle
} from '../../../../shared/contracts/autocomplete'
import { openAutocompleteSettings, reportAutocompleteError } from './autocomplete-errors'

export function useAutocompleteSession(projectSessionId: string) {
  const [session, setSession] = useState<AutocompleteSession>({
    style: 'word',
    enabled: false,
    available: false,
    selection: null
  })
  const [change, setChange] = useState<{
    version: number
    reason: AutocompleteChange['reason'] | 'toggle'
  }>({ version: 0, reason: 'toggle' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    let sequence = 0
    const load = () => {
      const request = ++sequence
      void window.desktop.autocomplete
        .session({ projectSessionId })
        .then((next) => {
          if (current && request === sequence) setSession(next)
        })
        .catch(reportAutocompleteError)
    }
    load()
    const unsubscribe = window.desktop.autocomplete.subscribeChanges((event) => {
      setChange((previous) => ({ version: previous.version + 1, reason: event.reason }))
      setSession((previous) => ({ ...previous, available: false }))
      load()
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [projectSessionId])
  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.desktop.autocomplete.toggle({ projectSessionId, enabled })
      setSession(next)
      setChange((previous) => ({ version: previous.version + 1, reason: 'toggle' }))
      if (enabled && !next.available) openAutocompleteSettings()
    } catch (err) {
      reportAutocompleteError(err)
    } finally {
      setBusy(false)
    }
  }
  const setStyle = async (style: AutocompleteStyle): Promise<void> => {
    setBusy(true)
    setChange((previous) => ({ version: previous.version + 1, reason: 'style' }))
    try {
      const settings = await window.desktop.autocomplete.setStyle(style)
      setSession((previous) => ({ ...previous, ...settings }))
    } catch (err) {
      reportAutocompleteError(err)
    } finally {
      setBusy(false)
    }
  }
  return { session, change, busy, toggle, setStyle }
}
