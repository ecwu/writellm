import { Check } from 'lucide-react'
import { useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  MODELS_DEV_PROVIDER_LOGOS,
  type ModelsDevProviderLogoId
} from '../../../shared/models-dev-provider-logos'

const logoModules = import.meta.glob<string>('../assets/provider-logos/*.svg', {
  eager: true,
  import: 'default',
  query: '?url'
})
const logoUrls = new Map(
  Object.entries(logoModules).flatMap(([path, url]) => {
    const match = /\/([^/]+)\.svg$/.exec(path)
    return match?.[1] === undefined ? [] : [[match[1], url] as const]
  })
)
const logoMetadata = new Map<string, (typeof MODELS_DEV_PROVIDER_LOGOS)[number]>(
  MODELS_DEV_PROVIDER_LOGOS.map((provider) => [provider.id, provider])
)

export function ProviderLogo({
  logoId,
  name,
  size = 'default',
  className
}: {
  logoId: string | null
  name: string
  size?: 'sm' | 'default' | 'lg'
  className?: string
}): React.JSX.Element {
  const logoUrl = logoId === null ? undefined : logoUrls.get(logoId)
  const hasLogo = logoUrl !== undefined
  const maskImage = logoUrl === undefined ? undefined : `url(${JSON.stringify(logoUrl)})`
  const fallback = name.trim().slice(0, 1).toLocaleUpperCase() || '?'
  return (
    <Avatar
      size={size}
      className={className}
      aria-hidden='true'
      data-provider-logo-id={hasLogo ? logoId : 'fallback'}
      data-provider-logo-state={hasLogo ? 'glyph' : 'initial'}
    >
      <AvatarFallback>
        {!hasLogo ? (
          fallback
        ) : (
          <span
            data-slot='provider-logo-glyph'
            className='block size-2/3 shrink-0 bg-foreground'
            style={{
              WebkitMaskImage: maskImage,
              WebkitMaskPosition: 'center',
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskSize: 'contain',
              maskImage,
              maskPosition: 'center',
              maskRepeat: 'no-repeat',
              maskSize: 'contain'
            }}
          />
        )}
      </AvatarFallback>
    </Avatar>
  )
}

export function ProviderLogoPicker({
  value,
  automaticLogoId,
  disabled,
  onValueChange
}: {
  value: string | null
  automaticLogoId: string | null
  disabled?: boolean
  onValueChange: (value: ModelsDevProviderLogoId | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = value === null ? null : logoMetadata.get(value)
  const automatic = automaticLogoId === null ? null : logoMetadata.get(automaticLogoId)
  const triggerLabel =
    selected?.name ??
    (automatic == null ? 'Automatic · initial fallback' : `Automatic · ${automatic.name}`)

  const select = (next: ModelsDevProviderLogoId | null): void => {
    onValueChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          className='w-full min-w-0 justify-start'
          disabled={disabled}
          aria-label='Provider logo'
        >
          <ProviderLogo
            logoId={selected?.id ?? automatic?.id ?? null}
            name={selected?.name ?? automatic?.name ?? 'Provider'}
            size='sm'
          />
          <span className='truncate'>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 max-w-[calc(100vw-2rem)] p-0'>
        <Command>
          <CommandInput placeholder='Search Provider logos…' />
          <CommandList>
            <CommandEmpty>No Provider logos found.</CommandEmpty>
            <CommandGroup heading='Selection'>
              <CommandItem value='automatic provider logo' onSelect={() => select(null)}>
                <ProviderLogo
                  logoId={automatic?.id ?? null}
                  name={automatic?.name ?? 'Automatic'}
                  size='sm'
                />
                <span className='min-w-0 flex-1 truncate'>Automatic</span>
                {value === null ? <Check /> : null}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading='models.dev Providers'>
              {MODELS_DEV_PROVIDER_LOGOS.map((provider) => (
                <CommandItem
                  key={provider.id}
                  value={`${provider.name} ${provider.id}`}
                  onSelect={() => select(provider.id)}
                >
                  <ProviderLogo logoId={provider.id} name={provider.name} size='sm' />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{provider.name}</span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {provider.id}
                    </span>
                  </span>
                  {value === provider.id ? <Check /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function providerLogoAssetUrl(logoId: string): string | null {
  return logoUrls.get(logoId) ?? null
}
