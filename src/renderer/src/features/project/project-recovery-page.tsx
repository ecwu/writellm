import {
  AlertCircle,
  ArrowLeft,
  FileArchive,
  FolderSearch,
  History,
  LockOpen,
  RotateCw,
  Stethoscope,
  Trash2
} from 'lucide-react'
import type {
  ProjectLifecycleSnapshot,
  ProjectOpenRecoveryReason,
  ProjectSelectionResult
} from '../../../../shared/contracts/projects'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const openDiagnosis: Record<ProjectOpenRecoveryReason, { title: string; detail: string }> = {
  'folder-missing': {
    title: 'Project folder not found',
    detail:
      'Choose the project’s current folder if you moved it. Reconnect its drive if it is offline.'
  },
  'manifest-missing': {
    title: 'Project manifest is missing',
    detail:
      'The folder lacks writellm.project.json. Rebuild it from the project database and reopen here, or save a separate copy. Checkpoint history stays in the original folder.'
  },
  'manifest-unreadable': {
    title: 'Project manifest could not be read',
    detail:
      'Make sure you can read writellm.project.json, then retry. You can also choose a complete project folder or restore a snapshot.'
  },
  'manifest-invalid': {
    title: 'Project manifest is invalid or unsupported',
    detail:
      'WriteLLM could not recognize writellm.project.json. Choose a complete project folder or restore a snapshot.'
  },
  'database-unavailable': {
    title: 'Project database is missing or inaccessible',
    detail:
      'WriteLLM could not access .writellm/project.sqlite. Choose a complete project folder or restore a snapshot.'
  },
  'database-open-failed': {
    title: 'Project database could not open',
    detail:
      'WriteLLM could not open or validate .writellm/project.sqlite. Export diagnostics for details or restore a snapshot.'
  },
  'lock-contended': {
    title: 'Project is locked',
    detail:
      'Another WriteLLM process still holds this project lock. Close that process and retry. If it ended unexpectedly, wait one minute, then recover the stale lock.'
  },
  'open-failed': {
    title: 'Project could not open',
    detail: 'Retry opening the project or export diagnostics for details.'
  }
}

type RecoveryAction = () => Promise<ProjectLifecycleSnapshot | ProjectSelectionResult>

export function ProjectRecoveryPage({
  recovery,
  busy,
  runRecovery,
  exportDiagnostics,
  restoreSnapshot
}: {
  recovery: ProjectLifecycleSnapshot['recovery']
  busy: boolean
  runRecovery: (action: RecoveryAction, failureMessage?: string) => Promise<void>
  exportDiagnostics: () => Promise<void>
  restoreSnapshot: () => Promise<void>
}) {
  const reason = recovery?.kind === 'open' ? recovery.reason : 'open-failed'
  const openRecovery = recovery?.kind === 'open'
  const canLeave = openRecovery || recovery === undefined
  const diagnosis =
    recovery?.kind === 'close'
      ? {
          title: 'Project did not close completely',
          detail: 'Retry close to finish saving and release the project lock.'
        }
      : recovery?.kind === 'create'
        ? {
            title: 'Project creation did not finish',
            detail: 'Discard the incomplete project before trying to create another one.'
          }
        : openDiagnosis[reason]
  const projects = window.desktop.projects

  return (
    <main className='flex min-h-0 flex-1 overflow-auto p-6 lg:p-10' aria-busy={busy}>
      <div className='m-auto flex w-full max-w-2xl flex-col gap-6'>
        <h1 className='flex items-center gap-3 text-2xl font-semibold tracking-tight'>
          <Stethoscope className='size-6 text-muted-foreground' aria-hidden='true' />
          Project diagnostics
        </h1>
        <Alert variant='destructive' role='status'>
          <AlertCircle />
          <AlertTitle>Recovery required</AlertTitle>
          <AlertDescription>
            <p className='font-medium'>{diagnosis.title}</p>
            <p>{diagnosis.detail}</p>
          </AlertDescription>
        </Alert>
        <div className='flex flex-wrap gap-2'>
          {reason === 'manifest-missing' && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  void runRecovery(
                    () => projects.rebuildMissingManifest({ mode: 'in-place' }),
                    'WriteLLM could not rebuild or open this project. Retry opening, or try a recovery copy.'
                  )
                }
              >
                Rebuild manifest here
              </Button>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() =>
                  void runRecovery(
                    () => projects.rebuildMissingManifest({ mode: 'copy' }),
                    'WriteLLM could not verify or open the recovery copy. Choose a complete project folder or restore a snapshot.'
                  )
                }
              >
                Rebuild manifest in a copy
              </Button>
            </>
          )}
          {reason === 'lock-contended' && (
            <Button disabled={busy} onClick={() => void runRecovery(projects.recoverStaleLock)}>
              <LockOpen data-icon='inline-start' /> Recover stale lock
            </Button>
          )}
          {openRecovery && (
            <>
              <Button
                variant={reason === 'folder-missing' ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => void runRecovery(projects.locateMoved)}
              >
                <FolderSearch data-icon='inline-start' /> Locate project folder
              </Button>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void runRecovery(projects.retryOpen)}
              >
                <RotateCw data-icon='inline-start' /> Retry open
              </Button>
            </>
          )}
          {recovery?.kind === 'close' && (
            <Button disabled={busy} onClick={() => void runRecovery(projects.retryClose)}>
              <RotateCw data-icon='inline-start' /> Retry close
            </Button>
          )}
          {recovery?.kind === 'create' && (
            <Button
              variant='destructive'
              disabled={busy}
              onClick={() => void runRecovery(projects.discardIncompleteCreate)}
            >
              <Trash2 data-icon='inline-start' /> Discard incomplete create
            </Button>
          )}
          {canLeave && reason !== 'lock-contended' && (
            <Button variant='outline' disabled={busy} onClick={() => void restoreSnapshot()}>
              <History data-icon='inline-start' /> Restore a snapshot
            </Button>
          )}
        </div>
        <div className='flex flex-wrap gap-2 border-t pt-4'>
          {canLeave && (
            <Button
              variant='ghost'
              disabled={busy}
              onClick={() => void runRecovery(projects.returnToClosed)}
            >
              <ArrowLeft data-icon='inline-start' /> Return to closed
            </Button>
          )}
          <Button variant='ghost' disabled={busy} onClick={() => void exportDiagnostics()}>
            <FileArchive data-icon='inline-start' /> Export diagnostics
          </Button>
        </div>
      </div>
    </main>
  )
}
