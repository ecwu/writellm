import { defaultBlockSpecs, imageParse } from '@blocknote/core'
import {
  createReactBlockSpec,
  ResizableFileBlockWrapper,
  type ReactCustomBlockRenderProps
} from '@blocknote/react'
import { ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MediaMetadataPopover } from './media-metadata-popover'

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
          <MediaMetadataPopover
            idPrefix={`figure-${props.block.id}`}
            title='Figure metadata'
            description='Caption is visible to readers. Alt text describes the image for accessibility.'
            triggerLabel='Edit figure metadata'
            caption={props.block.props.caption}
            altText={props.block.props.altText}
            onSave={(metadata) => props.editor.updateBlock(props.block, { props: metadata })}
          />
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
