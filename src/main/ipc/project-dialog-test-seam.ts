import type { Logger } from 'pino'

export const E2E_PROJECT_DIALOG_PATHS_ENV = 'WRITELLM_E2E_PROJECT_DIALOG_PATHS'

export function createProjectDialogTestSelection(
  logger: Pick<Logger, 'info' | 'error'>
): (() => Promise<string | null>) | undefined {
  const serializedPaths = process.env[E2E_PROJECT_DIALOG_PATHS_ENV]
  if (serializedPaths === undefined) return undefined

  try {
    const value: unknown = JSON.parse(serializedPaths)
    if (!Array.isArray(value) || !value.every((path) => typeof path === 'string' && path !== '')) {
      throw new TypeError(`${E2E_PROJECT_DIALOG_PATHS_ENV} must be a JSON array of paths`)
    }

    const paths = [...value]
    logger.info(
      { event: 'ipc.project_dialog_test_seam.enabled', selectionCount: paths.length },
      'Enabled Main-owned project dialog E2E selection seam'
    )
    return async () => paths.shift() ?? null
  } catch (err) {
    logger.error(
      { event: 'ipc.project_dialog_test_seam.invalid', err },
      'Invalid project dialog E2E selection configuration'
    )
    throw err
  }
}
