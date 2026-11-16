import { serializeAgentDiagnosticError } from './agent-diagnostic-error'

export const SPEECH_SETUP_REQUIRED = 'Set up Speech input in Settings before starting dictation.'
export const SPEECH_PROVIDER_CODES = [
  'unknown_parameter',
  'invalid_parameter',
  'invalid_value',
  'invalid_request_error',
  'model_not_found',
  'invalid_model',
  'unsupported_model',
  'invalid_api_key',
  'authentication_error',
  'permission_denied',
  'insufficient_quota',
  'rate_limit_exceeded'
] as const
export type SpeechProviderCode = (typeof SPEECH_PROVIDER_CODES)[number]
export const SPEECH_PROVIDER_PARAMS = [
  'model',
  'session.type',
  'session.audio.input.transcription',
  'session.audio.input.transcription.model',
  'session.audio.input.transcription.languages',
  'session.audio.input.transcription.language',
  'session.audio.input.turn_detection',
  'session.audio.input.format',
  'session.audio.input.format.rate',
  'session.input_audio_transcription.model',
  'session.input_audio_transcription.languages',
  'session.input_audio_format',
  'session.turn_detection',
  'response_format',
  'file',
  'language',
  'languages',
  'languages[]'
] as const
export type SpeechProviderParam = (typeof SPEECH_PROVIDER_PARAMS)[number]
const providerMessages: Record<SpeechProviderCode, string> = {
  unknown_parameter: 'Speech provider does not support a configured parameter.',
  invalid_parameter: 'Speech provider rejected a configured parameter.',
  invalid_value: 'Speech provider rejected a configuration value.',
  invalid_request_error: 'Speech provider rejected the speech configuration.',
  model_not_found: 'Speech model is unavailable. Check the configured model and endpoint.',
  invalid_model: 'Speech model is unavailable. Check the configured model and endpoint.',
  unsupported_model: 'Speech model does not support this recognition mode.',
  invalid_api_key: 'Speech authentication failed. Check the API key.',
  authentication_error: 'Speech authentication failed. Check the API key.',
  permission_denied: 'Speech provider denied access. Check the API key permissions.',
  insufficient_quota: 'Speech quota or rate limit reached.',
  rate_limit_exceeded: 'Speech quota or rate limit reached.'
}
const connectionFailure = 'Speech connection failed. Check the endpoint and network.'
const fixedMessages = new Set([
  SPEECH_SETUP_REQUIRED,
  'Microphone preparation timed out. Check the input device and try again.',
  'Speech audio processing could not load. Try dictation again.',
  'Audio capture could not start. Try dictation again.',
  connectionFailure,
  ...Object.values(providerMessages),
  'Speech connection timed out.',
  'Speech provider rejected the request. Check the configuration.',
  'Speech network cannot keep up. Try a shorter recording.',
  'Speech could not start. Check the configuration and connection.',
  'Speech recognition failed.',
  'Speech worker is unavailable.',
  'Speech is already active',
  'Microphone access is blocked. Enable WriteLLM in System Settings → Privacy & Security → Microphone.'
])
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
}
function providerCode(value: unknown): SpeechProviderCode | undefined {
  return typeof value === 'string' && SPEECH_PROVIDER_CODES.some((code) => code === value)
    ? (value as SpeechProviderCode)
    : undefined
}
function providerParam(value: unknown): SpeechProviderParam | undefined {
  return typeof value === 'string' && SPEECH_PROVIDER_PARAMS.some((param) => param === value)
    ? (value as SpeechProviderParam)
    : undefined
}
function providerMessage(code: SpeechProviderCode, param?: SpeechProviderParam): string {
  return `${providerMessages[code]}${param === undefined ? '' : ` Parameter: ${param}.`}`
}
export function prepareSpeechErrorForLogging(
  error: unknown,
  sensitiveValues: readonly string[] = []
): void {
  const privateBodies: string[] = []
  const seen = new Set<Error>()
  let current = error
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (current.message) privateBodies.push(current.message)
    current = current.cause
  }
  serializeAgentDiagnosticError(error, 'speech', {
    knownSensitiveValues: sensitiveValues,
    privateBodies
  })
}
/** Only fixed application messages survive Error wrapping or Electron's invoke serialization. */
export function speechErrorMessage(error: unknown): string {
  const seen = new Set<object>()
  let current = error
  for (let depth = 0; depth < 16; depth++) {
    if (current === null || typeof current !== 'object' || seen.has(current)) break
    seen.add(current)
    const message =
      current instanceof SpeechFailure ? current.safeMessage : ownValue(current, 'message')
    if (typeof message === 'string' && message.length <= 1000) {
      const candidate = message
        .replace(
          /^Error invoking remote method ['"]speech:(?:start|test)['"]: (?:(?:Error|SpeechFailure): )?/,
          ''
        )
        .replace(/^(?:Error|SpeechFailure): /, '')
      if (
        fixedMessages.has(candidate) ||
        /^Speech provider returned HTTP [1-5]\d{2}\.$/.test(candidate)
      )
        return candidate
      for (const code of SPEECH_PROVIDER_CODES) {
        for (const param of SPEECH_PROVIDER_PARAMS) {
          if (candidate === providerMessage(code, param)) return candidate
        }
      }
    }
    current = ownValue(current, 'cause')
  }
  return connectionFailure
}
export class SpeechFailure extends Error {
  readonly providerCode?: SpeechProviderCode
  readonly providerParam?: SpeechProviderParam
  constructor(
    readonly safeMessage: string,
    options?: ErrorOptions & {
      providerCode?: SpeechProviderCode
      providerParam?: SpeechProviderParam
    }
  ) {
    super(safeMessage, options)
    this.name = 'SpeechFailure'
    this.providerCode = options?.providerCode
    this.providerParam = options?.providerParam
  }
}
/** SDK errors wrap the wire error under .error; no provider message or parameter value is copied. */
export function speechProviderFailure(error: unknown): SpeechFailure {
  if (error instanceof SpeechFailure) return error
  const seen = new Set<object>()
  let current = error
  for (let depth = 0; depth < 8; depth++) {
    if (current === null || typeof current !== 'object' || seen.has(current)) break
    seen.add(current)
    const details = ownValue(current, 'error') ?? current
    const code = providerCode(ownValue(details, 'code'))
    if (code !== undefined) {
      const param = providerParam(ownValue(details, 'param'))
      return new SpeechFailure(providerMessage(code, param), {
        cause: error,
        providerCode: code,
        providerParam: param
      })
    }
    const status = ownValue(current, 'status') ?? ownValue(current, 'statusCode')
    if (typeof status === 'number' && [401, 403, 429].includes(status))
      return speechHttpFailure(status, { cause: error })
    current = ownValue(current, 'cause')
  }
  return new SpeechFailure(connectionFailure, { cause: error })
}
export function speechHttpFailure(status: number, options?: ErrorOptions): SpeechFailure {
  if (status === 401 || status === 403)
    return new SpeechFailure(providerMessages.authentication_error, {
      ...options,
      providerCode: 'authentication_error'
    })
  if (status === 429)
    return new SpeechFailure(providerMessages.rate_limit_exceeded, {
      ...options,
      providerCode: 'rate_limit_exceeded'
    })
  return new SpeechFailure(`Speech provider returned HTTP ${status}.`, options)
}
