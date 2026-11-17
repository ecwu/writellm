import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

type Leave = (action: () => void) => void
type Draft = { save: () => Promise<boolean>; discard?: () => void }
const SettingsDraftContext = createContext<{
  register: (draft: Draft) => () => void
  requestLeave: Leave
} | null>(null)
const leaveImmediately: Leave = (action) => action()

export function useSettingsLeave(): Leave {
  return useContext(SettingsDraftContext)?.requestLeave ?? leaveImmediately
}

export function useSettingsDraft(
  dirty: boolean,
  save: Draft['save'],
  discard?: Draft['discard']
): Leave {
  const context = useContext(SettingsDraftContext)
  useLayoutEffect(() => {
    if (dirty) return context?.register({ save, discard })
    return undefined
  }, [context, dirty, save, discard])
  return context?.requestLeave ?? leaveImmediately
}

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const draft = useRef<Draft | null>(null)
  const nextAction = useRef<(() => void) | null>(null)
  const saving = useRef(false)
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const register = useCallback((value: Draft) => {
    draft.current = value
    return () => {
      if (draft.current === value) draft.current = null
    }
  }, [])
  const requestLeave = useCallback<Leave>((action) => {
    if (nextAction.current) return
    if (!draft.current) return action()
    nextAction.current = action
    setPending(true)
  }, [])
  const context = useMemo(() => ({ register, requestLeave }), [register, requestLeave])
  function dismiss() {
    nextAction.current = null
    setPending(false)
  }
  function leave() {
    const action = nextAction.current
    dismiss()
    action?.()
  }
  async function saveAndLeave() {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    try {
      if (!draft.current || (await draft.current.save())) leave()
      else dismiss()
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <SettingsDraftContext.Provider value={context}>
      {children}
      <AlertDialog
        open={pending}
        onOpenChange={(open) => {
          if (!open && !saving.current) dismiss()
        }}
      >
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes before leaving?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep editing</AlertDialogCancel>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => {
                draft.current?.discard?.()
                leave()
              }}
            >
              Discard
            </Button>
            <Button disabled={busy} onClick={saveAndLeave}>
              Save
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsDraftContext.Provider>
  )
}
