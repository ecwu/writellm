import {
  auxiliaryUtilityRequestSchema,
  utilityCancelMessageSchema,
  type AuxiliaryUtilityResponse
} from '../shared/contracts/model-runtime'
import {
  providerProbeRequestSchema,
  type ProviderProbeResponse
} from '../shared/contracts/provider-probe'
import { mineruUtilityRequestSchema, type MineruUtilityResponse } from '../shared/contracts/mineru'
import { runAuxiliaryModelRequest } from './auxiliary-model-request'
import { MineruRequestError, runMineruRequest } from './mineru-request'
import { assertPublicHttpsOrLoopbackTestUrl } from './outbound-http'
import { runProviderProbeRequest } from './provider-probe-request'
import {
  modelsDevResolveRequestSchema,
  type ModelsDevResolveResponse
} from '../shared/contracts/model-catalog'
import { runModelsDevRequest } from './models-dev-request'
import { withLogContext } from '../main/observability/log-context'
import { createPortLogger } from './shared/port-logger'
import {
  extractUtilityProjectSessionId as extractProjectSessionId,
  extractUtilityRequestId as extractRequestId,
  findUtilityHttpStatus as findHttpStatus,
  safeUtilityStack as safeStack
} from './shared/utility-message'
import {
  latexImportWorkerErrorSchema,
  latexImportWorkerRequestSchema
} from '../shared/contracts/latex-import'
import { parseLatexImport } from './latex-import-parser'

const parentPort = process.parentPort
if (parentPort === undefined) throw new Error('Background worker requires an Electron parent port')
const allowLoopbackArtifactTestPolicy = process.argv.includes('--writellm-test-artifact-loopback')

const activeRequests = new Map<
  string,
  { projectSessionId: string | null | undefined; controller: AbortController }
>()
let workerLog: ReturnType<typeof createPortLogger> | undefined

parentPort.on('message', (event) => {
  if (isLoggingPortMessage(event)) {
    workerLog = createPortLogger(event.ports[0], {
      processRole: 'background-worker',
      subsystem: 'worker',
      component: 'background'
    })
    event.ports[0].start()
    return
  }
  const cancel = utilityCancelMessageSchema.safeParse(event.data)
  if (cancel.success) {
    const active = activeRequests.get(cancel.data.requestId)
    if (
      active !== undefined &&
      (active.projectSessionId ?? null) === (cancel.data.projectSessionId ?? null)
    ) {
      active.controller.abort(new Error('Background utility request cancelled'))
    }
    return
  }
  const sessionId = extractProjectSessionId(event.data)
  void withLogContext(
    {
      requestId: extractRequestId(event.data),
      ...(sessionId === null ? {} : { projectSessionId: sessionId })
    },
    () => dispatch(event.data)
  )
})

