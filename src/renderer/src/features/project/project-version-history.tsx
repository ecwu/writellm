import { reportRendererOperationError } from '../../diagnostics'
import { rendererQueryKeys } from '@/lib/query-keys'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { GitCommitHorizontal, History, TriangleAlert } from 'lucide-react'
import type {
  ActiveProject,
  CheckpointEntry,
  VersionHistoryState
} from '../../../../shared/contracts/projects'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

export type VersionHistoryView = 'create' | 'history' | null

type VersionHistoryRequest = {
  projectSessionId: string
  generation: number
}

export function ProjectVersionHistory({
  projectSessionId,
  view,
  onViewChange,
  onStateChange,
  onProjectRestored,
  onError
}: {
  projectSessionId: string
  view: VersionHistoryView
  onViewChange(view: VersionHistoryView): void
  onStateChange(state: VersionHistoryState): void
  onProjectRestored(project: ActiveProject): void
  onError(message: string): void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const statusKey = rendererQueryKeys.projectVersionHistory.status(projectSessionId)
  const checkpointsKey = rendererQueryKeys.projectVersionHistory.checkpoints(projectSessionId)
  const comparisonKey = rendererQueryKeys.projectVersionHistory.comparison(projectSessionId)
  const mountedRef = useRef(true)
  const liveProjectSessionIdRef = useRef(projectSessionId)
  const requestGenerationRef = useRef(0)
  liveProjectSessionIdRef.current = projectSessionId
  useEffect(() => {
    liveProjectSessionIdRef.current = projectSessionId
    mountedRef.current = true
    requestGenerationRef.current += 1
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
    }
  }, [projectSessionId])
  const beginRequest = (): VersionHistoryRequest => ({
    projectSessionId,
    generation: ++requestGenerationRef.current
  })
  const isCurrentRequest = (request: VersionHistoryRequest): boolean =>
    mountedRef.current &&
    liveProjectSessionIdRef.current === request.projectSessionId &&
    requestGenerationRef.current === request.generation
  const invalidateHistoryQuery = useCallback(
    (queryKey: readonly unknown[], source: string): void => {
      void queryClient.invalidateQueries({ queryKey }).catch((err) => {
        reportRendererOperationError(err, source)
      })
    },
    [queryClient]
  )
  const [state, setState] = useState<VersionHistoryState>('uninitialized')
  const [promptOpen, setPromptOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<CheckpointEntry | null>(null)
  const [reinitializeOpen, setReinitializeOpen] = useState(false)

  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      try {
        return await window.desktop.projects.versionHistoryStatus({ projectSessionId })
      } catch (err) {
        reportRendererOperationError(err, 'project-version-history.status')
        throw err
      }
    },
    retry: false
  })
  const historyReady = statusQuery.data?.state === 'ready'
  const checkpointsQuery = useInfiniteQuery({
    queryKey: checkpointsKey,
    enabled: view === 'history' && historyReady,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      try {
        return await window.desktop.projects.listCheckpoints({
          projectSessionId,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          limit: 50
        })
      } catch (err) {
        reportRendererOperationError(err, 'project-version-history.checkpoints')
        throw err
      }
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false
  })
  const comparisonQuery = useQuery({
    queryKey: comparisonKey,
    enabled: view === 'history' && historyReady,
    queryFn: async () => {
      try {
        return await window.desktop.projects.compareCheckpointState({ projectSessionId })
      } catch (err) {
        reportRendererOperationError(err, 'project-version-history.comparison')
        throw err
      }
    },
    retry: false
  })
  const checkpoints = checkpointsQuery.data?.pages.flatMap((page) => page.checkpoints) ?? []
  const nextCursor = checkpointsQuery.data?.pages.at(-1)?.nextCursor ?? null
  const comparison = comparisonQuery.data?.status ?? null
  const historyLoading =
    view === 'history' &&
    historyReady === true &&
    (checkpointsQuery.isPending || comparisonQuery.isPending)
  const viewBusy = busy || historyLoading

  const updateState = useCallback(
    (next: VersionHistoryState): void => {
      setState(next)
      onStateChange(next)
    },
    [onStateChange]
  )

  useEffect(() => {
    const status = statusQuery.data
    if (status === undefined) return
    updateState(status.state)
    setPromptOpen(status.state === 'uninitialized' && !status.promptDismissed)
  }, [statusQuery.data, updateState])

  useEffect(() => {
    if (statusQuery.error) onError('Unable to inspect project version history.')
  }, [onError, statusQuery.error])

  useEffect(() => {
    if (checkpointsQuery.error || comparisonQuery.error) {
      onError('Unable to load project version history.')
    }
  }, [checkpointsQuery.error, comparisonQuery.error, onError])

  const loadEarlier = async (): Promise<void> => {
    if (!checkpointsQuery.hasNextPage || checkpointsQuery.isFetchingNextPage) return
    const request = beginRequest()
    setBusy(true)
    try {
      await checkpointsQuery.fetchNextPage()
      if (!isCurrentRequest(request)) return
    } catch (err) {
      reportRendererOperationError(err, 'project-version-history.checkpoints.next-page')
      if (isCurrentRequest(request)) onError('Unable to load earlier checkpoints.')
    } finally {
      if (isCurrentRequest(request)) setBusy(false)
    }
  }

  const enable = async (): Promise<void> => {
    const request = beginRequest()
    setBusy(true)
    try {
      await window.desktop.projects.enableVersionHistory({ projectSessionId })
      queryClient.setQueryData(statusKey, { state: 'ready', promptDismissed: true })
      invalidateHistoryQuery(checkpointsKey, 'project-version-history.checkpoints.invalidate')
      invalidateHistoryQuery(comparisonKey, 'project-version-history.comparison.invalidate')
      if (!isCurrentRequest(request)) return
      updateState('ready')
      setPromptOpen(false)
    } catch (err) {
      reportRendererOperationError(err, 'project-version-history')
      if (isCurrentRequest(request)) onError('Unable to enable project version history.')
      invalidateHistoryQuery(statusKey, 'project-version-history.status.invalidate')
    } finally {
      if (isCurrentRequest(request)) setBusy(false)
    }
  }

  const dismiss = async (): Promise<void> => {
    const request = beginRequest()
    try {
      const next = await window.desktop.projects.dismissVersionHistoryPrompt({ projectSessionId })
      queryClient.setQueryData(statusKey, next)
      if (!isCurrentRequest(request)) return
      updateState(next.state)
      setPromptOpen(false)
    } catch (err) {
      reportRendererOperationError(err, 'project-version-history')
      if (isCurrentRequest(request)) onError('Unable to save the version history preference.')
    }
  }

  const createCheckpoint = async (): Promise<void> => {
    const request = beginRequest()
    setBusy(true)
    try {
      await window.desktop.projects.createCheckpoint({
        projectSessionId,
        name,
        ...(note.trim() === '' ? {} : { note })
      })
      invalidateHistoryQuery(checkpointsKey, 'project-version-history.checkpoints.invalidate')
      invalidateHistoryQuery(comparisonKey, 'project-version-history.comparison.invalidate')
      if (!isCurrentRequest(request)) return
      setName('')
      setNote('')
      onViewChange(null)
    } catch (err) {
      reportRendererOperationError(err, 'project-version-history')
      if (isCurrentRequest(request)) onError('Unable to create the checkpoint.')
    } finally {
      if (isCurrentRequest(request)) setBusy(false)
    }
  }

  const restoreCheckpoint = async (): Promise<void> => {
    if (restoreTarget === null) return
    const request = beginRequest()
    setBusy(true)
    try {
      const restored = await window.desktop.projects.restoreCheckpoint({
        projectSessionId,
        oid: restoreTarget.oid
      })
      invalidateHistoryQuery(statusKey, 'project-version-history.status.invalidate')
      invalidateHistoryQuery(checkpointsKey, 'project-version-history.checkpoints.invalidate')
      invalidateHistoryQuery(comparisonKey, 'project-version-history.comparison.invalidate')
      if (!isCurrentRequest(request)) return
      onProjectRestored(restored.project)
      setRestoreTarget(null)
      onViewChange(null)
    } catch (err) {
      reportRendererOperationError(err, 'project-version-history')
      if (isCurrentRequest(request)) {
        onError('Unable to restore the checkpoint. The original project was preserved.')
      }
    } finally {
      if (isCurrentRequest(request)) setBusy(false)
    }
  }

  const reinitialize = async (): Promise<void> => {
    const request = beginRequest()
    setBusy(true)
    try {
      await window.desktop.projects.reinitializeVersionHistory({ projectSessionId })
      queryClient.setQueryData(statusKey, { state: 'ready', promptDismissed: true })
      invalidateHistoryQuery(checkpointsKey, 'project-version-history.checkpoints.invalidate')
      invalidateHistoryQuery(comparisonKey, 'project-version-history.comparison.invalidate')
      if (!isCurrentRequest(request)) return
      updateState('ready')
      setReinitializeOpen(false)
      onViewChange(null)
    } catch (err) {
      reportRendererOperationError(err, 'project-version-history')
      if (isCurrentRequest(request)) onError('Unable to reinitialize project version history.')
    } finally {
      if (isCurrentRequest(request)) setBusy(false)
    }
  }

  return (
    <>
      <AlertDialog open={promptOpen} onOpenChange={setPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable version history?</AlertDialogTitle>
            <AlertDialogDescription>
              Create a private project-local history so you can name checkpoints and return to
              earlier project states. This does not upload the project or modify an outer Git
              repository.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={viewBusy} onClick={() => void dismiss()}>
              Not now
            </AlertDialogCancel>
            <AlertDialogAction disabled={viewBusy} onClick={() => void enable()}>
              {viewBusy ? <Spinner /> : null}
              Enable history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={view === 'create'}
        onOpenChange={(open) => onViewChange(open ? 'create' : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create checkpoint</DialogTitle>
            <DialogDescription>
              Save a named, consistent version of the entire project.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='checkpoint-name'>Name</FieldLabel>
              <Input
                id='checkpoint-name'
                value={name}
                maxLength={100}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>{name.length}/100 characters</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='checkpoint-note'>Note (optional)</FieldLabel>
              <Textarea
                id='checkpoint-note'
                value={note}
                maxLength={2_000}
                onChange={(event) => setNote(event.target.value)}
              />
              <FieldDescription>{note.length}/2,000 characters</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant='outline' disabled={viewBusy} onClick={() => onViewChange(null)}>
              Cancel
            </Button>
            <Button
              disabled={viewBusy || name.trim() === ''}
              onClick={() => void createCheckpoint()}
            >
              {viewBusy ? <Spinner /> : <GitCommitHorizontal />}
              Create checkpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={view === 'history'}
        onOpenChange={(open) => onViewChange(open ? 'history' : null)}
      >
        <SheetContent className='sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>Version history</SheetTitle>
            <SheetDescription>
              Named, project-local checkpoints on one linear history.
            </SheetDescription>
            {state === 'ready' && comparison ? (
              <Badge variant={comparison === 'up-to-date' ? 'secondary' : 'outline'}>
                {comparison === 'up-to-date' ? 'Up to date' : 'Uncheckpointed changes'}
              </Badge>
            ) : null}
          </SheetHeader>
          <ScrollArea className='min-h-0 flex-1 px-4'>
            {state === 'damaged' ? (
              <Item variant='outline'>
                <ItemMedia variant='icon'>
                  <TriangleAlert />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Version history unavailable</ItemTitle>
                  <ItemDescription>
                    The project remains editable. Use diagnostics before reinitializing its history.
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={viewBusy}
                    onClick={() => setReinitializeOpen(true)}
                  >
                    Reinitialize
                  </Button>
                </ItemActions>
              </Item>
            ) : viewBusy ? (
              <div className='flex items-center gap-2 py-8 text-sm text-muted-foreground'>
                <Spinner /> Comparing the current project and loading checkpoints…
              </div>
            ) : (
              <ItemGroup className='gap-2 pb-4'>
                {checkpoints.map((checkpoint) => (
                  <Item key={checkpoint.oid} variant='outline'>
                    <ItemMedia variant='icon'>
                      <History />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{checkpoint.name}</ItemTitle>
                      <ItemDescription>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        }).format(new Date(checkpoint.createdAt))}
                        {checkpoint.note ? ` · ${checkpoint.note}` : ''}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={viewBusy}
                        onClick={() => setRestoreTarget(checkpoint)}
                      >
                        Restore
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
                {nextCursor === null ? null : (
                  <Button variant='outline' disabled={viewBusy} onClick={() => void loadEarlier()}>
                    {viewBusy ? <Spinner /> : null}
                    Load earlier checkpoints
                  </Button>
                )}
              </ItemGroup>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !viewBusy) setRestoreTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this checkpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              WriteLLM will first protect any uncheckpointed changes, then replace the current
              project state with “{restoreTarget?.name}”. Later checkpoints remain in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={viewBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={viewBusy} onClick={() => void restoreCheckpoint()}>
              {viewBusy ? <Spinner /> : null}
              Restore checkpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={reinitializeOpen}
        onOpenChange={(open) => {
          if (!open && !viewBusy) setReinitializeOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reinitialize version history?</AlertDialogTitle>
            <AlertDialogDescription>
              The damaged repository will be moved into project recovery storage. A new baseline
              checkpoint will be created from the current project; the old history will not be
              overwritten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={viewBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={viewBusy} onClick={() => void reinitialize()}>
              {viewBusy ? <Spinner /> : null}
              Reinitialize history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
