import type { BlockNoteDocument, ManuscriptAssembly } from '../../../../shared/contracts/manuscript'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useTheme } from '@/theme-provider'
import { approvedEditorSchema, type ApprovedEditorBlock } from './editor-schema'
import { resolveProjectAssetUrl } from './project-asset-url'

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

function ReadOnlySectionBody(props: {
  projectSessionId: string
  revisionId: string
  document: BlockNoteDocument
}): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const editor = useCreateBlockNote(
    {
      schema: approvedEditorSchema,
      initialContent:
        props.document.length === 0
          ? fallbackDocument()
          : (props.document as ApprovedEditorBlock[]),
      resolveFileUrl: (url) =>
        resolveProjectAssetUrl(url, props.projectSessionId, window.desktop.editor.resolveAsset)
    },
    [props.projectSessionId, props.revisionId]
  )
  return (
    <BlockNoteView
      editor={editor}
      theme={resolvedTheme}
      editable={false}
      className='manuscript-preview-body min-w-0 max-w-full py-2'
    />
  )
}

export function ManuscriptPreview(props: {
  projectSessionId: string
  open: boolean
  assembly: ManuscriptAssembly | undefined
  loading: boolean
  error: boolean
  onOpenChange(open: boolean): void
}): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className='grid h-[min(92vh,64rem)] w-[min(96vw,72rem)] min-w-0 max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none'
        data-testid='whole-manuscript-preview-dialog'
      >
        <DialogHeader className='min-w-0 border-b px-5 py-5 pr-12 sm:px-6'>
          <DialogTitle>Whole manuscript preview</DialogTitle>
          <DialogDescription className='wrap-anywhere'>
            Section headings come from the outline; bodies are read-only native BlockNote content.
          </DialogDescription>
        </DialogHeader>
        <div
          className='min-h-0 min-w-0 overflow-x-hidden overflow-y-auto'
          data-testid='whole-manuscript-preview-scroll'
        >
          {props.loading ? (
            <div className='flex min-h-full items-center justify-center gap-2 text-muted-foreground'>
              <Spinner /> Assembling manuscript…
            </div>
          ) : props.error ? (
            <p className='py-12 text-center text-sm text-destructive'>
              The manuscript preview could not be assembled.
            </p>
          ) : props.assembly ? (
            <article
              className='mx-auto flex w-full max-w-[75ch] min-w-0 flex-col gap-8 wrap-anywhere px-5 py-6 sm:px-6 sm:py-8'
              data-testid='whole-manuscript-preview'
            >
              <header className='flex min-w-0 flex-col gap-2 border-b pb-6'>
                <h1 className='text-balance text-2xl font-semibold tracking-tight wrap-anywhere sm:text-3xl'>
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
                  <section
                    key={section.sectionId}
                    className='min-w-0'
                    data-section-id={section.sectionId}
                  >
                    <Heading className='font-semibold tracking-tight wrap-anywhere'>
                      {section.title}
                    </Heading>
                    <ReadOnlySectionBody
                      projectSessionId={props.projectSessionId}
                      revisionId={revision.sectionRevisionId}
                      document={revision.content}
                    />
                  </section>
                )
              })}
            </article>
          ) : (
            <div className='flex min-h-full items-center justify-center text-muted-foreground'>
              <FileText className='mr-2 size-5' /> No manuscript content is available.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
