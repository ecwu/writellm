import { describe, expect, it } from 'vitest'
import {
  prepareSpeechErrorForLogging,
  SpeechFailure,
  speechErrorMessage,
  speechHttpFailure
} from './speech-errors'
import { agentDiagnosticForLogging } from './agent-diagnostic-error'

describe('speech safe errors', () => {
  it('keeps the original error identity and safe stack/cause without provider messages or credentials', () => {
    const cause = new Error('private transcript from user at https://private.example/proxy')
    const original = Object.assign(
      new Error('private audio transcription response with api-key', { cause }),
      {
        headers: { authorization: 'Bearer api-key' },
        request: { body: 'audio' },
        response: { text: 'private' }
      }
    )
    prepareSpeechErrorForLogging(original, ['api-key', 'https://private.example/proxy'])
    const diagnostic = agentDiagnosticForLogging(original)
    expect(diagnostic?.name).toBe('Error')
    expect(diagnostic?.stack).toBeDefined()
    expect(diagnostic?.causes).toHaveLength(1)
    const serialized = JSON.stringify(diagnostic)
    for (const forbidden of [
      'private transcript',
      'private audio',
      'api-key',
      'https://private.example',
      'authorization',
      'headers',
      'request',
      'response'
    ])
      expect(serialized).not.toContain(forbidden)
    expect(original.cause).toBe(cause)
  })
  it('maps authentication/quota/timeout to fixed safe messages', () => {
    expect(speechErrorMessage(speechHttpFailure(401))).toContain('API key')
    expect(speechErrorMessage(speechHttpFailure(429))).toContain('quota')
    expect(speechErrorMessage(new SpeechFailure('Speech connection timed out.'))).toContain(
      'timed out'
    )
    expect(speechErrorMessage(new Error('private transcript'))).not.toContain('private')
  })
})

import { speechProviderFailure, SPEECH_SETUP_REQUIRED } from './speech-errors'

describe('speech provider rejection projection', () => {
  it.each([
    'unknown_parameter',
    'invalid_parameter',
    'invalid_value',
    'model_not_found',
    'invalid_api_key',
    'insufficient_quota',
    'rate_limit_exceeded'
  ])('maps SDK %s without copying its message', (code) => {
    const original = Object.assign(
      new Error('private transcript at https://private.example with secret-key'),
      {
        error: {
          code,
          param: 'session.audio.input.transcription.languages',
          message: 'private value'
        }
      }
    )
    const failure = speechProviderFailure(original)
    expect(failure.providerCode).toBe(code)
    expect(failure.providerParam).toBe('session.audio.input.transcription.languages')
    expect(failure.cause).toBe(original)
    expect(failure.safeMessage).toContain('Parameter: session.audio.input.transcription.languages.')
    expect(failure.safeMessage).not.toMatch(/private|secret-key/)
  })

  it('omits unknown machine codes and parameter values instead of reflecting provider text', () => {
    const unknown = speechProviderFailure({
      error: { code: 'private-user-text', param: 'private parameter', message: 'secret' }
    })
    expect(unknown.providerCode).toBeUndefined()
    expect(unknown.providerParam).toBeUndefined()
    expect(unknown.safeMessage).toBe('Speech connection failed. Check the endpoint and network.')
    const known = speechProviderFailure({
      error: { code: 'invalid_parameter', param: 'languages=private-user-text' }
    })
    expect(known.providerCode).toBe('invalid_parameter')
    expect(known.providerParam).toBeUndefined()
    expect(known.safeMessage).toBe('Speech provider rejected a configured parameter.')
  })

  it('preserves fixed provider errors and setup instructions through causes and Electron invoke messages', () => {
    const failure = speechProviderFailure({
      error: { code: 'invalid_parameter', param: 'session.audio.input.transcription.languages' }
    })
    expect(speechErrorMessage(new Error('internal wrapper', { cause: failure }))).toBe(
      failure.safeMessage
    )
    expect(
      speechErrorMessage(
        new Error(
          `Error invoking remote method 'speech:test': SpeechFailure: ${failure.safeMessage}`
        )
      )
    ).toBe(failure.safeMessage)
    expect(
      speechErrorMessage(
        new Error(
          `Error invoking remote method 'speech:start': SpeechFailure: ${SPEECH_SETUP_REQUIRED}`
        )
      )
    ).toBe(SPEECH_SETUP_REQUIRED)
    expect(
      speechErrorMessage(
        new Error("Error invoking remote method 'speech:test': Error: private provider text")
      )
    ).toBe('Speech connection failed. Check the endpoint and network.')
    expect(speechErrorMessage(new Error(`${failure.safeMessage} private trailing value`))).toBe(
      'Speech connection failed. Check the endpoint and network.'
    )
  })

  it('does not invoke provider property accessors', () => {
    const getter = (): never => {
      throw new Error('must not inspect an accessor')
    }
    expect(
      speechProviderFailure(Object.defineProperty({}, 'error', { get: getter })).providerCode
    ).toBeUndefined()
  })
})
