import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'agent-model': resolve('src/workers/agent-model.ts'),
          'auxiliary-model': resolve('src/workers/auxiliary-model.ts'),
          'logging-fixture': resolve('src/main/observability/logging-fixture.ts'),
          'index-worker': resolve('src/workers/index-worker.ts'),
          mineru: resolve('src/workers/mineru.ts'),
          'provider-probe': resolve('src/workers/provider-probe.ts')
        }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['zod']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
