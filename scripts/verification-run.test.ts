import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StageFailure, VerificationRun } from './verification-run.mjs'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function recorder() {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-verification-'))
  roots.push(directory)
  return new VerificationRun('focused-test', { directory })
}

describe('verification stage execution', () => {
  it('preserves command failure when writing its report also fails', async () => {
    const run = await recorder()
    const previousExitCode = process.exitCode
    run.save = vi.fn().mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
    try {
      let failure: unknown
      try {
        await run.command('original-failure', process.execPath, ['-e', 'process.exit(7)'])
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ exitCode: 7 })
      await run.finish(failure)
      expect(process.exitCode).toBe(7)
    } finally {
      process.exitCode = previousExitCode
      for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
    }
  })

  it('reports interruption between the last stage and finalization', async () => {
    const run = await recorder()
    const previousExitCode = process.exitCode
    try {
      await run.stage('completed', async () => {})
      run.handlers.get('SIGTERM')()
      await run.finish()
      expect(process.exitCode).toBe(143)
      const report = JSON.parse(
        await readFile(join(run.directory, (await readdir(run.directory))[0]), 'utf8')
      )
      expect(report.status).toBe('interrupted')
    } finally {
      process.exitCode = previousExitCode
      for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
    }
  })

  it('reports output overflow as a failure rather than a user interruption', async () => {
    const run = await recorder()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await expect(
        run.command(
          'overflow',
          process.execPath,
          ['-e', 'process.stdout.write("x".repeat(17 * 1024 * 1024))'],
          {
            capture: true
          }
        )
      ).rejects.toMatchObject({
        exitCode: 1,
        signal: null,
        cause: { code: 'ERR_VERIFICATION_OUTPUT_LIMIT' }
      })
      expect(run.stages[0].status).toBe('failed')
    } finally {
      output.mockRestore()
      for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
    }
  })

  it('forwards literal arguments and environment and writes elapsed stage evidence', async () => {
    const run = await recorder()
    try {
      const output = await run.command(
        'literal',
        process.execPath,
        [
          '-e',
          'process.stdout.write(JSON.stringify([process.argv[1],process.env.TEST_VALUE]))',
          'a b; $(echo nope)'
        ],
        { capture: true, env: { TEST_VALUE: 'expected' } }
      )
      expect(JSON.parse(output)).toEqual(['a b; $(echo nope)', 'expected'])
      await run.finish()
      const report = JSON.parse(
        await readFile(join(run.directory, (await readdir(run.directory))[0]), 'utf8')
      )
      expect(report).toMatchObject({
        status: 'passed',
        scope: 'focused-test',
        stages: [{ name: 'literal', status: 'passed', exitCode: 0 }]
      })
      expect(report.stages[0].durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
    }
  })

  it('propagates command failure and never executes subsequent stages', async () => {
    const run = await recorder()
    try {
      await expect(
        (async () => {
          await run.command('fails', process.execPath, ['-e', 'process.exit(7)'])
          await run.command('unreachable', process.execPath, ['-e', 'process.exit(0)'])
        })()
      ).rejects.toMatchObject({ exitCode: 7 })
      expect(run.stages.map((stage) => stage.name)).toEqual(['fails'])
      expect(run.stages[0].status).toBe('failed')
      await run.save('failed')
    } finally {
      for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
    }
  })

  it.skipIf(process.platform === 'win32')(
    'records signal termination as interruption',
    async () => {
      const run = await recorder()
      try {
        await expect(
          run.command('signal', process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"])
        ).rejects.toMatchObject({ signal: 'SIGTERM' })
        expect(run.stages[0]).toMatchObject({ status: 'interrupted', signal: 'SIGTERM' })
      } finally {
        for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'forwards interruption and writes a terminal report',
    async () => {
      const run = await recorder()
      for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
      const source = `
      import { VerificationRun } from ${JSON.stringify(new URL('./verification-run.mjs', import.meta.url).href)};
      const run = new VerificationRun('interrupt-fixture', { directory: ${JSON.stringify(run.directory)} });
      let failure;
      try { await run.command('waiting-child', process.execPath, ['-e', 'process.stdout.write("CHILD_READY"); setInterval(() => {}, 1000)']); }
      catch (error) { failure = error; }
      finally { await run.finish(failure); }
    `
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let interrupted = false
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
        if (!interrupted && output.includes('CHILD_READY')) {
          interrupted = true
          child.kill('SIGTERM')
        }
      })
      child.stderr.resume()
      const result = await new Promise((resolveResult, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolveResult({ code, signal }))
      })
      expect(result).toEqual({ code: 143, signal: null })
      const report = JSON.parse(
        await readFile(join(run.directory, (await readdir(run.directory))[0]), 'utf8')
      )
      expect(report).toMatchObject({
        status: 'interrupted',
        stages: [{ name: 'waiting-child', signal: 'SIGTERM' }]
      })
    }
  )

  it('retains the original spawn error and rejects already interrupted runs', async () => {
    const run = await recorder()
    try {
      await expect(
        run.command('missing', join(run.directory, 'missing-command'), [])
      ).rejects.toMatchObject({ cause: { code: 'ENOENT' } })
      run.interrupted = 'SIGINT'
      await expect(run.command('after-interrupt', process.execPath, [])).rejects.toBeInstanceOf(
        StageFailure
      )
      expect(run.stages).toHaveLength(1)
    } finally {
      for (const [signal, handler] of run.handlers) process.removeListener(signal, handler)
    }
  })
})
