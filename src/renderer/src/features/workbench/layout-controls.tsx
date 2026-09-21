import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode
} from 'react'
import type { WorkbenchTool, WorkbenchContent } from '../../../../shared/contracts/workbench'

export type LayoutPage = Exclude<WorkbenchContent['kind'], 'section'>
export { layoutTools, layoutPages } from '../../../../shared/contracts/application-menu'
export interface LayoutControls {
  projectSessionId: string
  tools: WorkbenchTool[]
  pages: LayoutPage[]
  canCreateNotebook: boolean
  setTool(tool: WorkbenchTool, open: boolean): void
  setPage(page: LayoutPage, open: boolean): void
  newNotebook(): void
  reset(): void
}
const Context = createContext<{
  controls: LayoutControls | null
  setControls: Dispatch<SetStateAction<LayoutControls | null>>
} | null>(null)
export function LayoutControlsProvider({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<LayoutControls | null>(null)
  return <Context.Provider value={{ controls, setControls }}>{children}</Context.Provider>
}
export function useLayoutControls() {
  const context = useContext(Context)
  if (!context) throw new Error('Layout controls provider is missing')
  return context
}
