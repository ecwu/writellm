import { useCallback, useEffect, useRef } from 'react'

export interface ProjectSessionOperation {
  projectSessionId: string | undefined
  generation: number
}

export type ProjectActionChange<Action extends string> =
  | { action: Action; token: symbol }
  | { action: null; token: symbol }

export function isCurrentProjectSessionOperation(
  operation: ProjectSessionOperation,
  currentSessionId: string | undefined,
  currentGeneration: number,
  mounted: boolean
): boolean {
  return (
    mounted &&
    operation.generation === currentGeneration &&
    operation.projectSessionId === currentSessionId
  )
}

/**
 * Invalidates renderer work when its project session changes or its owner unmounts.
 * A generation also separates overlapping requests for the same session.
 */
export function useProjectSessionGeneration(projectSessionId: string | undefined): {
  begin: () => ProjectSessionOperation
  isCurrent: (operation: ProjectSessionOperation) => boolean
} {
  const mountedRef = useRef(false)
  const currentSessionRef = useRef(projectSessionId)
  const generationRef = useRef(0)

  if (currentSessionRef.current !== projectSessionId) {
    currentSessionRef.current = projectSessionId
    generationRef.current += 1
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  const begin = useCallback((): ProjectSessionOperation => {
    generationRef.current += 1
    return { projectSessionId, generation: generationRef.current }
  }, [projectSessionId])

  const isCurrent = useCallback(
    (operation: ProjectSessionOperation): boolean =>
      isCurrentProjectSessionOperation(
        operation,
        currentSessionRef.current,
        generationRef.current,
        mountedRef.current
      ) && operation.projectSessionId === projectSessionId,
    [projectSessionId]
  )

  return { begin, isCurrent }
}
