import { createHash } from 'node:crypto'

/**
 * Hash bytes in Main or a utility worker. This module is Node-only and must not be imported by
 * Renderer or shared contract code.
 */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