async function dispatch(value: unknown): Promise<void> {
  const latexImport = latexImportWorkerRequestSchema.safeParse(value)
  if (latexImport.success) {
    const startedAt = Date.now()
    try {
      const result = parseLatexImport(latexImport.data)
      workerLog?.(
        'info',
        'worker.background.latex_import_parsed',
        'LaTeX import parsing completed',
        {
          sourceHash: result.sourceHash,
          sectionCount: result.sections.length,
          blockCount: result.sections.reduce((total, section) => total + section.nodes.length, 0),
          warningCount: result.warnings.length,
          unsupportedCount: result.unsupported.length,
          lossCount: result.losses.length,
          durationMs: Date.now() - startedAt
        }
      )
      post(result)
    } catch (err) {
      workerLog?.(
        'error',
        'worker.background.latex_import_failed',
        'LaTeX import parsing failed',
        { sourceHash: latexImport.data.sourceHash, durationMs: Date.now() - startedAt },
        err
      )
      post(
        latexImportWorkerErrorSchema.parse({
          type: 'latex-import-error',
          requestId: latexImport.data.requestId,
          error: {
            name: err instanceof Error ? err.name.slice(0, 100) : 'Error',
            message: err instanceof Error ? err.message.slice(0, 1_000) : 'LaTeX parsing failed'
          }
        })
      )
    }
    return
  }

  const modelsDev = modelsDevResolveRequestSchema.safeParse(value)
  if (modelsDev.success) {
    const controller = new AbortController()
    activeRequests.set(modelsDev.data.requestId, { projectSessionId: null, controller })
    try {
      post(await runModelsDevRequest(modelsDev.data, fetch, controller.signal))
    } catch (err) {
      workerLog?.(
        'error',
        'worker.background.models_dev_failed',
        'models.dev metadata refresh failed',
        undefined,
        err
      )
      post({
        type: 'models-dev-error',
        requestId: modelsDev.data.requestId,
        error: serializeModelError(err, 'models.dev metadata refresh failed')
      } satisfies ModelsDevResolveResponse)
    } finally {
      activeRequests.delete(modelsDev.data.requestId)
    }
    return
  }

  const mineru = mineruUtilityRequestSchema.safeParse(value)
  if (mineru.success) {
    try {
      post(
        await runMineruRequest(
          mineru.data,
          fetch,
          allowLoopbackArtifactTestPolicy
            ? { validateArtifactUrl: assertPublicHttpsOrLoopbackTestUrl }
            : {}
        )
      )
    } catch (err) {
      workerLog?.(
        'error',
        'worker.background.auxiliary_failed',
        'Background auxiliary request failed',
        undefined,
        err
      )
      post({
        type: 'error',
        requestId: mineru.data.requestId,
        error: serializeMineruError(err)
      } satisfies MineruUtilityResponse)
    }
    return
  }

  const auxiliary = auxiliaryUtilityRequestSchema.safeParse(value)
  if (auxiliary.success) {
    const controller = new AbortController()
    activeRequests.set(auxiliary.data.requestId, {
      projectSessionId: auxiliary.data.projectSessionId,
      controller
    })
    try {
      post(await runAuxiliaryModelRequest(auxiliary.data, fetch, controller.signal))
    } catch (err) {
      if (auxiliary.data.operation === 'image') {
        workerLog?.(
          'error',
          'worker.background.image_generation_failed',
          'Background image generation request failed',
          {
            modelId: auxiliary.data.config.model,
            promptLength: auxiliary.data.input.prompt.length
          },
          err
        )
      }
      post({
        type: 'error',
        requestId: auxiliary.data.requestId,
        projectSessionId: auxiliary.data.projectSessionId ?? null,
        error: serializeModelError(err, 'Auxiliary model utility request failed')
      } satisfies AuxiliaryUtilityResponse)
    } finally {
      activeRequests.delete(auxiliary.data.requestId)
    }
    return
  }

  const probe = providerProbeRequestSchema.safeParse(value)
  if (probe.success) {
    const controller = new AbortController()
    activeRequests.set(probe.data.requestId, {
      projectSessionId: probe.data.projectSessionId,
      controller
    })
    try {
      post(await runProviderProbeRequest(probe.data, fetch, controller.signal))
    } catch (err) {
      workerLog?.(
        'error',
        'worker.background.probe_failed',
        'Background provider probe failed',
        undefined,
        err
      )
    } finally {
      activeRequests.delete(probe.data.requestId)
    }
    return
  }

  post({
    type: 'error',
    requestId: extractRequestId(value),
    projectSessionId: null,
    error: {
      name: 'ValidationError',
      message: 'Background worker request is invalid'
    }
  } satisfies ProviderProbeResponse)
  workerLog?.(
    'error',
    'worker.background.invalid_request',
    'Background worker request validation failed'
  )
}

function post(message: unknown): void {
  parentPort?.postMessage(message)
}

function serializeMineruError(error: unknown): {
  name: string
  message: string
  stack?: string
  httpStatus?: number
  providerCode?: string
  retryable: boolean
} {
  const original =
    error instanceof Error ? error : new Error('MinerU utility request failed', { cause: error })
  const known = original instanceof MineruRequestError ? original : undefined
  const message = known === undefined ? 'MinerU utility request failed' : `MinerU ${known.code}`
  return {
    name: original.name.slice(0, 200),
    message,
    ...(original.stack === undefined ? {} : { stack: safeStack(original.stack, message) }),
    ...(known?.httpStatus === undefined ? {} : { httpStatus: known.httpStatus }),
    ...(known?.providerCode === undefined ? {} : { providerCode: known.providerCode }),
    retryable: known?.retryable ?? false
  }
}

function serializeModelError(
  error: unknown,
  fallback: string
): {
  name: string
  message: string
  stack?: string
  httpStatus?: number
  providerCode?: string
} {
  const original = error instanceof Error ? error : new Error(fallback, { cause: error })
  const message = original.name === 'AbortError' ? `${fallback} aborted` : fallback
  const providerCode = findProviderCode(original)
  return {
    name: original.name.slice(0, 200),
    message,
    ...(original.stack === undefined ? {} : { stack: safeStack(original.stack, message) }),
    ...(findHttpStatus(original) === undefined ? {} : { httpStatus: findHttpStatus(original) }),
    ...(providerCode === undefined ? {} : { providerCode })
  }
}

function findProviderCode(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { providerCode?: unknown; cause?: unknown }
  if (
    typeof candidate.providerCode === 'string' &&
    /^[A-Z][A-Z0-9_]{1,127}$/.test(candidate.providerCode)
  ) {
    return candidate.providerCode
  }
  return findProviderCode(candidate.cause, depth + 1)
}

function isLoggingPortMessage(
  event: Electron.MessageEvent
): event is Electron.MessageEvent & { ports: [MessagePort, ...MessagePort[]] } {
  return (
    event.data !== null &&
    typeof event.data === 'object' &&
    'type' in event.data &&
    event.data.type === 'logging-port' &&
    event.ports !== undefined &&
    event.ports.length > 0
  )
}
