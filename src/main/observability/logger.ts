import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import pino, { type DestinationStream, type Logger } from 'pino'
import type { Subsystem, ProcessRole, LogLevel } from '../../shared/observability/log-schema'
import { currentLogContext } from './log-context'
import { LogRingBuffer } from './log-ring-buffer'
import { RingBufferDestination } from './ring-buffer-destination'
import { redactLogValue } from './redact'

export interface LoggerOptions {
  appVersion: string
  logDirectory: string
  development: boolean
  sessionId?: string
  destination?: DestinationStream
  ringBufferCapacity?: number
  rotationSize?: string
  rotationFrequency?: string
}

export interface LoggerSystem {
  root: Logger
  ringBuffer: LogRingBuffer
  logDirectory: string
  activeFileName: string
  createModuleLogger(subsystem: Subsystem, component: string, processRole?: ProcessRole): Logger
  setSubsystemLevel(subsystem: Subsystem, level: LogLevel, durationMs: number): void
  flush(): Promise<void>
}

function serializeErrWithCause(err: Error): unknown {
  const serialized = pino.stdSerializers.errWithCause(err) as Record<string, unknown>
  if (serialized.cause === undefined && err.cause !== undefined) {
    serialized.cause = String(err.cause).slice(0, 4_096)
  }
  return serialized
}

export async function createLoggerSystem(options: LoggerOptions): Promise<LoggerSystem> {
  await mkdir(options.logDirectory, { recursive: true })
  const ringBuffer = new LogRingBuffer(options.ringBufferCapacity)
  const ringDestination = new RingBufferDestination(ringBuffer)
  const activeFileName = 'app.log'
  const fileDestination =
    options.destination ??
    pino.transport({
      target: 'pino-roll',
      options: {
        file: join(options.logDirectory, activeFileName),
        frequency: options.rotationFrequency ?? 'daily',
        size: options.rotationSize ?? '20m',
        mkdir: true
      }
    })

  const streams: { stream: DestinationStream }[] = [
    { stream: fileDestination },
    { stream: ringDestination }
  ]
  if (options.development && options.destination === undefined) {
    streams.push({
      stream: pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, destination: 1, sync: false }
      })
    })
  }
  const destination = pino.multistream(streams)
  const root = pino(
    {
      level: options.development ? 'debug' : 'info',
      base: {
        app: 'writellm',
        appVersion: options.appVersion,
        sessionId: options.sessionId ?? randomUUID(),
        pid: process.pid
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin: currentLogContext,
      serializers: {
        // errWithCause preserves the non-enumerable ES2022 `cause` chain for Error causes,
        // but drops primitive causes (worker-boundary errors carry the original provider
        // error as a string). Re-attach those, bounded, so provider diagnostics survive.
        err: (err) => redactLogValue(serializeErrWithCause(err))
      },
      redact: {
        paths: [
          'apiKey',
          'token',
          'accessToken',
          'refreshToken',
          'password',
          'cookie',
          'secret',
          'authorization',
          'headers.authorization',
          'headers.cookie',
          'credentials.apiKey'
        ],
        censor: '[REDACTED]'
      }
    },
    destination
  )

  const moduleLoggers = new Map<Subsystem, Set<Logger>>()
  const defaultLevel = root.level
  const timers = new Map<Subsystem, ReturnType<typeof setTimeout>>()
  const overrides = new Map<Subsystem, LogLevel>()

  return {
    root,
    ringBuffer,
    logDirectory: options.logDirectory,
    activeFileName,
    createModuleLogger(subsystem, component, processRole = 'main') {
      const logger = root.child({ subsystem, component, processRole })
      logger.level = overrides.get(subsystem) ?? defaultLevel
      const loggers = moduleLoggers.get(subsystem) ?? new Set<Logger>()
      loggers.add(logger)
      moduleLoggers.set(subsystem, loggers)
      return logger
    },
    setSubsystemLevel(subsystem, level, durationMs) {
      overrides.set(subsystem, level)
      for (const logger of moduleLoggers.get(subsystem) ?? []) logger.level = level
      const previousTimer = timers.get(subsystem)
      if (previousTimer !== undefined) clearTimeout(previousTimer)
      const timer = setTimeout(() => {
        overrides.delete(subsystem)
        for (const logger of moduleLoggers.get(subsystem) ?? []) logger.level = defaultLevel
        timers.delete(subsystem)
      }, durationMs)
      timer.unref()
      timers.set(subsystem, timer)
    },
    flush: () =>
      new Promise<void>((resolve, reject) => {
        root.flush((error) => (error ? reject(error) : resolve()))
      })
  }
}
