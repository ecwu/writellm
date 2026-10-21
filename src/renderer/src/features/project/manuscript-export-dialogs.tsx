import { TriangleAlert } from 'lucide-react'
import type { ManuscriptExportResult } from '../../../../shared/contracts/manuscript-export'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

export interface ManuscriptExportDialogsProps {
  active: boolean
  result: Extract<ManuscriptExportResult, { created: true }> | undefined
  cancelling: boolean
  onCancel: () => void
  onResultChange: (open: boolean) => void
}

export function ManuscriptExportDialogs({
  active,
  result,
  cancelling,
  onCancel,
  onResultChange
}: ManuscriptExportDialogsProps): React.JSX.Element {
  return (
    <>
      <Dialog open={active} onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Publishing manuscript</DialogTitle>
            <DialogDescription>
              WriteLLM is capturing the current manuscript, verifying assets, and building the
              selected format.
            </DialogDescription>
          </DialogHeader>
          <div className='flex items-center gap-3 text-sm text-muted-foreground' role='status'>
            <Spinner />
            {cancelling ? 'Cancelling…' : 'Publication is in progress…'}
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' disabled={cancelling} onClick={onCancel}>
              {cancelling ? 'Cancelling…' : 'Cancel export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={result !== undefined} onOpenChange={onResultChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manuscript exported</DialogTitle>
            <DialogDescription>
              {result?.packageName} contains the complete current manuscript and{' '}
              {result?.assetCount ?? 0} referenced asset{(result?.assetCount ?? 0) === 1 ? '' : 's'}
              .
            </DialogDescription>
          </DialogHeader>
          {result?.lossReport && result.lossReport.losses.length > 0 ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Publication limitations</AlertTitle>
              <AlertDescription>
                <p>
                  {result.lossReport.losses.length} formatting detail
                  {result.lossReport.losses.length === 1 ? ' was' : 's were'} recorded in{' '}
                  writellm.loss-report.json.
                </p>
                <ul className='list-disc pl-4'>
                  {result.lossReport.losses.slice(0, 5).map((loss) => (
                    <li key={`${loss.sectionId}:${loss.blockId}:${loss.code}`}>{loss.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
