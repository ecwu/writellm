import { z } from 'zod'

/**
 * Diagnostic records cross process boundaries and are persisted in project-local records. Keep
 * the complete envelope below the same 32 KiB bound that older error stacks used, rather than
 * applying an unrelated limit to every cause in the chain.
 */
export const AGENT_DIAGNOSTIC_ERROR_MAX_BYTES = 32_768

const MAX_NAME_CHARS = 200
const MAX_STAGE_CHARS = 200
const MAX_CODE_CHARS = 200
const MAX_MESSAGE_CHARS = 4_096
const MAX_STACK_CHARS = 32_768
const REDACTED = '[REDACTED]'
const REDACTED_URL = '[REDACTED_URL]'
const REDACTED_PATH = '[REDACTED_PATH]'

const diagnosticCauseSchema = z
  .object({
    name: z.string().min(1).max(MAX_NAME_CHARS),
    message: z.string().max(MAX_MESSAGE_CHARS),
    code: z.string().min(1).max(MAX_CODE_CHARS).optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    stack: z.string().max(MAX_STACK_CHARS).optional()
  })
  .strict()

export const agentDiagnosticErrorSchema = z
  .object({
    schemaVersion: z.literal(1),
    stage: z.string().min(1).max(MAX_STAGE_CHARS),
    name: z.string().min(1).max(MAX_NAME_CHARS),
    message: z.string().max(MAX_MESSAGE_CHARS),
    code: z.string().min(1).max(MAX_CODE_CHARS).optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    causes: z.array(diagnosticCauseSchema),
    stack: z.string().max(MAX_STACK_CHARS).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (encodedJsonBytes(value) > AGENT_DIAGNOSTIC_ERROR_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Agent diagnostic envelope is too large'
      })
    }
  })

export type AgentDiagnosticCause = z.infer<typeof diagnosticCauseSchema>
export type AgentDiagnosticError = z.infer<typeof agentDiagnosticErrorSchema>

// Logging still receives the original Error identity. Its serializer can reuse the safe
// projection prepared at the request boundary without retaining request bodies in log fields.
const logDiagnostics = new WeakMap<object, AgentDiagnosticError>()

export function agentDiagnosticForLogging(error: unknown): AgentDiagnosticError | undefined {
  return isObjectLike(error) ? logDiagnostics.get(error) : undefined
}

export interface AgentDiagnosticSerializationOptions {
  /** Values known by the caller to be credentials, tokens, or other secrets. */
  knownSensitiveValues?: readonly string[]
  /** Provider response/request bodies that must never cross the diagnostic boundary. */
  privateBodies?: readonly string[]
}

export function agentDiagnosticSensitiveValues(credential: unknown): string[] {
  const values = new Set<string>()
  const seen = new Set<object>()
  let root = credential
  if (typeof credential === 'string') {
    values.add(credential)
    try {
      root = JSON.parse(credential) as unknown
    } catch {
      // Literal credentials are a supported format, including text beginning with "{".
      root = credential
    }
  }
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.length > 0) values.add(value)
    } else if (isObjectLike(value) && !seen.has(value)) {
      seen.add(value)
      for (const child of Object.values(value)) visit(child)
    }
  }
  visit(root)
  return [...values]
}

type DiagnosticProperty =
  | 'name'
  | 'message'
  | 'code'
  | 'providerCode'
  | 'errorCode'
  | 'httpStatus'
  | 'statusCode'
  | 'status'
  | 'stack'
  | 'cause'

interface DiagnosticNode {
  name: string
  message: string
  code?: string
  httpStatus?: number
  stack?: string
}

interface Redactor {
  text(value: string, maximumChars?: number): string
}

/**
 * Convert an unknown failure into a bounded, safe diagnostic record. Only known diagnostic
 * properties are read from objects; provider request/response bodies and prompts are never
 * enumerated. Cause traversal stops only at a repeated object or when the total envelope cannot
 * hold another node, not at a fixed cause depth/count.
 */
