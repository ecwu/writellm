import { defaultBlockSpecs, imageParse } from '@blocknote/core'
import {
  createReactBlockSpec,
  ResizableFileBlockWrapper,
  type ReactCustomBlockRenderProps
} from '@blocknote/react'
import { ImageIcon, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'

const figureImageConfig = {
  ...defaultBlockSpecs.image.config,
  propSchema: {
    ...defaultBlockSpecs.image.config.propSchema,
    figureId: { default: '' },
    altText: { default: '' }
  }
} as const

type FigureImageRenderProps = ReactCustomBlockRenderProps<typeof figureImageConfig>

function FigureImageBlock(props: FigureImageRenderProps): React.JSX.Element {
  const [resolvedUrl, setResolvedUrl] = useState<string>()
  const [open, setOpen] = useState(false)
  const [caption, setCaption] = useState(props.block.props.caption)
  const [altText, setAltText] = useState(props.block.props.altText)

  useEffect(() => {
    if (open) return
    setCaption(props.block.props.caption)
    setAltText(props.block.props.altText)
  }, [open, props.block.props.altText, props.block.props.caption])

  useEffect(() => {
    let active = true
    const resolve = props.editor.resolveFileUrl
    const resolution = resolve
      ? resolve(props.block.props.url)
      : Promise.resolve(props.block.props.url)
    void resolution.then(
      (url) => {
        if (active && url !== '') setResolvedUrl(url)
      },
      (error: unknown) => {
        if (!active) return
        queueMicrotask(() => {
          throw error
        })
      }
    )
    return () => {
      active = false
    }
  }, [props.block.props.url, props.editor])

  return (
    <ResizableFileBlockWrapper
      {...(props as unknown as Parameters<typeof ResizableFileBlockWrapper>[0])}
      buttonIcon={<ImageIcon className='size-5' />}
    >
      <img
        className='bn-visual-media'
        src={resolvedUrl}
        alt={props.block.props.altText || props.block.props.caption || 'Figure'}
        contentEditable={false}
        draggable={false}
      />
      {props.editor.isEditable ? (
        <div className='absolute right-2 top-2'>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type='button'
                variant='secondary'
                size='icon-sm'
                aria-label='Edit figure metadata'
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Settings2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align='end'
              className='w-80 space-y-4'
              onPointerDown={(event) => event.stopPropagation()}
            >
              <PopoverHeader>
                <PopoverTitle>Figure metadata</PopoverTitle>
                <PopoverDescription>
                  Caption is visible to readers. Alt text describes the image for accessibility.
                </PopoverDescription>
              </PopoverHeader>
              <div className='space-y-2'>
                <Label htmlFor={`figure-caption-${props.block.id}`}>Caption</Label>
                <Input
                  id={`figure-caption-${props.block.id}`}
                  value={caption}
                  maxLength={2_000}
                  onChange={(event) => setCaption(event.target.value)}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor={`figure-alt-${props.block.id}`}>Alt text</Label>
                <Input
                  id={`figure-alt-${props.block.id}`}
                  value={altText}
                  maxLength={2_000}
                  onChange={(event) => setAltText(event.target.value)}
                />
              </div>
              <Button
                type='button'
                className='w-full'
                onClick={() => {
                  props.editor.updateBlock(props.block, { props: { caption, altText } })
                  setOpen(false)
                }}
              >
                Save metadata
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
    </ResizableFileBlockWrapper>
  )
}

function FigureImageExternalHtml(props: FigureImageRenderProps): React.JSX.Element {
  if (!props.block.props.url) return <p>Add image</p>
  const image = (
    <img
      src={props.block.props.url}
      alt={props.block.props.altText}
      width={props.block.props.previewWidth}
    />
  )
  if (!props.block.props.caption) return image
  return (
    <figure data-figure-id={props.block.props.figureId || undefined}>
      {image}
      <figcaption>{props.block.props.caption}</figcaption>
    </figure>
  )
}

export const figureImageBlockSpec = createReactBlockSpec(figureImageConfig, {
  meta: { fileBlockAccept: ['image/*'] },
  render: FigureImageBlock,
  parse: (element) => {
    const parsed = imageParse()(element)
    if (parsed === undefined) return undefined
    const image =
      element.tagName === 'IMG'
        ? (element as HTMLImageElement)
        : element.querySelector<HTMLImageElement>('img')
    return {
      ...parsed,
      figureId: element.dataset.figureId ?? '',
      altText: image?.getAttribute('alt') ?? ''
    }
  },
  toExternalHTML: FigureImageExternalHtml,
  runsBefore: ['file']
})()
