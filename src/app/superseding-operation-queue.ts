/**
 * Serialises document operations while letting a newer intent supersede an
 * older queued intent with the same key.
 *
 * Native note changes must save before they read and mount another file, so
 * they cannot run concurrently. A plain FIFO queue is still wrong for UI
 * selection: rapid A -> B -> C clicks would open all three long after the
 * person had chosen C. This queue preserves serial filesystem work while
 * making the newest selection authoritative.
 */
export class SupersedingOperationQueue {
  #tail: Promise<void> = Promise.resolve()
  readonly #latest = new Map<string, number>()

  constructor(private readonly onError: (error: unknown) => void) {}

  enqueue(operation: () => Promise<void>): Promise<void> {
    this.#tail = this.#tail.then(operation).catch(this.onError)
    return this.#tail
  }

  enqueueLatest(
    key: string,
    operation: (isCurrent: () => boolean) => Promise<void>,
  ): Promise<void> {
    const token = (this.#latest.get(key) ?? 0) + 1
    this.#latest.set(key, token)
    const isCurrent = (): boolean => this.#latest.get(key) === token
    return this.enqueue(async () => {
      if (!isCurrent()) return
      await operation(isCurrent)
    })
  }
}
