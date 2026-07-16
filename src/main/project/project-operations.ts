export class ProjectOperationRegistry {
  readonly #controllers = new Set<AbortController>()
  #mutationsPaused = false

  track(controller: AbortController): () => void {
    this.#controllers.add(controller)
    return () => this.#controllers.delete(controller)
  }

  abortAll(reason = new Error('Project is closing')): void {
    for (const controller of this.#controllers) controller.abort(reason)
    this.#controllers.clear()
  }

  get size(): number {
    return this.#controllers.size
  }

  pauseMutations(): void {
    this.#mutationsPaused = true
  }

  resumeMutations(): void {
    this.#mutationsPaused = false
  }

  assertMutationsAllowed(): void {
    if (this.#mutationsPaused) throw new Error('Project mutations are temporarily paused')
  }
}
