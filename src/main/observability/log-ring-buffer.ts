import type { DiagnosticLog } from '../../shared/observability/log-schema'

export class LogRingBuffer {
  readonly #entries: DiagnosticLog[] = []
  readonly #capacity: number
  readonly #listeners = new Set<(entry: DiagnosticLog) => void>()

  constructor(capacity = 2_000) {
    this.#capacity = capacity
  }

  push(entry: DiagnosticLog): void {
    this.#entries.push(entry)
    if (this.#entries.length > this.#capacity) this.#entries.shift()
    for (const listener of this.#listeners) listener(entry)
  }

  snapshot(): DiagnosticLog[] {
    return this.#entries.map((entry) => ({ ...entry }))
  }

  subscribe(listener: (entry: DiagnosticLog) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}
