import type { MessagePortMain, UtilityProcess } from 'electron'
import type { Logger } from 'pino'
import type { LogCollector } from './log-collector'

export function attachUtilityLogPort(
  port: MessagePortMain,
  collector: LogCollector,
  log: Logger
): () => void {
  const onMessage = (event: Electron.MessageEvent): void => {
    try {
      const events = Array.isArray(event.data) ? event.data.slice(0, 50) : [event.data]
      for (const logEvent of events) collector.ingest(logEvent)
    } catch (err) {
      log.error({ event: 'worker.log_envelope.rejected', err }, 'Rejected utility log envelope')
    }
  }
  port.on('message', onMessage)
  port.start()
  return () => {
    port.off('message', onMessage)
    port.close()
  }
}

export function captureUtilityStderr(child: UtilityProcess, log: Logger): void {
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    const safeChunk = chunk
      .slice(0, 4_096)
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/(api[-_]?key|token|password|secret)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
      .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"']+/g, '[PRIVATE_PATH]')
    log.warn({ event: 'worker.stderr.received', characterCount: chunk.length }, safeChunk)
  })
}
