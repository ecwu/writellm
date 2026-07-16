export class ProjectOperationRegistry {
  readonly #controllers = new Set<AbortController>()

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
}
