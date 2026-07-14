import { Bot, Braces, FileArchive, FolderOpen, KeyRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command'

interface SettingsCommandProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenLogs: () => void
  onExportDiagnostics: () => void
}

export function SettingsCommand({
  open,
  onOpenChange,
  onOpenLogs,
  onExportDiagnostics
}: SettingsCommandProps): React.JSX.Element {
  const select = (action: () => void): void => {
    action()
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Settings'
      description='Provider configuration and application diagnostics'
      className='sm:max-w-xl'
    >
      <CommandInput placeholder='Search settings and diagnostics…' />
      <CommandList>
        <CommandEmpty>No settings found.</CommandEmpty>
        <CommandGroup heading='API configuration'>
          <CommandItem disabled keywords={['provider', 'model', 'api']}>
            <Bot /> Agent model provider
            <CommandShortcut>
              <Badge variant='secondary'>Not configured</Badge>
            </CommandShortcut>
          </CommandItem>
          <CommandItem disabled keywords={['embedding', 'reranking', 'api']}>
            <Braces /> Embedding and reranking
            <CommandShortcut>
              <Badge variant='secondary'>Not configured</Badge>
            </CommandShortcut>
          </CommandItem>
          <CommandItem disabled keywords={['mineru', 'parser', 'api']}>
            <KeyRound /> MinerU parser
            <CommandShortcut>
              <Badge variant='secondary'>Not configured</Badge>
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading='Diagnostics'>
          <CommandItem onSelect={() => select(onOpenLogs)}>
            <FolderOpen /> Open logs folder
          </CommandItem>
          <CommandItem onSelect={() => select(onExportDiagnostics)}>
            <FileArchive /> Export diagnostics bundle
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
