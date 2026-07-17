import type { BlockNoteDocument, ManuscriptAssembly } from '../../../../shared/contracts/manuscript'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { FileText, LoaderCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTheme } from '@/theme-provider'
import { approvedEditorSchema, type ApprovedEditorBlock } from './editor-schema'

function fallbackDocument(): ApprovedEditorBlock[] {
  return [
    {
      id: crypto.randomUUID(),
      type: 'paragraph',
      props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
      content: [],
      children: []
    }
  ]
}

function ReadOnlySectionBody({ document }: { document: BlockNoteDocument }): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const editor = useCreateBlockNote({
    schema: approvedEditorSchema,
    initialContent: document.length === 0 ? fallbackDocument() : (document as ApprovedEditorBlock[])
  })
  return (
    <BlockNoteView editor={editor} theme={resolvedTheme} editable={false} className='px-0 py-2' />
  )
}

export function ManuscriptPreview(props: {
  open: boolean
  assembly: ManuscriptAssembly | undefined
  loading: boolean
  error: boolean
  onOpenChange(open: boolean): void
}): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>Whole manuscript preview</DialogTitle>
          <DialogDescription>
            Section headings come from the outline; bodies are read-only native BlockNote content.
          </DialogDescription>
        </DialogHeader>
        {props.loading ? (
          <div className='flex min-h-64 items-center justify-center gap-2 text-muted-foreground'>
            <LoaderCircle className='size-5 animate-spin' /> Assembling manuscript…
          </div>
        ) : props.error ? (
          <p className='py-12 text-center text-sm text-destructive'>
            The manuscript preview could not be assembled.
          </p>
        ) : props.assembly ? (
          <article className='space-y-8' data-testid='whole-manuscript-preview'>
            <header className='space-y-2 border-b pb-6'>
              <h1 className='text-3xl font-semibold tracking-tight'>
                {props.assembly.brief.title}
              </h1>
              {props.assembly.brief.description ? (
                <p className='text-muted-foreground'>{props.assembly.brief.description}</p>
              ) : null}
              <p className='text-sm text-muted-foreground'>
                {props.assembly.wordCount.toLocaleString()} words ·{' '}
                {props.assembly.characterCount.toLocaleString()} characters
              </p>
            </header>
            {props.assembly.sections.map(({ section, revision }) => {
              const Heading =
                `h${Math.min(section.level + 1, 6)}` as keyof React.JSX.IntrinsicElements
              return (
                <section key={section.sectionId} data-section-id={section.sectionId}>
                  <Heading className='font-semibold tracking-tight'>{section.title}</Heading>
                  {section.objective ? (
                    <p className='mt-1 text-sm text-muted-foreground'>{section.objective}</p>
                  ) : null}
                  <ReadOnlySectionBody document={revision.content} />
                </section>
              )
            })}
          </article>
        ) : (
          <div className='flex min-h-64 items-center justify-center text-muted-foreground'>
            <FileText className='mr-2 size-5' /> No manuscript content is available.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
