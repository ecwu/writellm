import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { citationNetworkBoundary } from './citation-network-boundary'

describe('bundled Citation.js network boundary', () => {
  it('parses local BibTeX and denies both remote parsing APIs before network access', async () => {
    const entry = resolve('.cache/citation-network-probe.js')
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [
        citationNetworkBoundary(),
        {
          name: 'citation-network-probe',
          resolveId: (source) => (source === entry ? entry : null),
          load: (id) =>
            id === entry
              ? `import { Cite, util, plugins } from '@citation-js/core'
                 import '@citation-js/plugin-bibtex'
                 import '@citation-js/plugin-csl'
                 export const parse = () => new Cite('@article{local,title={Local bibliography}}').data
                 export const hasCsl = () => plugins.config.get('@csl') !== undefined
                 export const bibliography = () => new Cite('@article{local,title={Local bibliography}}').format('bibliography', {format: 'text', style: 'apa'})
                 export const fetchFile = util.fetchFile
                 export const fetchFileAsync = util.fetchFileAsync`
              : null
        }
      ],
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['cjs'], fileName: 'citation-network-probe' }
      }
    })
    if (!Array.isArray(result)) throw new Error('Expected library build output')
    const chunk = result[0]?.output.find((item) => item.type === 'chunk')
    if (chunk?.type !== 'chunk') throw new Error('Citation network probe chunk missing')
    expect(chunk.code).not.toContain('sync-fetch-undici')
    const module = { exports: {} }
    const evaluate = new Function('require', 'module', 'exports', chunk.code)
    evaluate(createRequire(import.meta.url), module, module.exports)
    const probe = module.exports as {
      parse(): unknown[]
      hasCsl(): boolean
      bibliography(): string
      fetchFile(url: string): unknown
      fetchFileAsync(url: string): Promise<unknown>
    }
    const fetch = vi.spyOn(globalThis, 'fetch')
    try {
      expect(probe.parse()).toEqual([
        expect.objectContaining({ title: 'Local bibliography', 'citation-key': 'local' })
      ])
      expect(probe.hasCsl()).toBe(true)
      expect(probe.bibliography()).toContain('Local bibliography')
      const url = 'http://127.0.0.1:1/blocked'
      const message = 'Network access is unavailable in the LaTeX import worker'
      expect(() => probe.fetchFile(url)).toThrow(message)
      await expect(probe.fetchFileAsync(url)).rejects.toThrow(message)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
})
