import { describe, expect, it } from 'vitest'
import { verifyInventoryPaths } from './package-inventory.mjs'

const completeInventory = new Set([
  'package.json',
  'out/main/index.js',
  'out/main/agent-worker.js',
  'out/main/background-worker.js',
  'out/main/index-worker.js',
  'out/main/logging-fixture.js',
  'out/preload/index.js',
  'out/renderer/index.html',
  'out/renderer/assets/index-fixture.js',
  'out/renderer/assets/pdf.worker.min-fixture.mjs',
  'node_modules/better-sqlite3/package.json',
  'node_modules/pino/package.json',
  'node_modules/pino-roll/package.json',
  'node_modules/thread-stream/package.json',
  'node_modules/@earendil-works/pi-ai/package.json',
  'node_modules/@ai-sdk/openai-compatible/package.json',
  'node_modules/@ai-sdk/cohere/package.json',
  'node_modules/@google/genai/package.json'
])

describe('package inventory', () => {
  it('accepts the complete runtime inventory', () => {
    expect(() => verifyInventoryPaths(completeInventory)).not.toThrow()
  })

  it('fails closed for missing workers, lazy dependencies, and source content', () => {
    const missingWorker = new Set(completeInventory)
    missingWorker.delete('out/main/agent-worker.js')
    expect(() => verifyInventoryPaths(missingWorker)).toThrow('agent-worker.js')

    const missingProvider = new Set(completeInventory)
    missingProvider.delete('node_modules/@google/genai/package.json')
    expect(() => verifyInventoryPaths(missingProvider)).toThrow('@google/genai')

    const sourceContent = new Set(completeInventory)
    sourceContent.add('src/main/index.ts')
    expect(() => verifyInventoryPaths(sourceContent)).toThrow('source-tree content')
  })
})
