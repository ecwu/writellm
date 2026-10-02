import { resolve } from 'node:path'
import type { Plugin } from 'vite'

export function citationNetworkBoundary(): Plugin {
  return {
    name: 'writellm-citation-network-denial',
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        source === './fetchFile.js' &&
        importer?.replaceAll('\\', '/').includes('/@citation-js/core/lib-mjs/util/')
      ) {
        return resolve('src/workers/network-denied.ts')
      }
      return null
    }
  }
}
