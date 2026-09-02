import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { Collapsible } from '@/components/ui/collapsible'

type DisclosureState = {
  choices: ReadonlyMap<string, boolean>
  choose(id: string, open: boolean): void
}
const DisclosureContext = createContext<DisclosureState | null>(null)

export function AgentDisclosureProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  return (
    <DisclosureContext.Provider
      value={{
        choices,
        choose: (id, open) => setChoices((current) => new Map(current).set(id, open))
      }}
    >
      {children}
    </DisclosureContext.Provider>
  )
}

export function AgentDisclosure({
  disclosureId,
  defaultOpen = false,
  ...props
}: Omit<ComponentProps<typeof Collapsible>, 'open' | 'onOpenChange'> & {
  disclosureId: string
}): React.JSX.Element {
  const shared = useContext(DisclosureContext)
  const [localChoice, setLocalChoice] = useState<boolean>()
  return (
    <Collapsible
      {...props}
      open={
        shared ? (shared.choices.get(disclosureId) ?? defaultOpen) : (localChoice ?? defaultOpen)
      }
      onOpenChange={(open) => (shared ? shared.choose(disclosureId, open) : setLocalChoice(open))}
    />
  )
}
