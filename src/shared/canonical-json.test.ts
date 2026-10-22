import { describe, expect, it } from 'vitest'
import {
  CanonicalJsonError,
  canonicalJson,
  canonicalizeJson,
  LEGACY_MODEL_REQUEST_FINGERPRINT,
  LEGACY_TRACE_DOCUMENT
} from './canonical-json'
import { sha256 } from './hash'

describe('canonical JSON', () => {
  it('sorts nested object keys without changing valid durable fingerprints', () => {
    const canonical = canonicalJson({
      z: 3,
      a: { beta: false, alpha: 'é\n汉字' },
      items: [true, null, { b: 2, a: 1 }]
    })
    expect(canonical).toBe(
      '{"a":{"alpha":"é\\n汉字","beta":false},"items":[true,null,{"a":1,"b":2}],"z":3}'
    )
    expect(sha256(canonical)).toBe(
      'fdc04749604f3ab8e4c052b2245ffb57a362e4cbe311d973bc0e1f1bd809f898'
    )
  })

  it('returns a sorted JSON value for consumers that need to split the result', () => {
    expect(canonicalizeJson({ z: 1, a: [{ b: 2, a: 3 }] })).toEqual({
      a: [{ a: 3, b: 2 }],
      z: 1
    })
  })

  it('can preserve legacy omission of undefined object properties without weakening strict defaults', () => {
    expect(() => canonicalJson({ temperature: undefined })).toThrow(CanonicalJsonError)
    expect(
      JSON.stringify(
        canonicalizeJson(
          { temperature: undefined, nested: { topP: undefined, value: 1 } },
          { omitUndefinedObjectProperties: true }
        )
      )
    ).toBe('{"nested":{"value":1}}')
  })

  it('retains lexical ordering for numeric keys and owns the __proto__ key', () => {
    const input = JSON.parse(
      '{"10":"ten","2":"two","__proto__":{"safe":true},"constructor":"own"}'
    ) as {
      [key: string]: unknown
    }
    const normalized = canonicalizeJson(input)
    expect(canonicalJson(input)).toBe(
      '{"10":"ten","2":"two","__proto__":{"safe":true},"constructor":"own"}'
    )
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype)
    expect(Object.hasOwn(normalized, '__proto__')).toBe(true)
    expect(Object.hasOwn(normalized, 'constructor')).toBe(true)
  })

  it.each([
    ['undefined', undefined],
    ['non-finite', { value: Number.NaN }],
    [
      'cycle',
      (() => {
        const value: Record<string, unknown> = {}
        value.self = value
        return value
      })()
    ],
    ['non-plain', { value: new Date('2026-01-01T00:00:00.000Z') }],
    ['bigint', { value: 1n }]
  ] as const)('rejects %s input', (_name, input) => {
    expect(() => canonicalJson(input)).toThrow(CanonicalJsonError)
  })

  it('supports domain-specific error factories', () => {
    expect(() =>
      canonicalJson(
        { value: Number.POSITIVE_INFINITY },
        { onError: (error) => new Error('domain failure', { cause: error }) }
      )
    ).toThrow('domain failure')
  })

  describe('legacy compatibility profiles', () => {
    // Expected values come from the serializers that wrote existing fingerprints and traces.
    const serialize = (value: unknown, options: Parameters<typeof canonicalizeJson>[1]) =>
      JSON.stringify(canonicalizeJson(value, options))
    const symbol = Symbol('internal')

    it('reproduces historical model-request fingerprint input', () => {
      const options = LEGACY_MODEL_REQUEST_FINGERPRINT
      expect(serialize({ messages: ['a', undefined, 'b'] }, options)).toBe(
        '{"messages":["a",null,"b"]}'
      )
      // biome-ignore lint/suspicious/noSparseArray: the historical serializer accepted holes.
      expect(serialize({ list: [1, , 3] }, options)).toBe('{"list":[1,null,3]}')
      expect(
        serialize({ temperature: Number.NaN, max: Infinity, list: [Number.NaN] }, options)
      ).toBe('{"list":[null],"max":null,"temperature":null}')
      expect(serialize({ [symbol]: 1, a: 1 }, options)).toBe('{"a":1}')
      expect(() => serialize({ bytes: new Uint8Array([2, 1]) }, options)).toThrow(
        CanonicalJsonError
      )
    })

    it('reproduces historical trace document serialization', () => {
      const options = LEGACY_TRACE_DOCUMENT
      expect(serialize({ messages: ['a', undefined, 'b'] }, options)).toBe(
        '{"messages":["a",null,"b"]}'
      )
      // biome-ignore lint/suspicious/noSparseArray: the historical serializer accepted holes.
      expect(serialize({ list: [1, , 3] }, options)).toBe('{"list":[1,null,3]}')
      expect(serialize({ [symbol]: 1, a: 1 }, options)).toBe('{"a":1}')
      expect(serialize({ bytes: new Uint8Array([2, 1]), when: new Date(0) }, options)).toBe(
        '{"bytes":{"0":2,"1":1},"when":{}}'
      )
      expect(() => serialize({ temperature: Number.NaN }, options)).toThrow(CanonicalJsonError)
    })

    it('keeps the strict default for new callers', () => {
      expect(() => canonicalJson({ messages: [undefined] })).toThrow(CanonicalJsonError)
      expect(() => canonicalJson({ temperature: Number.NaN })).toThrow(CanonicalJsonError)
      expect(() => canonicalJson({ bytes: new Uint8Array([1]) })).toThrow(CanonicalJsonError)
      expect(() => canonicalJson({ [symbol]: 1 })).toThrow(CanonicalJsonError)
    })
  })
})
