import type { ManuscriptImportPlan } from '../../../../shared/contracts/manuscript-import'
import { AlertTriangle, FileText, ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'

export function ManuscriptImportDialog(props: {
  open: boolean
  plan: ManuscriptImportPlan | null
  loading: boolean
  applying: boolean
  error: string | null
  onOpenChange(open: boolean): void
  onApply(mode: 'create_sections' | 'replace_active_section'): Promise<void>
  onCancel(): Promise<void>
}): React.JSX.Element {
  const [mode, setMode] = useState<'create_sections' | 'replace_active_section'>('create_sections')
  const [selectedSection, setSelectedSection] = useState(0)

  const section = props.plan?.sections[selectedSection]
  const findings = props.plan
    ? [...props.plan.warnings, ...props.plan.unsupported, ...props.plan.losses]
    : []

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-5xl! overflow-hidden'>
        <DialogHeader>
          <DialogTitle>Review manuscript import</DialogTitle>
          <DialogDescription>
            Nothing in the manuscript changes until you approve this captured, hashed plan.
          </DialogDescription>
        </DialogHeader>

        {props.loading ? (
          <div className='flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground'>
            <Spinner /> Capturing and mapping the selected manuscript…
          </div>
        ) : null}

        {props.error ? (
          <Alert variant='destructive'>
            <AlertTriangle />
            <AlertTitle>Import plan unavailable</AlertTitle>
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        ) : null}

        {props.plan ? (
          <div className='grid min-h-0 gap-4 md:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]'>
            <div className='min-h-0 space-y-3'>
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <Badge variant='outline'>{props.plan.source.displayName}</Badge>
                <Badge variant='secondary'>{props.plan.source.format.toUpperCase()}</Badge>
                <span className='text-muted-foreground'>
                  {formatBytes(props.plan.source.byteSize)} ·{' '}
                  {props.plan.source.sha256.slice(0, 10)}…
                </span>
              </div>
              <ScrollArea className='h-[42vh] rounded-md border'>
                <div className='space-y-1 p-2'>
                  {props.plan.sections.map((candidate, index) => (
                    <Button
                      key={candidate.proposedSectionId}
                      type='button'
                      variant={selectedSection === index ? 'secondary' : 'ghost'}
                      className='h-auto w-full justify-start whitespace-normal px-3 py-2 text-left'
                      onClick={() => setSelectedSection(index)}
                    >
                      <FileText className='size-4 shrink-0' />
                      <span className='min-w-0'>
                        <span className='block font-medium'>{candidate.title}</span>
                        <span className='block text-xs text-muted-foreground'>
                          {candidate.blockCount} blocks
                        </span>
                      </span>
                    </Button>
                  ))}
                  {props.plan.sections.length === 0 ? (
                    <p className='p-3 text-sm text-muted-foreground'>No importable sections.</p>
                  ) : null}
                </div>
              </ScrollArea>
              <div className='flex flex-wrap gap-2 text-xs text-muted-foreground'>
                <span className='inline-flex items-center gap-1'>
                  <ImageIcon className='size-3.5' /> {props.plan.assets.length} registered images
                </span>
                <span>{findings.length} mapping notes</span>
              </div>
            </div>

            <div className='min-h-0 space-y-3'>
              <div>
                <h3 className='font-medium'>{section?.title ?? 'Content preview'}</h3>
                <p className='text-sm text-muted-foreground'>Mapped BlockNote body</p>
              </div>
              <ScrollArea className='h-[30vh] rounded-md border bg-muted/20'>
                <div className='whitespace-pre-wrap p-4 text-sm leading-6'>
                  {section?.previewText || 'No mapped body content.'}
                </div>
              </ScrollArea>
              {findings.length > 0 ? (
                <div className='space-y-2'>
                  <Separator />
                  <p className='text-sm font-medium'>Warnings and losses</p>
                  <ScrollArea className='h-28'>
                    <ul className='space-y-1 pr-3 text-xs text-muted-foreground'>
                      {findings.map((finding, index) => (
                        <li key={`${finding.code}:${finding.sourceLocation ?? index}`}>
                          <span className='font-medium text-foreground'>{finding.message}</span>
                          {finding.sourceLocation ? ` · ${finding.sourceLocation}` : ''}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </div>
              ) : null}
              <div className='grid gap-2 sm:grid-cols-2'>
                <Button
                  type='button'
                  variant={mode === 'create_sections' ? 'default' : 'outline'}
                  className='h-auto justify-start py-3 text-left'
                  onClick={() => setMode('create_sections')}
                >
                  <span>
                    <span className='block'>Create new sections</span>
                    <span className='block text-xs opacity-75'>Append every previewed section</span>
                  </span>
                </Button>
                <Button
                  type='button'
                  variant={mode === 'replace_active_section' ? 'default' : 'outline'}
                  className='h-auto justify-start py-3 text-left'
                  onClick={() => setMode('replace_active_section')}
                >
                  <span>
                    <span className='block'>Replace active section</span>
                    <span className='block text-xs opacity-75'>
                      Keep the existing outline entry
                    </span>
                  </span>
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={props.applying}
            onClick={() => void props.onCancel()}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={props.plan?.noOp !== false || props.loading || props.applying}
            onClick={() => void props.onApply(mode)}
          >
            {props.applying ? <Spinner /> : null}
            Apply reviewed import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / 1_048_576).toFixed(1)} MiB`
}
