import { useCallback, useEffect, useState } from 'react'
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
  const [state, setState] = useState<VersionHistoryState>('uninitialized')
  const [promptOpen, setPromptOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [comparison, setComparison] = useState<'up-to-date' | 'uncheckpointed-changes' | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<CheckpointEntry | null>(null)
  const [reinitializeOpen, setReinitializeOpen] = useState(false)

  const updateState = useCallback(
    (next: VersionHistoryState): void => {
      setState(next)
      onStateChange(next)
    },
    [onStateChange]
  )

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.desktop.projects.versionHistoryStatus({ projectSessionId })
      updateState(status.state)
      setPromptOpen(status.state === 'uninitialized' && !status.promptDismissed)
    } catch {
      onError('Unable to inspect project version history.')
    }
  }, [onError, projectSessionId, updateState])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (view !== 'history' || state !== 'ready') return
    setBusy(true)
    void Promise.all([
      window.desktop.projects.listCheckpoints({ projectSessionId, limit: 50 }),
      window.desktop.projects.compareCheckpointState({ projectSessionId })
    ])
      .then(([page, current]) => {
        setCheckpoints(page.checkpoints)
        setNextCursor(page.nextCursor)
        setComparison(current.status)
      })
      .catch(() => onError('Unable to load project version history.'))
      .finally(() => setBusy(false))
  }, [onError, projectSessionId, state, view])

  const loadEarlier = async (): Promise<void> => {
    if (nextCursor === null) return
    setBusy(true)
    try {
      const page = await window.desktop.projects.listCheckpoints({
        projectSessionId,
        cursor: nextCursor,
        limit: 50
      })
      setCheckpoints((current) => [...current, ...page.checkpoints])
      setNextCursor(page.nextCursor)
    } catch {
      onError('Unable to load earlier checkpoints.')
    } finally {
      setBusy(false)
    }
  }

  const enable = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.desktop.projects.enableVersionHistory({ projectSessionId })
      updateState('ready')
      setPromptOpen(false)
    } catch {
      onError('Unable to enable project version history.')
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async (): Promise<void> => {
    try {
      await window.desktop.projects.dismissVersionHistoryPrompt({ projectSessionId })
      setPromptOpen(false)
    } catch {
      onError('Unable to save the version history preference.')
    }
  }

  const createCheckpoint = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.desktop.projects.createCheckpoint({
        projectSessionId,
        name,
        ...(note.trim() === '' ? {} : { note })
      })
      setName('')
      setNote('')
      onViewChange(null)
    } catch {
      onError('Unable to create the checkpoint.')
    } finally {
      setBusy(false)
    }
  }

  const restoreCheckpoint = async (): Promise<void> => {
    if (restoreTarget === null) return
    setBusy(true)
    try {
      const restored = await window.desktop.projects.restoreCheckpoint({
        projectSessionId,
        oid: restoreTarget.oid
      })
      onProjectRestored(restored.project)
      setRestoreTarget(null)
      onViewChange(null)
    } catch {
      onError('Unable to restore the checkpoint. The original project was preserved.')
    } finally {
      setBusy(false)
    }
  }

  const reinitialize = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.desktop.projects.reinitializeVersionHistory({ projectSessionId })
      updateState('ready')
      setReinitializeOpen(false)
      onViewChange(null)
    } catch {
      onError('Unable to reinitialize project version history.')
    } finally {
      setBusy(false)
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
            <AlertDialogCancel disabled={busy} onClick={() => void dismiss()}>
              Not now
            </AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void enable()}>
              {busy ? <Spinner /> : null}
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
            <Button variant='outline' disabled={busy} onClick={() => onViewChange(null)}>
              Cancel
            </Button>
            <Button disabled={busy || name.trim() === ''} onClick={() => void createCheckpoint()}>
              {busy ? <Spinner /> : <GitCommitHorizontal />}
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
                    disabled={busy}
                    onClick={() => setReinitializeOpen(true)}
                  >
                    Reinitialize
                  </Button>
                </ItemActions>
              </Item>
            ) : busy ? (
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
                        disabled={busy}
                        onClick={() => setRestoreTarget(checkpoint)}
                      >
                        Restore
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
                {nextCursor === null ? null : (
                  <Button variant='outline' disabled={busy} onClick={() => void loadEarlier()}>
                    {busy ? <Spinner /> : null}
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
          if (!open && !busy) setRestoreTarget(null)
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
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void restoreCheckpoint()}>
              {busy ? <Spinner /> : null}
              Restore checkpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={reinitializeOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setReinitializeOpen(false)
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
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void reinitialize()}>
              {busy ? <Spinner /> : null}
              Reinitialize history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