export function serializeAgentDiagnosticError(
  error: unknown,
  stage: string,
  options: AgentDiagnosticSerializationOptions = {}
): AgentDiagnosticError {
  const previous = agentDiagnosticForLogging(error)
  const source = previous === undefined ? error : reconstructAgentDiagnosticError(previous)
  const redactor = createRedactor(options)
  const root = diagnosticNode(source, redactor, 'Error')
  const base = {
    schemaVersion: 1 as const,
    stage: nonEmptyText(redactor.text(stage, MAX_STAGE_CHARS), 'agent'),
    name: nonEmptyText(root.name, 'Error'),
    message: root.message,
    ...(root.code === undefined ? {} : { code: root.code }),
    ...(root.httpStatus === undefined ? {} : { httpStatus: root.httpStatus }),
    causes: [] as AgentDiagnosticCause[]
  }

  const causes = collectCauseNodes(source, redactor)
  let result: AgentDiagnosticError = base

  for (const cause of causes) {
    const withoutStack = omitUndefined({
      name: cause.name,
      message: cause.message,
      ...(cause.code === undefined ? {} : { code: cause.code }),
      ...(cause.httpStatus === undefined ? {} : { httpStatus: cause.httpStatus })
    }) as AgentDiagnosticCause
    const withStack =
      cause.stack === undefined ? withoutStack : { ...withoutStack, stack: cause.stack }
    const fullCandidate = { ...result, causes: [...result.causes, withStack] }
    if (fitsEnvelope(fullCandidate)) {
      result = fullCandidate
      continue
    }

    const bareCandidate = { ...result, causes: [...result.causes, withoutStack] }
    if (fitsEnvelope(bareCandidate)) {
      result = bareCandidate
      continue
    }

    const fittedMessage = fitStringToEnvelope(result, withoutStack, cause.message)
    if (fittedMessage === undefined) break
    const fittedCause = { ...withoutStack, message: fittedMessage }
    const fittedCandidate = { ...result, causes: [...result.causes, fittedCause] }
    if (!fitsEnvelope(fittedCandidate)) break
    result = fittedCandidate
  }

  if (root.stack !== undefined) {
    const fullCandidate = { ...result, stack: root.stack }
    if (fitsEnvelope(fullCandidate)) {
      result = fullCandidate
    } else {
      const fittedStack = fitRootStack(result, root.stack)
      if (fittedStack !== undefined) result = { ...result, stack: fittedStack }
    }
  }

  // The construction above is byte-aware. Keep this final assertion close to the boundary so a
  // future field addition cannot accidentally turn a safe projection into an oversized payload.
  const diagnostic = agentDiagnosticErrorSchema.parse(result)
  if (isObjectLike(error)) logDiagnostics.set(error, diagnostic)
  return diagnostic
}

/**
 * Rebuild an Error for local handling after an IPC/database round trip. The reconstructed errors
 * are diagnostics only: their code/status properties never grant authority to retry or mutate.
 */
export function reconstructAgentDiagnosticError(diagnostic: unknown): Error {
  const parsed = agentDiagnosticErrorSchema.parse(diagnostic)
  let cause: Error | undefined

  for (let index = parsed.causes.length - 1; index >= 0; index -= 1) {
    const node = parsed.causes[index]
    if (node === undefined) continue
    cause = errorFromNode(node, cause)
  }

  const root = errorFromNode(parsed, cause)
  Object.defineProperty(root, 'stage', { value: parsed.stage, enumerable: true })
  return root
}

/** Return the concrete, redacted message for a tool or model failure without generic rewriting. */
export function safeAgentDiagnosticMessage(
  error: unknown,
  options: AgentDiagnosticSerializationOptions = {}
): string {
  return diagnosticNode(error, createRedactor(options), 'Error').message
}

function errorFromNode(node: DiagnosticNode, cause?: Error): Error {
  const error = cause === undefined ? new Error(node.message) : new Error(node.message, { cause })
  error.name = node.name
  if (node.stack !== undefined) error.stack = node.stack
  if (node.code !== undefined) {
    Object.defineProperty(error, 'code', {
      configurable: true,
      enumerable: true,
      value: node.code,
      writable: true
    })
  }
  if (node.httpStatus !== undefined) {
    Object.defineProperty(error, 'httpStatus', {
      configurable: true,
      enumerable: true,
      value: node.httpStatus,
      writable: true
    })
    Object.defineProperty(error, 'statusCode', {
      configurable: true,
      enumerable: true,
      value: node.httpStatus,
      writable: true
    })
  }
  return error
}

