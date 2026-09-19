import { createContext, useContext } from 'react'
export const EmbeddedWorkspaceContext = createContext(false)
export function useEmbeddedWorkspace(): boolean {
  return useContext(EmbeddedWorkspaceContext)
}
