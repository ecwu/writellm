export type CanonicalJsonErrorKind =
  | 'undefined'
  | 'non_finite'
  | 'not_serializable'
  | 'cycle'
  | 'non_plain'
  | 'symbol_key'

export class CanonicalJsonError extends TypeError {
  constructor(
    readonly kind: CanonicalJsonErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'CanonicalJsonError'
  }
}

export interface CanonicalJsonOptions {
  /** Replace the shared error with a domain-specific error while preserving it as the cause. */
  readonly onError?: (error: CanonicalJsonError) => Error
  /** Preserve legacy JSON fingerprints that omitted undefined object properties. */
  readonly omitUndefinedObjectProperties?: boolean
  /** Serialize undefined array members and array holes as null, as JSON.stringify does. */
  readonly undefinedArrayMembersAsNull?: boolean
  /** Serialize NaN and infinities as null, as JSON.stringify does. */
  readonly nonFiniteNumbersAsNull?: boolean
  /** Enumerate the own string keys of non-plain objects instead of rejecting them. */
  readonly enumerateNonPlainObjects?: boolean
  /** Skip symbol keys, as Object.keys does, instead of rejecting them. */
  readonly ignoreSymbolKeys?: boolean
}

/**
 * Historical model-request fingerprints accepted JSON.stringify's null projection for
 * non-finite numbers and undefined array members, required plain objects, and skipped symbol
 * keys. Persisted fingerprints depend on these rules.
 */
export const LEGACY_MODEL_REQUEST_FINGERPRINT: CanonicalJsonOptions = Object.freeze({
  omitUndefinedObjectProperties: true,
  undefinedArrayMembersAsNull: true,
  nonFiniteNumbersAsNull: true,
  ignoreSymbolKeys: true
})

/**
 * Historical trace capture rejected non-finite numbers but projected undefined array members to
 * null, enumerated non-plain objects, and skipped symbol keys.
 */
export const LEGACY_TRACE_DOCUMENT: CanonicalJsonOptions = Object.freeze({
  omitUndefinedObjectProperties: true,
  undefinedArrayMembersAsNull: true,
  enumerateNonPlainObjects: true,
  ignoreSymbolKeys: true
})

export type CanonicalJsonValue =
  | null
  | boolean
  | string
  | number
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

/**
 * Normalize JSON data by sorting object keys and rejecting values that JSON cannot represent.
 * The Node-free implementation is safe to use from shared contract code.
 */
export function canonicalizeJson(
  value: unknown,
  options: CanonicalJsonOptions = {}
): CanonicalJsonValue {
  const seen = new Set<object>()
  const visit = (candidate: unknown): CanonicalJsonValue => {
    if (candidate === null) return null
    if (typeof candidate === 'string' || typeof candidate === 'boolean') return candidate
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        if (options.nonFiniteNumbersAsNull === true) return null
        return fail(options, 'non_finite', 'Canonical JSON cannot contain a non-finite number')
      }
      return candidate
    }
    if (typeof candidate !== 'object') {
      return fail(
        options,
        candidate === undefined ? 'undefined' : 'not_serializable',
        'Canonical JSON contains a non-JSON value'
      )
    }
    if (seen.has(candidate)) return fail(options, 'cycle', 'Canonical JSON contains a cycle')
    seen.add(candidate)
    try {
      if (Array.isArray(candidate)) {
        const result: CanonicalJsonValue[] = []
        for (let index = 0; index < candidate.length; index += 1) {
          const missing = !Object.hasOwn(candidate, index) || candidate[index] === undefined
          if (missing && options.undefinedArrayMembersAsNull === true) {
            result.push(null)
            continue
          }
          if (!Object.hasOwn(candidate, index)) {
            return fail(options, 'undefined', 'Canonical JSON arrays cannot contain holes')
          }
          result.push(visit(candidate[index]))
        }
        return result
      }
      if (
        Object.getPrototypeOf(candidate) !== Object.prototype &&
        options.enumerateNonPlainObjects !== true
      ) {
        return fail(
          options,
          'non_plain',
          'Canonical JSON objects must use the plain object prototype'
        )
      }
      if (options.ignoreSymbolKeys !== true && Object.getOwnPropertySymbols(candidate).length > 0) {
        return fail(options, 'symbol_key', 'Canonical JSON objects cannot contain symbol keys')
      }
      const entries: Array<readonly [string, CanonicalJsonValue]> = []
      for (const key of Object.keys(candidate).sort()) {
        const member = (candidate as Record<string, unknown>)[key]
        if (member === undefined && options.omitUndefinedObjectProperties === true) continue
        entries.push([key, visit(member)])
      }
      return Object.fromEntries(entries) as { [key: string]: CanonicalJsonValue }
    } finally {
      seen.delete(candidate)
    }
  }
  return visit(value)
}

export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  const normalized = canonicalizeJson(value, options)
  return serializeCanonicalValue(normalized, options)
}

function serializeCanonicalValue(value: CanonicalJsonValue, options: CanonicalJsonOptions): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((member) => serializeCanonicalValue(member, options)).join(',')}]`
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeCanonicalValue(value[key], options)}`)
    .join(',')}}`
}

function fail<T>(options: CanonicalJsonOptions, kind: CanonicalJsonErrorKind, message: string): T {
  const error = new CanonicalJsonError(kind, message)
  throw options.onError === undefined ? error : options.onError(error)
}
