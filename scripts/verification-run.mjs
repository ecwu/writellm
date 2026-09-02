import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { inspect } from 'node:util'

export class StageFailure extends Error {
  constructor(stage, { exitCode = 1, signal = null, cause } = {}) {
    super(`Verification stage ${stage} failed${signal ? ` (${signal})` : ` (exit ${exitCode})`}`, {
      cause
    })
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0 && exitCode <= 255 ? exitCode : 1
    this.signal = signal
  }
}

/** Small sequential command recorder shared by build and verification entrypoints. */
export class VerificationRun {
  constructor(scope, { directory, heartbeatMs = 30_000, selection = [] } = {}) {
    this.id = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`
    this.scope = scope
    this.selection = selection
    this.directory = resolve(
      directory ??
        process.env.WRITELLM_VERIFICATION_DIRECTORY ??
        join('.cache/verification', this.id)
    )
    this.env = { ...process.env, WRITELLM_VERIFICATION_DIRECTORY: this.directory }
    this.startedAt = new Date().toISOString()
    this.started = performance.now()
    this.heartbeatMs = heartbeatMs
    this.stages = []
    this.interrupted = null
    this.handlers = new Map(
      ['SIGINT', 'SIGTERM'].map((signal) => [
        signal,
        () => {
          this.interrupted = signal
          this.stopChild?.(signal)
        }
      ])
    )
    for (const [signal, handler] of this.handlers) process.on(signal, handler)
  }

  async stage(name, operation) {
    if (this.interrupted) throw new StageFailure(name, { signal: this.interrupted })
    const record = { name, scope: this.scope, startedAt: new Date().toISOString() }
    const started = performance.now()
    let failure
    let result
    process.stdout.write(`[verify] ${name}: started\n`)
    const heartbeat = setInterval(() => {
      process.stdout.write(
        `[verify] ${name}: running ${formatDuration(performance.now() - started)}\n`
      )
    }, this.heartbeatMs)
    try {
      result = await operation()
      if (this.interrupted) throw new StageFailure(name, { signal: this.interrupted })
      Object.assign(record, { status: 'passed', exitCode: 0, signal: null })
    } catch (error) {
      failure = error
      process.stderr.write(`${inspect(error)}\n`)
      Object.assign(record, {
        status: error.signal ? 'interrupted' : 'failed',
        exitCode: error.exitCode ?? 1,
        signal: error.signal ?? null,
        errorCode: error.cause?.code ?? error.code ?? error.name
      })
    } finally {
      clearInterval(heartbeat)
      record.durationMs = Math.round(performance.now() - started)
      this.stages.push(record)
      process.stdout.write(
        `[verify] ${name}: ${record.status} (${formatDuration(record.durationMs)})\n`
      )
    }
    try {
      await this.save()
    } catch (reportError) {
      process.stderr.write(`${inspect(reportError)}\n`)
      // Reporting must not replace the original command failure or exit code.
      failure ??= reportError
    }
    if (failure) throw failure
    return result
  }

  command(name, executable, args, { env = {}, capture = false } = {}) {
    return this.stage(
      name,
      () =>
        new Promise((resolveCommand, reject) => {
          const child = spawn(executable, args, {
            env: { ...this.env, ...env },
            detached: process.platform !== 'win32',
            stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit']
          })
          let output = ''
          let spawnError
          let killTimer
          let overflow = false
          const stop = (signal) => {
            if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
              return
            try {
              if (process.platform === 'win32') {
                const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                  encoding: 'utf8'
                })
                if (result.error) throw result.error
              } else process.kill(-child.pid, signal)
            } catch (error) {
              if (error.code !== 'ESRCH') process.stderr.write(`${inspect(error)}\n`)
            }
            if (signal !== 'SIGKILL' && !killTimer) {
              killTimer = setTimeout(() => stop('SIGKILL'), 5_000)
            }
          }
          this.stopChild = stop
          child.stdout?.setEncoding('utf8')
          child.stdout?.on('data', (chunk) => {
            process.stdout.write(chunk)
            if (!overflow) output += chunk.toString()
            if (Buffer.byteLength(output) > 16 * 1_024 * 1_024) {
              overflow = true
              stop('SIGTERM')
            }
          })
          child.once('error', (error) => {
            spawnError = error
          })
          child.once('close', (exitCode, signal) => {
            clearTimeout(killTimer)
            this.stopChild = undefined
            if (spawnError || overflow || signal || exitCode !== 0 || this.interrupted) {
              reject(
                new StageFailure(name, {
                  exitCode: overflow ? 1 : (exitCode ?? 1),
                  signal: this.interrupted ?? (overflow ? null : signal),
                  cause:
                    spawnError ??
                    (overflow
                      ? Object.assign(new Error('Command output exceeded 16 MiB'), {
                          code: 'ERR_VERIFICATION_OUTPUT_LIMIT'
                        })
                      : undefined)
                })
              )
            } else resolveCommand(output)
          })
        })
    )
  }

  async save(status = 'running') {
    await mkdir(this.directory, { recursive: true })
    await writeFile(
      join(this.directory, `stages-${this.id}.json`),
      `${JSON.stringify(
        {
          format: 'writellm-verification',
          version: 1,
          scope: this.scope,
          selection: this.selection,
          startedAt: this.startedAt,
          durationMs: Math.round(performance.now() - this.started),
          status,
          stages: this.stages
        },
        null,
        2
      )}\n`
    )
  }

  async finish(error) {
    const interruption = () => new StageFailure(this.scope, { signal: this.interrupted })
    error ??= this.interrupted ? interruption() : undefined
    const persist = async () => {
      try {
        await this.save(error ? (error.signal ? 'interrupted' : 'failed') : 'passed')
      } catch (reportError) {
        process.stderr.write(`${inspect(reportError)}\n`)
        error ??= reportError
      }
    }
    await persist()
    // A signal can arrive between the last command and the final report write.
    if (!error && this.interrupted) {
      error = interruption()
      await persist()
    }
    for (const [signal, handler] of this.handlers) process.removeListener(signal, handler)
    const status = error ? (error.signal ? 'interrupted' : 'failed') : 'passed'
    process.stdout.write(
      `[verify] ${this.scope}: ${status} in ${formatDuration(performance.now() - this.started)}; ${this.stages.length} stages; reports ${this.directory}\n`
    )
    if (error) {
      process.stderr.write(`${inspect(error)}\n`)
      process.exitCode =
        error.signal === 'SIGINT' ? 130 : error.signal === 'SIGTERM' ? 143 : error.exitCode || 1
    }
  }
}

export function formatDuration(ms) {
  return `${(ms / 1_000).toFixed(1)}s`
}
