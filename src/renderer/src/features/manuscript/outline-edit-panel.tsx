import type { Section } from '../../../../shared/contracts/manuscript'
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  IndentDecrease,
  IndentIncrease,
  Upload
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { SaveState } from './section-editor'

export type OutlineMove = 'up' | 'down' | 'indent' | 'outdent'

const saveStateLabels: Record<SaveState, string> = {
  clean: 'Unsaved body',
  saving: 'Saving body',
  saved: 'Saved',
  'mirror-pending': 'Saved, mirror pending',
  conflict: 'Conflict',
  failed: 'Save failed'
}

export function OutlineEditPanel(props: {
  open: boolean
  onOpenChange(open: boolean): void
  activeSection: Section | undefined
  saveState: SaveState
  canMoveUp: boolean
  canMoveDown: boolean
  canIndent: boolean
  canOutdent: boolean
  onMove(move: OutlineMove): void
  onImportMarkdown(): Promise<void>
  onExportNativeJson(): Promise<void>
  onExportMarkdown(): Promise<void>
  onPreviewAll(): Promise<void>
}): React.JSX.Element {
  const disabled = props.activeSection === undefined

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side='left' className='w-[min(92vw,420px)] sm:max-w-md'>
        <SheetHeader className='border-b pr-12'>
          <SheetTitle>Outline editor</SheetTitle>
          <SheetDescription>
            Adjust hierarchy, move section content, and preview or exchange the current section.
          </SheetDescription>
        </SheetHeader>
        <div className='flex-1 space-y-6 overflow-y-auto px-4 pb-6'>
          <section className='space-y-3' aria-labelledby='outline-editor-current-section'>
            <div className='flex items-center justify-between gap-3'>
              <h2 id='outline-editor-current-section' className='text-sm font-medium'>
                Current section
              </h2>
              <Badge variant='outline'>{saveStateLabels[props.saveState]}</Badge>
            </div>
            {props.activeSection ? (
              <div className='space-y-1 rounded-md border px-3 py-2'>
                <p className='font-medium'>{props.activeSection.title}</p>
                <p className='text-xs text-muted-foreground'>
                  Outline level {props.activeSection.level}
                </p>
              </div>
            ) : (
              <p className='rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground'>
                Select a section from the outline to edit its position or exchange its content.
              </p>
            )}
          </section>

          <Separator />

          <section className='space-y-3' aria-labelledby='outline-editor-hierarchy'>
            <div>
              <h2 id='outline-editor-hierarchy' className='text-sm font-medium'>
                Hierarchy
              </h2>
              <p className='mt-1 text-xs text-muted-foreground'>
                Move the selected section among its siblings or change its nesting level.
              </p>
            </div>
            <div className='grid grid-cols-2 gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={disabled || !props.canMoveUp}
                onClick={() => props.onMove('up')}
              >
                <ArrowUp /> Up
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={disabled || !props.canMoveDown}
                onClick={() => props.onMove('down')}
              >
                <ArrowDown /> Down
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={disabled || !props.canIndent}
                onClick={() => props.onMove('indent')}
              >
                <IndentIncrease /> Indent
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={disabled || !props.canOutdent}
                onClick={() => props.onMove('outdent')}
              >
                <IndentDecrease /> Outdent
              </Button>
            </div>
          </section>

          <Separator />

          <section className='space-y-3' aria-labelledby='outline-editor-interchange'>
            <div>
              <h2 id='outline-editor-interchange' className='text-sm font-medium'>
                Interchange
              </h2>
              <p className='mt-1 text-xs text-muted-foreground'>
                Import Markdown into, or export the current section from, the native BlockNote
                document.
              </p>
            </div>
            <div className='grid gap-2'>
              <Button
                variant='outline'
                className='justify-start'
                disabled={disabled}
                onClick={() => void props.onImportMarkdown()}
              >
                <Upload /> Import Markdown
              </Button>
              <Button
                variant='outline'
                className='justify-start'
                disabled={disabled}
                onClick={() => void props.onExportNativeJson()}
              >
                <Download /> Native JSON
              </Button>
              <Button
                variant='outline'
                className='justify-start'
                disabled={disabled}
                onClick={() => void props.onExportMarkdown()}
              >
                <Download /> Markdown
              </Button>
            </div>
          </section>

          <Separator />

          <section className='space-y-3' aria-labelledby='outline-editor-preview'>
            <div>
              <h2 id='outline-editor-preview' className='text-sm font-medium'>
                Preview
              </h2>
              <p className='mt-1 text-xs text-muted-foreground'>
                Review the assembled manuscript in the current outline order.
              </p>
            </div>
            <Button
              variant='outline'
              className='w-full justify-start'
              onClick={() => void props.onPreviewAll()}
            >
              <FileText /> Preview all
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
