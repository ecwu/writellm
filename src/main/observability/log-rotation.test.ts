import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLoggerSystem } from './logger'

describe('pino-roll transport', () => {
  it('rotates NDJSON files by size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-rotation-'))
    const system = await createLoggerSystem({
      appVersion: 'test',
      logDirectory: directory,
      development: false,
      rotationSize: '1k',
      rotationFrequency: 'daily'
    })
    const log = system.createModuleLogger('app', 'rotation-test')
    for (let index = 0; index < 50; index += 1) {
      log.info(
        { event: 'app.rotation_test.entry', index, padding: 'x'.repeat(256) },
        'Rotation test'
      )
    }
    await system.flush()

    const deadline = Date.now() + 5_000
    let logs: string[] = []
    while (Date.now() < deadline) {
      logs = (await readdir(directory)).filter((name) => name.endsWith('.log'))
      if (logs.length > 1) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(logs.length).toBeGreaterThan(1)
  })
})
