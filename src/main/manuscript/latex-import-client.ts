import { randomUUID } from 'node:crypto'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { Logger } from 'pino'
import {
  LATEX_IMPORT_TIMEOUT_MS,
  latexImportWorkerErrorSchema,
  latexImportWorkerRequestSchema,
  latexImportWorkerResultSchema,
  type LatexImportWorkerResult
} from '../../shared/contracts/latex-import'

export interface LatexImportProcessFactory {
  fork(modulePath: string, args?: string[], options?: Electron.ForkOptions): UtilityProcess
}

export class LatexImportClient {
  readonly #children = new Set<UtilityProcess>()

  constructor(
    private readonly options: {
      modulePath: string
      log: Pick<Logger, 'info' | 'error'>
      factory?: LatexImportProcessFactory
      timeoutMs?: number
    }
  ) {}

  parse(input: {
    source: string
    sourceHash: string
    project?: {
      entryRelativePath: string
      textFiles: Array<{ relativePath: string; kind: 'tex' | 'bib'; source: string }>
      assetPaths: string[]
    } | null
    signal?: AbortSignal
  }): Promise<LatexImportWorkerResult> {
    input.signal?.throwIfAborted()
    const request = latexImportWorkerRequestSchema.parse({
      type: 'latex-import-parse',
      requestId: randomUUID(),
      sourceHash: input.sourceHash,
      source: input.source,
      project: input.project ?? null
    })
    const child = (this.options.factory ?? utilityProcess).fork(this.options.modulePath, [], {
      serviceName: 'writellm-latex-import',
      stdio: 'ignore'
    })
    this.#children.add(child)
    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', onAbort)
        child.removeListener('message', onMessage)
        child.removeListener('exit', onExit)
        this.#children.delete(child)
        child.kill()
        operation()
      }
      const fail = (err: Error, event: string): void =>
        finish(() => {
          this.options.log.error(
            {
              event,
              err,
              requestId: request.requestId,
              sourceHash: request.sourceHash,
              durationMs: Date.now() - startedAt
            },
            'LaTeX import utility request failed'
          )
          reject(err)
        })
      const onAbort = (): void => {
        const err = new Error('LaTeX import parsing was cancelled', { cause: input.signal?.reason })
        err.name = 'AbortError'
        fail(err, 'manuscript.import.latex.cancelled')
      }
      const onExit = (code: number): void => {
        fail(
          new Error(`LaTeX import utility exited before responding (${code})`),
          'manuscript.import.latex.worker_exited'
        )
      }
      const onMessage = (raw: unknown): void => {
        const result = latexImportWorkerResultSchema.safeParse(raw)
        if (result.success && result.data.requestId === request.requestId) {
          finish(() => {
            this.options.log.info(
              {
                event: 'manuscript.import.latex.parsed',
                requestId: request.requestId,
                sourceHash: request.sourceHash,
                sectionCount: result.data.sections.length,
                blockCount: result.data.sections.reduce(
                  (total, section) => total + section.nodes.length,
                  0
                ),
                warningCount: result.data.warnings.length,
                unsupportedCount: result.data.unsupported.length,
                lossCount: result.data.losses.length,
                durationMs: Date.now() - startedAt
              },
              'LaTeX import parsed in isolated utility process'
            )
            resolve(result.data)
          })
          return
        }
        const error = latexImportWorkerErrorSchema.safeParse(raw)
        if (error.success && error.data.requestId === request.requestId) {
          fail(new Error(error.data.error.message), 'manuscript.import.latex.parser_failed')
          return
        }
        fail(
          result.success ? new Error('LaTeX import response request ID mismatch') : result.error,
          'manuscript.import.latex.response_invalid'
        )
      }
      const timer = setTimeout(() => {
        const err = new Error('LaTeX import parser exceeded the 5 second limit')
        err.name = 'TimeoutError'
        fail(err, 'manuscript.import.latex.timeout')
      }, this.options.timeoutMs ?? LATEX_IMPORT_TIMEOUT_MS)
      child.on('message', onMessage)
      child.once('exit', onExit)
      input.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        child.postMessage(request)
      } catch (err) {
        fail(
          new Error('LaTeX import utility could not be started', { cause: err }),
          'manuscript.import.latex.start_failed'
        )
      }
    })
  }

  terminateAll(): void {
    for (const child of this.#children) child.kill()
    this.#children.clear()
  }
}
