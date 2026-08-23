import { Settings2 } from 'lucide-react'
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

export function MediaMetadataPopover(props: {
  idPrefix: string
  title: string
  description: string
  triggerLabel: string
  caption: string
  altText: string
  onSave(value: { caption: string; altText: string }): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [caption, setCaption] = useState(props.caption)
  const [altText, setAltText] = useState(props.altText)

  useEffect(() => {
    if (open) return
    setCaption(props.caption)
    setAltText(props.altText)
  }, [open, props.altText, props.caption])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='secondary'
          size='icon-sm'
          aria-label={props.triggerLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
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
          <PopoverTitle>{props.title}</PopoverTitle>
          <PopoverDescription>{props.description}</PopoverDescription>
        </PopoverHeader>
        <div className='space-y-2'>
          <Label htmlFor={`${props.idPrefix}-caption`}>Caption</Label>
          <Input
            id={`${props.idPrefix}-caption`}
            value={caption}
            maxLength={2_000}
            onChange={(event) => setCaption(event.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${props.idPrefix}-alt`}>Alt text</Label>
          <Input
            id={`${props.idPrefix}-alt`}
            value={altText}
            maxLength={2_000}
            onChange={(event) => setAltText(event.target.value)}
          />
        </div>
        <Button
          type='button'
          className='w-full'
          onClick={() => {
            props.onSave({ caption, altText })
            setOpen(false)
          }}
        >
          Save metadata
        </Button>
      </PopoverContent>
    </Popover>
  )
}
