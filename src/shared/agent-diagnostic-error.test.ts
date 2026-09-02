import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  AGENT_DIAGNOSTIC_ERROR_MAX_BYTES,
  agentDiagnosticErrorSchema,
  agentDiagnosticSensitiveValues,
  reconstructAgentDiagnosticError,
  safeAgentDiagnosticMessage,
  serializeAgentDiagnosticError
} from './agent-diagnostic-error'

describe('Agent diagnostic errors', () => {
  it('accepts literal credentials and keeps safe projections safe across repeated serialization', () => {
    expect(agentDiagnosticSensitiveValues('{not-json')).toEqual(['{not-json'])
    expect(agentDiagnosticSensitiveValues('{"apiKey":"nested-secret"}')).toContain('nested-secret')
    const error = new Error('Provider rejected PRIVATE_BODY')
    serializeAgentDiagnosticError(error, 'provider', { privateBodies: ['PRIVATE_BODY'] })
    expect(JSON.stringify(serializeAgentDiagnosticError(error, 'run'))).not.toContain(
      'PRIVATE_BODY'
    )
  })

  it('preserves nested causes, machine codes, HTTP status, and stacks through reconstruction', () => {
    const providerError = new Error('HTTP 503: upstream temporarily unavailable')
    Object.assign(providerError, { code: 'UPSTREAM_UNAVAILABLE', statusCode: 503 })
    providerError.stack = 'ProviderError: HTTP 503\n    at provider.ts:12:3'
    const outer = new Error('Model request failed', { cause: providerError })
    outer.stack = 'Error: Model request failed\n    at model.ts:8:1'

    const diagnostic = serializeAgentDiagnosticError(outer, 'agent.model')

    expect(agentDiagnosticErrorSchema.safeParse(diagnostic).success).toBe(true)
    expect(diagnostic).toMatchObject({
      schemaVersion: 1,
      stage: 'agent.model',
      name: 'Error',
      message: 'Model request failed',
      causes: [
        {
          name: 'Error',
          message: 'HTTP 503: upstream temporarily unavailable',
          code: 'UPSTREAM_UNAVAILABLE',
          httpStatus: 503
        }
      ]
    })
    expect(diagnostic.stack).toContain('model.ts:8:1')

    const reconstructed = reconstructAgentDiagnosticError(diagnostic)
    expect(reconstructed).toMatchObject({ name: 'Error', message: 'Model request failed' })
    expect((reconstructed as Error & { code?: string }).code).toBeUndefined()
    expect(reconstructed.cause).toBeInstanceOf(Error)
    expect(reconstructed.cause).toMatchObject({
      name: 'Error',
      message: 'HTTP 503: upstream temporarily unavailable',
      code: 'UPSTREAM_UNAVAILABLE',
      httpStatus: 503,
      statusCode: 503
    })
  })

  it('handles primitive causes and cyclic causes without a depth cutoff or infinite traversal', () => {
    const primitive = new Error('outer failure', { cause: 'socket closed by peer' })
    const primitiveDiagnostic = serializeAgentDiagnosticError(primitive, 'tool.read')
    expect(primitiveDiagnostic.causes).toEqual([
      expect.objectContaining({ name: 'Cause', message: 'socket closed by peer' })
    ])

    const cycle = new Error('cycle node')
    cycle.cause = cycle
    const cyclic = new Error('cyclic outer', { cause: cycle })
    const cyclicDiagnostic = serializeAgentDiagnosticError(cyclic, 'tool.read')
    expect(cyclicDiagnostic.causes).toHaveLength(1)
    expect(cyclicDiagnostic.causes[0]?.message).toBe('cycle node')

    const deepCauses = Array.from({ length: 12 }, (_, index) => new Error(`cause-${index}`))
    for (const [index, cause] of deepCauses.entries()) {
      const nextCause = deepCauses[index + 1]
      if (nextCause !== undefined) cause.cause = nextCause
    }
    const deepOuter = new Error('deep outer', { cause: deepCauses[0] })
    expect(serializeAgentDiagnosticError(deepOuter, 'tool.read').causes).toHaveLength(12)

    const directCycle = new Error('direct cycle')
    directCycle.cause = directCycle
    expect(serializeAgentDiagnosticError(directCycle, 'tool.read').causes).toHaveLength(0)
  })

  it('bounds the complete envelope by UTF-8 bytes while retaining a useful message', () => {
    const cause = new Error('原因🙂'.repeat(20_000))
    const error = new Error('模型请求失败：请保留这个诊断。'.repeat(20_000), { cause })
    error.stack = '错误堆栈🙂'.repeat(20_000)

    const diagnostic = serializeAgentDiagnosticError(error, 'agent.model')
    const bytes = new TextEncoder().encode(JSON.stringify(diagnostic)).byteLength

    expect(bytes).toBeLessThanOrEqual(AGENT_DIAGNOSTIC_ERROR_MAX_BYTES)
    expect(diagnostic.message).toContain('模型请求失败')
    expect(agentDiagnosticErrorSchema.safeParse(diagnostic).success).toBe(true)
  })

  it('redacts known secrets, credentials, signed URLs, private paths, and private bodies', () => {
    const secret = 'provider-secret-123'
    const privateBody = 'PRIVATE PROVIDER RESPONSE BODY'
    const error = new Error(
      [
        'Request rejected: HTTP 401',
        `Authorization: Bearer ${secret}`,
        'Cookie: session=browser-secret; theme=dark',
        `x-api-key=${secret}`,
        '{"authorization":"Bearer json-secret","cookie":"session=json-cookie"}',
        'download https://example.test/report.pdf?X-Amz-Signature=signed-token&X-Amz-Expires=60',
        'local file /Users/private/project/source.md',
        'workspace /workspace/manuscript/chapter.md C:/project/private.md',
        'file:///workspace/private-source.md',
        String.raw`\\fileserver\private-share\manuscript.md`,
        'api_key=embedded-secret',
        'body:',
        privateBody
      ].join('\n')
    )

    const diagnostic = serializeAgentDiagnosticError(error, 'agent.provider', {
      knownSensitiveValues: [secret, 'browser-secret'],
      privateBodies: [privateBody]
    })
    const serialized = JSON.stringify(diagnostic)

    expect(diagnostic.message).toContain('HTTP 401')
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('browser-secret')
    expect(serialized).not.toContain('json-secret')
    expect(serialized).not.toContain('json-cookie')
    expect(serialized).not.toContain('signed-token')
    expect(serialized).not.toContain(privateBody)
    expect(serialized).not.toContain('/Users/private/project/source.md')
    expect(serialized).not.toContain('/workspace/manuscript/chapter.md')
    expect(serialized).not.toContain('C:/project/private.md')
    expect(serialized).not.toContain('private-source.md')
    expect(serialized).not.toContain('private-share')
    expect(serialized).not.toContain('embedded-secret')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('[REDACTED_URL]')
    expect(serialized).toContain('[REDACTED_PATH]')
  })

  it('keeps concrete network and Zod messages instead of replacing them with generic text', () => {
    expect(
      safeAgentDiagnosticMessage(
        new Error(
          'request failed; Authorization: Bearer PRIVATE_KEY; status=503; provider detail=UPSTREAM'
        )
      )
    ).toBe('request failed; Authorization: [REDACTED]; status=503; provider detail=UPSTREAM')
    const networkError = new Error('fetch failed: HTTP 429 Too Many Requests')
    expect(safeAgentDiagnosticMessage(networkError)).toBe(
      'fetch failed: HTTP 429 Too Many Requests'
    )

    const validationError = new ZodError([
      { code: 'invalid_type', expected: 'string', path: ['title'], message: 'Expected string' }
    ])
    const diagnostic = serializeAgentDiagnosticError(validationError, 'tool.arguments')
    expect(diagnostic.name).toBe('ZodError')
    expect(diagnostic.message).toContain('Expected string')
    expect(diagnostic.message).toContain('title')
  })

  it('does not enumerate provider body or prompt fields on an object-shaped failure', () => {
    const error = {
      name: 'ProviderResponseError',
      message: 'Provider rejected the request',
      code: 'BAD_REQUEST',
      body: 'PRIVATE BODY THAT MUST NOT CROSS THE BOUNDARY',
      prompt: 'PRIVATE PROMPT THAT MUST NOT CROSS THE BOUNDARY',
      response: { body: 'PRIVATE RESPONSE BODY' }
    }

    const diagnostic = serializeAgentDiagnosticError(error, 'agent.provider')
    const serialized = JSON.stringify(diagnostic)
    expect(diagnostic.message).toBe('Provider rejected the request')
    expect(diagnostic.code).toBe('BAD_REQUEST')
    expect(serialized).not.toContain('PRIVATE BODY')
    expect(serialized).not.toContain('PRIVATE PROMPT')
    expect(serialized).not.toContain('PRIVATE RESPONSE')
  })
})
