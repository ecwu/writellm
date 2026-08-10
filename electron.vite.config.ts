import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']
      },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'agent-worker': resolve('src/workers/agent-model.ts'),
          'logging-fixture': resolve('src/main/observability/logging-fixture.ts'),
          'index-worker': resolve('src/workers/index-worker.ts'),
          'background-worker': resolve('src/workers/background-worker.ts')
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
