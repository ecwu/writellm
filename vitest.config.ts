import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const usesHostedWindows = process.platform === 'win32' && Boolean(process.env['CI'])

export default defineConfig({
  ssr: {
    noExternal: ['@blocknote/math-block']
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'out/**'],
    testTimeout: usesHostedWindows ? 30_000 : 5_000
  }
})
