import { LoaderCircle } from 'lucide-react'

export function ProjectOpeningIndicator(): React.JSX.Element {
  return (
    <div
      className='absolute inset-0 z-40 flex items-center justify-center bg-background p-6'
      aria-busy='true'
    >
      <div
        className='flex max-w-sm flex-col items-center gap-4 text-center'
        role='status'
        aria-live='polite'
      >
        <LoaderCircle className='size-8 animate-spin text-primary' aria-hidden='true' />
        <div className='space-y-1'>
          <h1 className='text-lg font-semibold'>Opening project</h1>
          <p className='text-sm text-muted-foreground'>
            Larger projects may take a moment to load.
          </p>
        </div>
      </div>
    </div>
  )
}
