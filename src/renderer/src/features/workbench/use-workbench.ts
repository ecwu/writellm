import { useCallback, useEffect, useRef, useState } from 'react'
import {
  contentTabId,
  type WorkbenchContent,
  type WorkbenchTool,
  type WorkbenchLayout
} from '../../../../shared/contracts/workbench'
import type { NotebookChatSnapshot } from '../../../../shared/contracts/notebook'

export type ContentTab = WorkbenchContent | { kind: 'notebook'; notebookId: string; number: number }
export function tabId(tab: ContentTab): string {
  return tab.kind === 'notebook' ? `notebook:${tab.notebookId}` : contentTabId(tab)
}
export function reportWorkbenchError(err: unknown, source: string): void {
  const error = err instanceof Error ? err : new Error(String(err))
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.unhandled_rejection',
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    source
  })
}
export interface WorkbenchActions {
  flush(): Promise<boolean>
  activateSection(id: string): Promise<void>
  setWorkspace(kind: ContentTab['kind'] | 'manuscript'): void
  clearSelection(): void
}
export function useWorkbench(
  projectSessionId: string,
  actions: React.RefObject<WorkbenchActions>,
  onError: (message: string) => void
) {
  const [tabs, setTabs] = useState<ContentTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [initialLayout, setInitialLayout] = useState<WorkbenchLayout | null>(null)
  const [toolRequest, setToolRequest] = useState<{ kind: WorkbenchTool; open: boolean } | null>(
    null
  )
  const requestTool = useCallback(
    (kind: WorkbenchTool, open = true) => setToolRequest({ kind, open }),
    []
  )
  const [closeRequest, setCloseRequest] = useState<ContentTab | null>(null)
  const live = useRef(true)
  const state = useRef({ tabs, activeId })
  state.current = { tabs, activeId }
  const tools = useRef<WorkbenchLayout['tools']>(null)
  const notebookStates = useRef(
    new Map<string, { snapshot: NotebookChatSnapshot | null; draft: string }>()
  )
  const [notebookStatus, setNotebookStatus] = useState<Record<string, string>>({})
  const recent = useRef<string[]>([])
  const confirmation = useRef<((confirmed: boolean) => void) | null>(null)
  const nextNotebook = useRef(1)
  const serial = useRef<Promise<unknown>>(Promise.resolve())
  const saveSerial = useRef<Promise<void>>(Promise.resolve())
  const initialized = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorRef = useRef(onError)
  errorRef.current = onError
  const save = useCallback(
    async (closingToken?: string) => {
      if (!initialized.current || !live.current) return
      if (timer.current) clearTimeout(timer.current)
      const current = state.current
      const retained = current.tabs.filter(
        (tab): tab is WorkbenchContent => tab.kind !== 'notebook'
      )
      const activeTabId = retained.some((tab) => tabId(tab) === current.activeId)
        ? current.activeId
        : (recent.current.find((id) => retained.some((tab) => tabId(tab) === id)) ??
          (retained[0] ? tabId(retained[0]) : null))
      const layout: WorkbenchLayout = {
        version: 1,
        tabs: retained,
        activeTabId,
        tools: tools.current
      }
      const operation = saveSerial.current.then(() =>
        window.desktop.workbench.save({
          projectSessionId,
          layout,
          ...(closingToken ? { closingToken } : {})
        })
      )
      saveSerial.current = operation.catch((err) => {
        reportWorkbenchError(err, 'workbench.layout.save')
        errorRef.current('Workspace layout could not be saved. Your documents are unaffected.')
      })
      await saveSerial.current
    },
    [projectSessionId]
  )
  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void save()
    }, 400)
  }, [save])
  const commit = useCallback(
    (nextTabs: ContentTab[], id: string | null) => {
      if (id) recent.current = [id, ...recent.current.filter((item) => item !== id)]
      state.current = { tabs: nextTabs, activeId: id }
      setTabs(nextTabs)
      setActiveId(id)
      scheduleSave()
    },
    [scheduleSave]
  )
  const enqueue = useCallback(<T>(operation: () => Promise<T>): Promise<T | undefined> => {
    const next = serial.current.then(async () => {
      if (live.current) return await operation()
      return undefined
    })
    serial.current = next.catch((err) => {
      reportWorkbenchError(err, 'workbench.navigation')
      errorRef.current('The workspace action failed. Try again.')
    })
    return next.catch(() => undefined)
  }, [])
  const activate = useCallback(
    async (tab: ContentTab, flushed = false) => {
      if ((!flushed && !(await actions.current.flush())) || !live.current) return
      if (tab.kind === 'section') await actions.current.activateSection(tab.sectionId)
      if (!live.current) return
      if (tab.kind !== 'section') actions.current.clearSelection()
      actions.current.setWorkspace(tab.kind === 'section' ? 'manuscript' : tab.kind)
      const current = state.current
      commit(
        current.tabs.some((item) => tabId(item) === tabId(tab))
          ? current.tabs
          : [...current.tabs, tab],
        tabId(tab)
      )
    },
    [actions, commit]
  )
  const open = useCallback((tab: ContentTab) => enqueue(() => activate(tab)), [activate, enqueue])
  const didActivateSection = useCallback(
    (sectionId: string) => {
      const tab: ContentTab = { kind: 'section', sectionId }
      const current = state.current
      actions.current.setWorkspace('manuscript')
      commit(
        current.tabs.some((item) => tabId(item) === tabId(tab))
          ? current.tabs
          : [...current.tabs, tab],
        tabId(tab)
      )
    },
    [actions, commit]
  )
  const newNotebook = useCallback(
    () =>
      enqueue(async () => {
        if (state.current.tabs.filter((tab) => tab.kind === 'notebook').length >= 10) {
          errorRef.current('Up to 10 Notebooks may be open. Close one before creating another.')
          return
        }
        if (!(await actions.current.flush()) || !live.current) return
        const snapshot = await window.desktop.notebook.create({ projectSessionId })
        if (!live.current) return
        notebookStates.current.set(snapshot.notebookId, { snapshot, draft: '' })
        await activate(
          {
            kind: 'notebook',
            notebookId: snapshot.notebookId,
            number: nextNotebook.current++
          },
          true
        )
      }),
    [actions, activate, enqueue, projectSessionId]
  )
  const openNotebook = useCallback(() => {
    const current = state.current
    const tab =
      current.tabs.find((item) => item.kind === 'notebook' && tabId(item) === current.activeId) ??
      recent.current.flatMap((id) =>
        current.tabs.filter((item) => item.kind === 'notebook' && tabId(item) === id)
      )[0]
    return tab ? open(tab) : newNotebook()
  }, [newNotebook, open])
  const close = useCallback(
    (tab: ContentTab) =>
      enqueue(async () => {
        const id = tabId(tab)
        if (!state.current.tabs.some((item) => tabId(item) === id)) return
        if (!(await actions.current.flush()) || !live.current) return
        if (tab.kind === 'notebook') {
          const status = notebookStates.current.get(tab.notebookId)
          if (
            !status ||
            status.draft.length > 0 ||
            status.snapshot === null ||
            status.snapshot.messages.length > 0 ||
            status.snapshot.phase !== 'idle'
          ) {
            const confirmed = await new Promise<boolean>((resolve) => {
              confirmation.current = resolve
              setCloseRequest(tab)
            })
            if (!confirmed || !live.current) return
          }
          await window.desktop.notebook.destroy({ projectSessionId, notebookId: tab.notebookId })
          notebookStates.current.delete(tab.notebookId)
        }
        const current = state.current
        const index = current.tabs.findIndex((item) => tabId(item) === id)
        const remaining = current.tabs.filter((item) => tabId(item) !== id)
        const next =
          current.activeId === id
            ? remaining[Math.min(index, remaining.length - 1)]
            : remaining.find((item) => tabId(item) === current.activeId)
        commit(remaining, next ? tabId(next) : null)
        if (next && current.activeId === id) await activate(next, true)
        if (!next) actions.current.clearSelection()
      }),
    [actions, activate, commit, enqueue, projectSessionId]
  )
  useEffect(() => {
    live.current = true
    void window.desktop.workbench
      .read({ projectSessionId })
      .then((layout) => {
        if (!live.current) return
        tools.current = layout?.tools ?? null
        setInitialLayout(layout)
        if (layout)
          commit(layout.tabs, layout.activeTabId ?? (layout.tabs[0] ? tabId(layout.tabs[0]) : null))
        initialized.current = true
        setReady(true)
      })
      .catch((err) => {
        reportWorkbenchError(err, 'workbench.layout.restore')
        if (live.current) {
          initialized.current = true
          setReady(true)
          errorRef.current(
            'Workspace layout could not be restored. The default layout will be used.'
          )
        }
      })
    return () => {
      live.current = false
      confirmation.current?.(false)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [commit, projectSessionId])
  return {
    tabs,
    toolRequest,
    requestTool,
    activeId,
    ready,
    initialLayout,
    closeRequest,
    confirmClose(confirmed: boolean) {
      confirmation.current?.(confirmed)
      confirmation.current = null
      setCloseRequest(null)
    },
    notebookStatus,
    updateNotebook(notebookId: string, snapshot: NotebookChatSnapshot | null, draft: string) {
      notebookStates.current.set(notebookId, { snapshot, draft })
      const status =
        snapshot?.phase !== 'idle'
          ? (snapshot?.phase ?? 'loading')
          : snapshot.lastError
            ? 'error'
            : 'idle'
      setNotebookStatus((previous) =>
        previous[notebookId] === status ? previous : { ...previous, [notebookId]: status }
      )
    },
    enqueue,
    openRecentSection() {
      const tab = recent.current.flatMap((id) =>
        state.current.tabs.filter((item) => item.kind === 'section' && tabId(item) === id)
      )[0]
      if (tab) return open(tab)
      errorRef.current(
        'Choose a section from Outline before inserting a reference or returning to the manuscript.'
      )
      return Promise.resolve()
    },
    open,
    close,
    newNotebook,
    openNotebook,
    didActivateSection,
    save,
    reorder(ids: string[]) {
      const current = state.current
      commit(
        ids.flatMap((id) => current.tabs.filter((tab) => tabId(tab) === id)),
        current.activeId
      )
    },
    setTools(value: WorkbenchLayout['tools']) {
      tools.current = value
      scheduleSave()
    },
    reconcileSections(ids: Set<string>) {
      const current = state.current
      const valid = current.tabs.filter((tab) => tab.kind !== 'section' || ids.has(tab.sectionId))
      if (valid.length === current.tabs.length) return
      const active = valid.find((tab) => tabId(tab) === current.activeId) ?? valid[0]
      commit(valid, active ? tabId(active) : null)
      if (active && tabId(active) !== current.activeId) void enqueue(() => activate(active, true))
      if (!active) actions.current.clearSelection()
    }
  }
}
export type WorkbenchController = ReturnType<typeof useWorkbench>