function diagnosticNode(value: unknown, redactor: Redactor, fallbackName: string): DiagnosticNode {
  const isError = safeInstanceOfError(value)
  const nameValue = textProperty(value, 'name')
  const messageValue = textProperty(value, 'message')
  const code = firstTextProperty(value, ['code', 'providerCode', 'errorCode'], redactor)
  const httpStatus = firstHttpStatus(value)
  const stackValue = textProperty(value, 'stack')

  let message: string
  if (messageValue !== undefined) {
    message = redactor.text(messageValue, MAX_MESSAGE_CHARS)
  } else if (isPrimitive(value)) {
    message = redactor.text(primitiveText(value), MAX_MESSAGE_CHARS)
  } else {
    // Do not call String(object): a provider error's toString() may expose its raw body.
    message = ''
  }

  const name = nonEmptyText(
    redactor.text(nameValue ?? (isError ? fallbackName : fallbackName), MAX_NAME_CHARS),
    fallbackName
  )
  const stack = stackValue === undefined ? undefined : redactor.text(stackValue, MAX_STACK_CHARS)

  return {
    name,
    message,
    ...(code === undefined ? {} : { code }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(stack === undefined ? {} : { stack })
  }
}

function* collectCauseNodes(value: unknown, redactor: Redactor): Generator<DiagnosticNode> {
  const seen = new Set<object>()
  if (isObjectLike(value)) seen.add(value)
  let current = readProperty(value, 'cause')

  while (current !== undefined && current !== null) {
    if (isObjectLike(current)) {
      if (seen.has(current)) break
      seen.add(current)
    }
    yield diagnosticNode(current, redactor, 'Cause')
    current = readProperty(current, 'cause')
  }
}

function createRedactor(options: AgentDiagnosticSerializationOptions): Redactor {
  const values = [...(options.knownSensitiveValues ?? []), ...(options.privateBodies ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length)
  const uniqueValues = [...new Set(values)]

  return {
    text(value: string, maximumChars = MAX_MESSAGE_CHARS): string {
      let redacted = value
      for (const sensitiveValue of uniqueValues) {
        redacted = redacted.split(sensitiveValue).join(REDACTED)
      }
      redacted = redactHeaders(redacted)
      redacted = redactBearerTokens(redacted)
      redacted = redactSignedUrls(redacted)
      redacted = redactPrivatePaths(redacted)
      return truncateCharacters(redacted, maximumChars)
    }
  }
}

export function redactAgentDiagnosticText(value: string): string {
  return createRedactor({}).text(value, MAX_STACK_CHARS)
}

function redactHeaders(value: string): string {
  const headerValue =
    /((?:["']?(?:authorization|proxy-authorization)["']?\s*[:=]\s*))(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:Bearer|Basic|Token)\s+[^\s;,]+|[^\s;,]+)/giu
  const cookieValue =
    /((?:["']?(?:cookie|set-cookie)["']?\s*[:=]\s*))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/giu
  const credentialValue =
    /((?:["']?(?:x-api-key|api[_-]?key|access[_-]token|refresh[_-]token|password|passwd|secret|client[_-]secret|credential)["']?\s*[:=]\s*))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/giu
  const withHeaders = value
    .replace(headerValue, `$1${REDACTED}`)
    .replace(cookieValue, `$1${REDACTED}`)
  return withHeaders.replace(credentialValue, `$1${REDACTED}`)
}

function redactBearerTokens(value: string): string {
  return value.replace(/\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gu, REDACTED)
}

function redactSignedUrls(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s<>"'`]+/giu, (matched) => {
    const trailing = matched.match(/[),.;!?\]}]+$/u)?.[0] ?? ''
    const candidate = trailing.length === 0 ? matched : matched.slice(0, -trailing.length)
    try {
      const url = new URL(candidate)
      if (url.username || url.password || [...url.searchParams.keys()].some(isSensitiveQueryKey)) {
        return `${REDACTED_URL}${trailing}`
      }
    } catch {
      // An invalid URL is still passed through the header/path redactors below.
    }
    return matched
  })
}

function isSensitiveQueryKey(value: string): boolean {
  return /^(?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|key|signature|sig|expires?(?:_at)?|x-amz-[a-z-]+|se|sp|sv|skoid|sktid|skt|ske|sks|skv|credential|auth|jwt)$/iu.test(
    value
  )
}

function redactPrivatePaths(value: string): string {
  const fileUri = /\bfile:\/\/[^\s<>"'`()[\]{};,]+/giu
  const unc = /\\\\[^\s<>"'`()[\]{};,]+/gu
  const posix = /(?<![A-Za-z0-9_/:])\/(?!\/)[^\s<>"'`()[\]{};,]+/gu
  const windows = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s<>"'`()[\]{};,]*/gu
  const home = /(?<![A-Za-z0-9_])~\/[^\s<>"'`()[\]{};,]*/gu
  return value
    .replace(fileUri, REDACTED_PATH)
    .replace(unc, REDACTED_PATH)
    .replace(posix, REDACTED_PATH)
    .replace(windows, REDACTED_PATH)
    .replace(home, REDACTED_PATH)
}

function firstTextProperty(
  value: unknown,
  properties: readonly DiagnosticProperty[],
  redactor: Redactor
): string | undefined {
  for (const property of properties) {
    const candidate = textProperty(value, property)
    if (candidate === undefined || candidate.length === 0) continue
    return redactor.text(candidate, MAX_CODE_CHARS)
  }
  return undefined
}

function firstHttpStatus(value: unknown): number | undefined {
  for (const property of ['httpStatus', 'statusCode', 'status'] as const) {
    const candidate = readProperty(value, property)
    const status =
      typeof candidate === 'number'
        ? candidate
        : typeof candidate === 'string' && /^\d{3}$/u.test(candidate)
          ? Number(candidate)
          : undefined
    if (status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
  }
  return undefined
}

function textProperty(value: unknown, property: DiagnosticProperty): string | undefined {
  const candidate = readProperty(value, property)
  return typeof candidate === 'string' ? candidate : undefined
}

function readProperty(value: unknown, property: DiagnosticProperty): unknown {
  if (!isObjectLike(value)) return undefined
  try {
    return Reflect.get(value, property)
  } catch {
    return undefined
  }
}

function safeInstanceOfError(value: unknown): boolean {
  try {
    return value instanceof Error
  } catch {
    return false
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function')
}

function primitiveText(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  try {
    return String(value)
  } catch {
    return ''
  }
}

function nonEmptyText(value: string, fallback: string): string {
  return value.length === 0 ? fallback : value
}

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function truncateCharacters(value: string, maximumChars: number): string {
  if (value.length <= maximumChars) return value
  const target = Math.max(0, maximumChars - 1)
  let consumed = 0
  let prefix = ''
  for (const character of value) {
    if (consumed + character.length > target) break
    prefix += character
    consumed += character.length
  }
  return `${prefix}…`
}

function encodedJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function fitsEnvelope(value: unknown): value is AgentDiagnosticError {
  return encodedJsonBytes(value) <= AGENT_DIAGNOSTIC_ERROR_MAX_BYTES
}

function fitStringToEnvelope(
  current: AgentDiagnosticError,
  cause: AgentDiagnosticCause,
  value: string
): string | undefined {
  const minimal = { ...current, causes: [...current.causes, { ...cause, message: '' }] }
  if (!fitsEnvelope(minimal)) return undefined
  return fitString(value, (candidate) =>
    fitsEnvelope({
      ...current,
      causes: [...current.causes, { ...cause, message: candidate }]
    })
  )
}

function fitRootStack(current: AgentDiagnosticError, value: string): string | undefined {
  return fitString(value, (candidate) => fitsEnvelope({ ...current, stack: candidate }))
}

function fitString(value: string, fits: (candidate: string) => boolean): string | undefined {
  if (fits(value)) return value
  const characters = Array.from(value)
  let low = 0
  let high = characters.length
  let best = ''
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2)
    const candidate = characters.slice(0, midpoint).join('')
    if (fits(candidate)) {
      best = candidate
      low = midpoint + 1
    } else {
      high = midpoint - 1
    }
  }
  if (best.length === 0) return fits('') ? '' : undefined
  const marked = `${best}…`
  return fits(marked) ? marked : best
}
