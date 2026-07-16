import type { Logger } from 'pino'

export const E2E_KNOWLEDGE_DIALOG_PATHS_ENV = 'WRITELLM_E2E_KNOWLEDGE_DIALOG_PATHS'

export function createKnowledgeDialogTestSelection(
  logger: Pick<Logger, 'info' | 'error'>
): (() => Promise<string[]>) | undefined {
  const serializedPaths = process.env[E2E_KNOWLEDGE_DIALOG_PATHS_ENV]
  if (serializedPaths === undefined) return undefined
  try {
    const value: unknown = JSON.parse(serializedPaths)
    if (!Array.isArray(value) || !value.every((path) => typeof path === 'string' && path !== '')) {
      throw new TypeError(`${E2E_KNOWLEDGE_DIALOG_PATHS_ENV} must be a JSON array of paths`)
    }
    let consumed = false
    logger.info(
      { event: 'ipc.knowledge_dialog_test_seam.enabled', selectionCount: value.length },
      'Enabled Main-owned knowledge dialog E2E selection seam'
    )
    return async () => {
      if (consumed) return []
      consumed = true
      return [...value]
    }
  } catch (err) {
    logger.error(
      { event: 'ipc.knowledge_dialog_test_seam.invalid', err },
      'Invalid knowledge dialog E2E selection configuration'
    )
    throw err
  }
}
